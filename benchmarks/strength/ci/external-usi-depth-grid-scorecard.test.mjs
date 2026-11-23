import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {planTurn} from './clock-budget.mjs';
import {auditNormalReferenceGrid,PINNED_GIKOU_PARAMS_SHA}
 from './external-usi-depth-grid-scorecard.mjs';
import {FOUR_DAN_PROVISIONAL_GIKOU} from './gikou-reference-proxies.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');

function sample(){
 const fixtures=[8,9].map(pair=>({event:'opening',pair,
  family:'hirate',opening:'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - '+pair,
  legal:30}));
 const raw=fixtures.map(JSON.stringify).join('\n')+'\n';
 const config={
   event:'gikou-normal-match-config',name:'Gikou 2 (v2.0.2)',
   tag:'v2.0.2',depthLimit:2,book:false,threads:1,
   referenceUsesDepthInsteadOfTimeLimit:true,
   referenceHash:'a'.repeat(64),referenceParamsHash:PINNED_GIKOU_PARAMS_SHA,
   nnueHash:'b'.repeat(64),workerHash:'c'.repeat(64),corpusHash:hash(raw),
   fixtureIds:[8,9],nodeTiers:[1000,2000],clockMs:180000,
   nominalStudentMs:1000,clockDivisor:20,preMoveDelayMs:1300,
   maxPlies:300,outcomeIfRepetition:'neutral-unadjudicated',
   noHumanRankClaim:true};
 const games=[];
 for(const nodeCap of [1000,2000])for(const f of fixtures)for(const candidateSide of [0,1]){
   const balances=[180000,180000],turns=[];
   for(let ply=0;ply<2;ply++){
     const side=ply,engine=side===candidateSide?'rsshogi':'gikou2';
     const search=planTurn({remainingMs:balances[side],nominalMs:1000,divisor:20,
       preMoveDelayMs:1300});
     const elapsedMs=engine==='rsshogi'?17:3;
     const charge=elapsedMs+search.preMoveDelayChargedMs;
     const turn={
       ply,side,engine,sfenBefore:f.opening.replace(' b ',ply===0?' b ':' w '),
       move:ply===0?'7g7f':'3c3d',
       elapsedMs,depth:engine==='rsshogi'?4:null,
       nodes:engine==='rsshogi'?nodeCap:null,
       nodeCap:engine==='rsshogi'?nodeCap:null,
       studentRequestMs:engine==='rsshogi'?search.searchMs:null,
       chargedMs:charge,clockBeforeMs:balances[side],
       clockAfterTurnMs:balances[side]-charge,
     };
     balances[side]-=charge;turns.push(turn);
   }
   const neutral=f.pair===9;
   games.push({event:'gikou-normal-match-game',nodesCap:nodeCap,pair:f.pair,
     candidateSide,start:f.opening,clocks:balances,
     winner:neutral?null:0,reason:neutral?'repetition-unadjudicated':'no-legal',
     turns});
 }
 const summaries=[1000,2000].map(nodesCap=>({
   event:'gikou-normal-match-summary',depthLimit:2,nodesCap,
   games:4,rsshogiWins:1,gikouWins:1,neutralUndecided:2,
   scoreBoundsIncludingNeutral:[0.25,0.75],
   externallyCertifiedAmateurGrade:false,
 }));
 return {raw,events:[config,...games,...summaries]};
}

const options={expectedDepth:2,expectedTiers:[1000,2000],expectedIds:[8,9]};
test('paired outcomes, color reversals and honest score bounds pass',()=>{
 const {raw,events}=sample();const s=auditNormalReferenceGrid(events,raw,options);
 assert.equal(s.totalGames,8);
 assert.equal(s.results.length,2);
 assert.equal(s.results[0].gikouWins,1);
 assert.equal(s.results[0].neutralUndecided,2);
 assert.equal(s.amateurGradeAssigned,false);
 assert.equal(s.results[0].byCandidateColor[0].games,2);
});
test('changing params, original corpus or depth is prohibited',()=>{
 const a=sample();a.events[0].referenceParamsHash='a'.repeat(64);
 assert.throws(()=>auditNormalReferenceGrid(a.events,a.raw,options),/Unpinned external eval/);
 const b=sample();b.events[0].corpusHash='0'.repeat(64);
 assert.throws(()=>auditNormalReferenceGrid(b.events,b.raw,options),/Changed original/);
 const c=sample();c.events[0].depthLimit=4;
 assert.throws(()=>auditNormalReferenceGrid(c.events,c.raw,options));
});
test('a fabricated 300ply win, missing reversal and wrong score fail',()=>{
 const a=sample();a.events[4].winner=0;
 assert.throws(()=>auditNormalReferenceGrid(a.events,a.raw,options),/neutral/);
 const b=sample();b.events.splice(2,1);
 assert.throws(()=>auditNormalReferenceGrid(b.events,b.raw,options),/both candidate colors/);
 const c=sample();c.events.at(-1).rsshogiWins=2;
 assert.throws(()=>auditNormalReferenceGrid(c.events,c.raw,options));
});
test('native depth/node cap and game clock are audited on every move',()=>{
 const a=sample();
 const game=a.events.find(x=>x.event==='gikou-normal-match-game'&&x.candidateSide===0);
 game.turns[0].nodes=1001;
 assert.throws(()=>auditNormalReferenceGrid(a.events,a.raw,options),/exceeded node cap/);
 const b=sample();
 const t=b.events.find(x=>x.event==='gikou-normal-match-game').turns[0];
 t.chargedMs=5;
 assert.throws(()=>auditNormalReferenceGrid(b.events,b.raw,options),/Pre-move time/);
 const c=sample();
 c.events[0].referenceUsesDepthInsteadOfTimeLimit=false;
 assert.throws(()=>auditNormalReferenceGrid(c.events,c.raw,options),/Reference is limited by DEPTH/);
});

test('depth8 is shown only as an explicitly provisional amateur fourth-dan comparison',()=>{
 const {raw,events}=sample();
 events[0].depthLimit=8;
 events[0].referenceProxy=FOUR_DAN_PROVISIONAL_GIKOU;
 for(const summary of events.filter(x=>x.event==='gikou-normal-match-summary'))
   summary.depthLimit=8;
 const r=auditNormalReferenceGrid(events,raw,{...options,expectedDepth:8});
 assert.equal(r.provisionalReference.label,'アマ四段程度（仮）');
 assert.equal(r.amateurGradeAssigned,false);
 assert.equal(r.humanValidationRequested,false);
 const changed=sample();changed.events[0].depthLimit=8;
 assert.throws(()=>auditNormalReferenceGrid(changed.events,changed.raw),
   /Provisional reference rank label must match/);
});
