import assert from 'node:assert/strict';
import test from 'node:test';
import {SafeRsshogiGameTurn} from './game-turn-adapter.mjs';

const standard=()=>({sessionId:'game-21',version:7,
 sfen:'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1',
 holes:['5e'],legalUsiMoves:['7g7f','2g2f'],
 clockRemainingMs:180000,nativeCompatible:true});
const answer={bestmove:'7g7f',depth:7,remainingClockMs:179700};
function fixture(opts={}){
 const state=standard(),applied=[];let time=0;
 const pending={resolve:null,reject:null};
 const controller={calls:[],cancellations:0,
  think(o){
   this.calls.push(o);
   if(opts.delayed)return new Promise((resolve,reject)=>{
    pending.resolve=resolve;pending.reject=reject;
   });
   return Promise.resolve(opts.answer??answer);
  },
  cancel(){
   this.cancellations++;
   if(pending.reject){
    pending.reject(Object.assign(new Error('rsshogi search cancelled'),{name:'AbortError'}));
    pending.reject=null;
   }
   return Promise.resolve();
  }
 };
 const adapter=new SafeRsshogiGameTurn({
  controller,snapshot:()=>state,
  applyMove:(move,expected)=>{
   applied.push({move,expected});
   return opts.rejectMove?false:true;
  },now:()=>time
 });
 return {state,applied,controller,adapter,pending,tick:delta=>{time+=delta;}};
}
test('plays exact current legal move with measured real wall-clock budget',async()=>{
 const x=fixture();
 x.tick(10);
 const result=await x.adapter.play({movetimeMs:100,depth:64});
 assert.equal(result.status,'played');
 assert.equal(result.bestmove,'7g7f');
 assert.equal(result.remainingMs,180000);
 assert.equal(x.applied.length,1);
 assert.equal(x.applied[0].expected.sessionId,'game-21');
 assert.equal(x.controller.calls[0].clockRemainingMs,180000);
 await x.adapter.close();
});
test('does not apply move if a new special-event board revision replaces the root',async()=>{
 const x=fixture({delayed:true});
 const pending=x.adapter.play();
 await Promise.resolve();
 assert.equal(x.controller.calls.length,1);
 x.state.version++;
 x.state.holes=['4e'];
 x.pending.resolve(answer);
 assert.equal((await pending).status,'stale-position');
 assert.equal(x.applied.length,0);
 await x.adapter.close();
});
test('explicit game navigation cancels old Worker search and prevents an obsolete move',async()=>{
 const x=fixture({delayed:true});
 const pending=x.adapter.play();await Promise.resolve();
 x.state.sessionId='game-22';
 await x.adapter.invalidate();
 assert.equal((await pending).status,'cancelled');
 assert.equal(x.applied.length,0);
 assert.equal(x.controller.cancellations,1);
 await x.adapter.close();
});
test('game-authoritative move list prevents a stale or unsupported AI move',async()=>{
 const x=fixture({answer:{bestmove:'5a4b',remainingClockMs:170000}});
 const result=await x.adapter.play();
 assert.equal(result.status,'illegal-or-changed-move');
 assert.equal(x.applied.length,0);
 await x.adapter.close();
});
test('clock expiry, including pre/post-processing, prohibits a legal move',async()=>{
 const x=fixture({delayed:true});
 const pending=x.adapter.play();await Promise.resolve();
 x.tick(180001);
 x.pending.resolve(answer);
 assert.equal((await pending).status,'clock-expired');
 assert.equal(x.applied.length,0);
 await x.adapter.close();
});
test('unsupported 1-percent event and a completed position do not dispatch rsshogi',async()=>{
 const x=fixture();
 x.state.nativeCompatible=false;
 assert.equal((await x.adapter.play()).status,'unsupported-special-event');
 x.state.nativeCompatible=true;
 x.state.legalUsiMoves=[];
 assert.equal((await x.adapter.play()).status,'no-legal-move');
 x.state.legalUsiMoves=['7g7f'];
 x.state.clockRemainingMs=0;
 assert.equal((await x.adapter.play()).status,'clock-expired');
 assert.equal(x.controller.calls.length,0);
 await x.adapter.close();
});
test('game may reject a native move without trying a fallback or fabricating a move',async()=>{
 const x=fixture({rejectMove:true});
 assert.equal((await x.adapter.play()).status,'move-rejected-by-game');
 assert.equal(x.applied.length,1);
 await x.adapter.close();
});
