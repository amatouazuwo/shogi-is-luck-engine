import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { canonical, loadPrior } from './position-audit.mjs';

const source='unseen-defense.jsonl';
const raw=readFileSync(source);
const fixtures=raw.toString('utf8').trim().split('\n').map(JSON.parse);
const prior=loadPrior();
const seen=new Set();
const sha256=content=>createHash('sha256').update(content).digest('hex');
const strata={};
const families={};
const roots={inCheck:0,notInCheck:0};
const stats={minPieces:Infinity,maxPieces:0,meanPieces:0,minMoves:Infinity,maxMoves:0,totalGoodMoves:0,totalUnsafeMoves:0};
assert.equal(fixtures.length,12);
for(const row of fixtures){
  const key=canonical(row);
  assert.ok(!prior.has(key),row.id+' archived identity');
  assert.ok(!seen.has(key),row.id+' repeated identity');
  seen.add(key);
  const stratum=[row.kind,row.horizon,row.side].join('/');
  strata[stratum]=(strata[stratum]||0)+1;
  families[row.family]=(families[row.family]||0)+1;
  roots[row.inCheck?'inCheck':'notInCheck']++;
  stats.minPieces=Math.min(stats.minPieces,row.pieces);
  stats.maxPieces=Math.max(stats.maxPieces,row.pieces);
  stats.meanPieces+=row.pieces/fixtures.length;
  stats.minMoves=Math.min(stats.minMoves,row.available.length);
  stats.maxMoves=Math.max(stats.maxMoves,row.available.length);
  stats.totalGoodMoves+=row.goodMoves.length;
  stats.totalUnsafeMoves+=Object.keys(row.proof.lossPliesAfterDefense).length;
}
for(const hazard of ['pit','blackhole'])for(const h of [3,5,7])for(const side of [0,1]){
  assert.equal(strata[[hazard,h,side].join('/')],1);
}
const siblings={};
for(const path of process.argv.slice(2)){
  if(!existsSync(path))continue;
  const items=readFileSync(path,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  for(const item of items)assert.ok(!seen.has(canonical(item)),item.id+' shared attack/defense root');
  siblings[path]=items.length;
}
const metadata=JSON.parse(readFileSync(source+'.metadata.json','utf8'));
const digest=sha256(raw);
assert.equal(digest,metadata.sha256);
const provenance=JSON.parse(readFileSync('source-provenance.json','utf8'));
assert.equal(metadata.generatorSha256,provenance.original['generate-defense.mjs']);
assert.equal(provenance.portable['generate-defense.mjs'],sha256(readFileSync('generate-defense.mjs')));
console.log(JSON.stringify({rows:fixtures.length,sha256:digest,seed:metadata.seed,
  archiveKeys:prior.size,archiveSha256:sha256(readFileSync('prior-special-identities.json')),
  archiveOverlaps:0,withinDefenseSymmetryOverlaps:0,siblingOverlaps:0,siblings,strata,families,roots,stats},null,2));
