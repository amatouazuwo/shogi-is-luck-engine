// EXPERIMENT ONLY: an adapter between a game's authoritative turn state and
// ContinuousSearchController. Not wired into shogi-is-luck production.
// Only the actual game can adjudicate events, time forfeits and terminal states.
// Do not invent a move when a native search is interrupted or unsupported.
const sameHoles=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&
 a.length===b.length&&a.every((x,i)=>x===b[i]);
const aborted=e=>e?.name==='AbortError';
export class SafeRsshogiGameTurn {
 constructor({controller,snapshot,applyMove,now=()=>performance.now()}={}){
  if(!controller||typeof controller.think!=='function'||typeof controller.cancel!=='function')
   throw TypeError('Continuous controller is required');
  if(typeof snapshot!=='function'||typeof applyMove!=='function'||typeof now!=='function')
   throw TypeError('Authoritative game state, applyMove, and clock are required');
  this.controller=controller;this.snapshot=snapshot;this.applyMove=applyMove;this.now=now;
  this.epoch=0;this.active=false;this.closed=false;
 }
 async invalidate(){
  // Call on game end, navigation, disconnect, special event or turn revision.
  // Do NOT let an abandoned search apply its result even if it resolves late.
  this.epoch++;this.active=false;
  await this.controller.cancel();
 }
 async close(){this.closed=true;await this.invalidate();}
 async play({movetimeMs=100,depth=64}={}){
  if(this.closed)return {status:'closed'};
  if(this.active)throw Error('Only one native AI turn may be active');
  const state=this.snapshot();
  if(state?.nativeCompatible!==true)return {status:'unsupported-special-event'};
  if(!state?.sessionId&&!Number.isInteger(state?.sessionId))
   throw Error('Game session ID is required');
  if(!Number.isSafeInteger(state?.version)||state.version<0)
   throw Error('Board revision is required');
  if(typeof state.sfen!=='string'||!state.sfen.trim())
   throw Error('Valid game SFEN required');
  if(!Array.isArray(state.holes)||!state.holes.every(x=>typeof x==='string'))
   throw Error('Obstacle squares required');
  if(!Array.isArray(state.legalUsiMoves))throw Error('Game-side legal move list required');
  if(state.legalUsiMoves.length===0)return {status:'no-legal-move'};
  if(!Number.isFinite(state.clockRemainingMs)||state.clockRemainingMs<=0)
   return {status:'clock-expired'};
  const token=++this.epoch;
  this.active=true;
  const board={sessionId:state.sessionId,version:state.version,sfen:state.sfen,
   holes:[...state.holes],legalUsiMoves:[...state.legalUsiMoves],
   clockRemainingMs:state.clockRemainingMs};
  const started=this.now();
  try{
   const result=await this.controller.think({
    sfen:board.sfen,holes:board.holes,clockRemainingMs:board.clockRemainingMs,
    movetimeMs,depth
   });
   if(token!==this.epoch||this.closed)return {status:'cancelled'};
   const current=this.snapshot();
   if(!current||current.nativeCompatible!==true||
    current.sessionId!==board.sessionId||
    current.version!==board.version||
    current.sfen!==board.sfen||
    !sameHoles(current.holes,board.holes))return {status:'stale-position'};
   const legal=new Set(current.legalUsiMoves);
   if(!board.legalUsiMoves.includes(result?.bestmove)||!legal.has(result.bestmove))
    return {status:'illegal-or-changed-move'};
   const elapsedMs=this.now()-started;
   const wallClockRemaining=Math.min(board.clockRemainingMs-elapsedMs,
    Number(current.clockRemainingMs));
   if(!Number.isFinite(wallClockRemaining)||wallClockRemaining<=0||
      (result.remainingClockMs!==null&&result.remainingClockMs!==undefined&&result.remainingClockMs<=0))
    return {status:'clock-expired'};
   // applyMove MUST be synchronous and game-authoritative, returning true
   // only if it actually applied this legal move to the expected revision.
   const accepted=this.applyMove(result.bestmove,{
    sessionId:board.sessionId,version:board.version,
    expectedSfen:board.sfen,expectedHoles:board.holes
   });
   if(accepted!==true)return {status:'move-rejected-by-game'};
   return {status:'played',bestmove:result.bestmove,elapsedMs,
    remainingMs:wallClockRemaining,depth:result.depth??null};
  }catch(error){
   if(token!==this.epoch||aborted(error))return {status:'cancelled'};
   if(/Clock exhausted/.test(String(error.message)))return {status:'clock-expired'};
   // Errors are surfaced rather than silently replaced with bad/fake moves.
   throw error;
  }finally{
   if(this.epoch===token)this.active=false;
  }
 }
}
