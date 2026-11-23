// Browser-compatible experimental parent controller for native continuous rsshogi.
// It is NOT connected to the deployed game. A synchronous C/WASM search cannot
// service 'stop': cancel by terminating its entire Worker, discard old replies,
// and rebuild on the next request. Never return a fabricated move on abort.
const aborted=(message='rsshogi search cancelled')=>Object.assign(new Error(message),{name:'AbortError'});
export class ContinuousSearchController {
 constructor({createWorker,wasm,hashMb=16,commandTimeoutMs=15000,searchGraceMs=1750}={}){
  if(typeof createWorker!=='function')throw TypeError('createWorker required');
  if(!wasm)throw TypeError('rsshogi WASM is required');
  if(!Number.isInteger(hashMb)||hashMb<1)throw RangeError('Invalid hash memory');
  this.createWorker=createWorker;this.wasm=wasm;this.hashMb=hashMb;
  this.commandTimeoutMs=commandTimeoutMs;this.searchGraceMs=searchGraceMs;
  this.session=null;this.active=null;this.nextRequestId=0;this.restarting=Promise.resolve();
  this.closed=false;this.workerStarts=0;
 }
 _current(op){
  if(this.closed)throw aborted('Controller closed');
  if(op.cancelled||this.active!==op)throw aborted();
 }
 _discard(error=aborted()){
  const old=this.session;this.session=null;
  if(!old)return this.restarting;
  old.worker.onmessage=null;old.worker.onerror=null;
  for(const request of old.pending.values())request.reject(error);
  old.pending.clear();
  let terminated;
  try{terminated=old.worker.terminate();}catch(e){terminated=Promise.reject(e);}
  this.restarting=Promise.allSettled([this.restarting,Promise.resolve(terminated)]).then(()=>{});
  return this.restarting;
 }
 cancel(){
  if(this.active)this.active.cancelled=true;
  this.active=null;
  return this._discard(aborted());
 }
 async close(){this.closed=true;await this.cancel();}
 _receive(session,message){
  if(this.session!==session||!message||message.event==='info')return;
  session.pending.get(message.id)?.resolve(message);
 }
 _send(session,command,fields={},timeout=this.commandTimeoutMs){
  if(this.session!==session)return Promise.reject(aborted());
  const id=++this.nextRequestId;
  return new Promise((resolve,reject)=>{
   let done=false,timer;
   const finish=(err,value)=>{
    if(done)return;done=true;clearTimeout(timer);session.pending.delete(id);
    if(err)reject(err);
    else if(value?.ok===false)reject(Error(String(value.error??'Worker command failed')));
    else resolve(value?.result);
   };
   session.pending.set(id,{resolve:value=>finish(null,value),reject:err=>finish(err)});
   timer=setTimeout(()=>{
    const err=Error('rsshogi '+command+' timed out');
    finish(err);this._discard(err);
   },timeout);
   try{session.worker.postMessage({id,command,...fields});}
   catch(err){finish(err);this._discard(err);}
  });
 }
 async _ready(op){
  if(this.session)return this.session;
  await this.restarting;this._current(op);
  const worker=this.createWorker();
  if(!worker||typeof worker.postMessage!=='function'||typeof worker.terminate!=='function')
   throw TypeError('Expected browser-style Worker');
  const session={worker,pending:new Map()};
  this.session=session;this.workerStarts++;
  worker.onmessage=event=>this._receive(session,event.data);
  worker.onerror=event=>this._discard(Error('rsshogi Worker failed: '+String(event?.message??event)));
  try{
   await this._send(session,'init',{wasm:this.wasm,hash_mb:this.hashMb});
   this._current(op);return session;
  }catch(err){this._discard(err);throw err;}
 }
 async think({sfen,holes=[],depth=64,movetimeMs=100,clockRemainingMs,signal}={}){
  if(this.closed)throw aborted('Controller closed');
  if(this.active)throw Error('Another native search is already running');
  if(typeof sfen!=='string'||!sfen.trim())throw TypeError('SFEN required');
  if(!Array.isArray(holes)||holes.some(x=>typeof x!=='string'))throw TypeError('Invalid obstacle mask');
  if(!Number.isInteger(depth)||depth<1||depth>64)throw RangeError('Depth must be 1..64');
  if(!Number.isSafeInteger(movetimeMs)||movetimeMs<1)throw RangeError('Invalid time limit');
  if(clockRemainingMs!==undefined&&(!Number.isFinite(clockRemainingMs)||clockRemainingMs<=0))
   throw Error('Clock exhausted; no move can be played');
  const budget=clockRemainingMs===undefined?movetimeMs:
   Math.max(1,Math.min(movetimeMs,Math.floor(clockRemainingMs/20),Math.floor(clockRemainingMs-150)));
  const op={cancelled:false};this.active=op;
  const onAbort=()=>{void this.cancel();};
  if(signal){
   if(signal.aborted)onAbort();
   else signal.addEventListener('abort',onAbort,{once:true});
  }
  const started=performance.now();
  try{
   this._current(op);
   const session=await this._ready(op);this._current(op);
   await this._send(session,'position',{sfen,holes,moves:[]});this._current(op);
   const raw=await this._send(session,'legalMoves');this._current(op);
   const legal=Array.isArray(raw)?raw:raw?.result;
   if(!Array.isArray(legal)||legal.length===0)throw Error('No legal moves or invalid reply');
   const result=await this._send(session,'go',{depth,movetime_ms:budget},budget+this.searchGraceMs);
   this._current(op);
   if(!result||!legal.includes(result.bestmove))
    throw Error('Engine returned an illegal or missing move');
   const elapsedWallMs=performance.now()-started;
   // The game's 3-minute clock includes Worker startup, message handling,
   // position setup and JS/WASM search. Never publish a legal move *after*
   // that remaining wall clock has expired, even if native search stayed
   // within its per-move budget. The outer game clock remains authoritative.
   if(clockRemainingMs!==undefined&&elapsedWallMs>=clockRemainingMs)
    throw Error('Clock exhausted during search; no move may be applied');
   return {...result,requestedSearchMs:budget,elapsedWallMs,
    remainingClockMs:clockRemainingMs===undefined?null:clockRemainingMs-elapsedWallMs};
  }catch(err){if(this.active===op)this._discard(err);throw err;}
  finally{
   if(signal)signal.removeEventListener('abort',onAbort);
   if(this.active===op)this.active=null;
  }
 }
}
