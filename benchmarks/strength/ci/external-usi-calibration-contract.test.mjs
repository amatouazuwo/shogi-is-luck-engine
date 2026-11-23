import test from 'node:test';
import assert from 'node:assert/strict';
import {parseUsiHandshake,referenceSettings,parseUsiBestmove,
  scoreExternalNormalProbe} from './external-usi-calibration-contract.mjs';

const handshake=['id name Gikou 2','option name DepthLimit type spin default 100 min 1 max 100',
  'option name OwnBook type check default true',
  'option name Threads type spin default 1 min 1 max 32',
  'option name USI_Hash type spin default 256 min 1 max 16384','usiok'];

test('require real Gikou depth, threads and book controls',()=>{
 const h=parseUsiHandshake(handshake);
 assert.match(h.name,/Gikou/);
 const settings=referenceSettings(h,{depth:2});
 assert.equal(settings.depth,2);
 assert.ok(settings.commands.includes('setoption name OwnBook value false'));
 assert.ok(settings.commands.includes('setoption name DepthLimit value 2'));
 assert.throws(()=>referenceSettings({...h,options:[]}),/lacks documented/);
});
test('USI parser must reject illegal alternative or terminal move',()=>{
 assert.equal(parseUsiBestmove('bestmove 7g7f ponder 3c3d',['7g7f']),'7g7f');
 assert.throws(()=>parseUsiBestmove('bestmove resign',['7g7f']),/illegal/);
 assert.throws(()=>parseUsiBestmove('unknown',['7g7f']),/USI must/);
});
test('normal-board bestmove comparison cannot impersonate Elo',()=>{
 const rows=[0,1].map(i=>({sfen:'fixture-'+i,legal:['7g7f','2g2f'],
   referenceMove:'7g7f',
   candidates:[500,2000,10000,50000].map(n=>({
     nodesCap:n,actualNodes:n,bestmove:n<=2000?'2g2f':'7g7f',
     agreesWithReference:n>2000,
   })),
 }));
 const sc=scoreExternalNormalProbe(rows,{
   referenceName:'Gikou2',sourceTag:'v2.0.2',
   referenceSha256:'refhash',rsshogiWasmSha256:'wasmhash',referenceDepth:2});
 assert.equal(sc.positions,2);
 assert.deepEqual(sc.tiers.map(r=>r.agreements),[0,0,2,2]);
 assert.equal(sc.amateurRankCalibrated,false);
 rows[0].candidates[0].actualNodes=501;
 assert.throws(()=>scoreExternalNormalProbe(rows,{
   referenceName:'Gikou2',sourceTag:'v2.0.2',
   referenceSha256:'refhash',rsshogiWasmSha256:'wasmhash',referenceDepth:2}),/exceeded/);
});
