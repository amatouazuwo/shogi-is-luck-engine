import assert from 'node:assert/strict';
import test from 'node:test';
import {proveTerminal,candidateOutcome,verifyTerminalCertificate} from './terminal-proof.mjs';
const graph={
  mate:['forced'], forced:[],
  lose:['replyA','replyB'], replyA:['mateA'],replyB:['mateB'],
  mateA:[],mateB:[],
  uncertain:['a','b'],a:['c'],b:['d'],c:['e'],d:['f'],e:[],f:[],
  loop:['loop'],lots:['x','y','z'],x:[],y:[],z:[]
};
const legal=async p=>graph[p]??[];
const step=async (_p,_h,m)=>m;
test('terminal position is LOSS for player to move',async()=>{
 const x=await proveTerminal({sfen:'mateA',legal,step,depth:0});
 assert.equal(x.outcome,'LOSS');assert.equal(x.distance,0);
});
test('existential forced mate proves WIN',async()=>{
 const x=await proveTerminal({sfen:'mate',legal,step,depth:1});
 assert.equal(x.outcome,'WIN');assert.equal(x.distance,1);
 assert.equal(candidateOutcome(x.outcome),'LOSS');
});
test('all legal replies must be answered before proving LOSS',async()=>{
 const x=await proveTerminal({sfen:'lose',legal,step,depth:2});
 assert.equal(x.outcome,'LOSS');assert.equal(x.distance,2);
});
test('insufficient horizon returns UNKNOWN',async()=>{
 const x=await proveTerminal({sfen:'lose',legal,step,depth:1});
 assert.equal(x.outcome,'UNKNOWN');
});
test('node cap cannot produce an unsupported loss',async()=>{
 const x=await proveTerminal({sfen:'lose',legal,step,depth:4,nodeLimit:2});
 assert.equal(x.outcome,'UNKNOWN');assert.equal(x.exhausted,false);
});
test('repeated state is UNKNOWN without repetition adjudication',async()=>{
 const x=await proveTerminal({sfen:'loop',legal,step,depth:3});
 assert.equal(x.outcome,'UNKNOWN');
});

test('independent replay accepts an exhaustive WIN certificate',async()=>{
 const proof=await proveTerminal({sfen:'mate',legal,step,depth:1});
 assert.equal(proof.certificate.kind,'exists');
 const audit=await verifyTerminalCertificate({sfen:'mate',certificate:proof.certificate,legal,step});
 assert.equal(audit.outcome,'WIN');
 assert.equal(audit.valid,true);
});
test('independent replay accepts an all-replies LOSS certificate',async()=>{
 const proof=await proveTerminal({sfen:'lose',legal,step,depth:2});
 assert.equal(proof.certificate.kind,'forall');
 const audit=await verifyTerminalCertificate({sfen:'lose',certificate:proof.certificate,legal,step});
 assert.equal(audit.outcome,'LOSS');
});
test('a missing defender reply invalidates an alleged forced loss',async()=>{
 const proof=await proveTerminal({sfen:'lose',legal,step,depth:2});
 const tampered=structuredClone(proof.certificate);
 tampered.children.pop();
 await assert.rejects(
  verifyTerminalCertificate({sfen:'lose',certificate:tampered,legal,step}),
  /Universal proof must cover ALL legal moves/
 );
});
test('an altered SFEN invalidates a certificate',async()=>{
 const proof=await proveTerminal({sfen:'mate',legal,step,depth:1});
 const tampered=structuredClone(proof.certificate);
 tampered.child.sfen='different';
 await assert.rejects(
  verifyTerminalCertificate({sfen:'mate',certificate:tampered,legal,step}),
  /Certificate position mismatch/
 );
});
test('UNKNOWN never produces a claimed certificate',async()=>{
 const proof=await proveTerminal({sfen:'lose',legal,step,depth:1});
 assert.equal(proof.outcome,'UNKNOWN');
 assert.equal(proof.certificate,null);
});
