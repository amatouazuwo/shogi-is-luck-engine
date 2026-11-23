import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';

// Adapt paired output from public self-contained heldout runner to the
// per-engine tactical-delta schema. No private game imports.
const [input='results/tactical-paired.jsonl']=process.argv.slice(2);
const rows=readFileSync(input,'utf8').split('\n').filter(Boolean).map(JSON.parse);
const configs=rows.filter(r=>r.event==='config');
assert.equal(configs.length,1,'Expected one paired-run config');
const config=configs[0];
assert.equal(config.rounds,1,'Expected exactly one trial per puzzle');
assert.deepEqual(config.budgets,[100],'Only 100ms tactical regression currently supported');
assert.ok(Array.isArray(config.sdk)&&config.sdk.length===2);
const trials=rows.filter(r=>r.event==='trial');
const expected=['candidate','baseline'];
assert.deepEqual(config.sdk.map(x=>x.name).sort(),expected.slice().sort(),'Missing candidate/baseline SDK');
mkdirSync('results',{recursive:true});
for(const name of expected){
 const sdk=config.sdk.find(x=>x.name===name);
 const own=trials.filter(x=>x.name===name);
 assert.equal(own.length,config.positions,'Incomplete engine trial coverage');
 const ids=new Set();
 for(const t of own){
  assert.ok(!ids.has(t.id),'Duplicate trial id: '+t.id);
  ids.add(t.id);
 }
 const head={event:'config',positions:config.positions,corpusSha256:config.corpusSha256,
  wasmSha256:sdk.wasmSha256,workerSha256:sdk.workerSha256};
 const converted=own.map(x=>({event:'trial',id:x.id,kind:x.kind,category:x.category,budget:x.budget,
  success:x.correct,legal:x.legal,move:x.move,timeout:x.timeout,error:x.error??null,
  depth:x.depth??null,nodes:x.nodes??null,wallMs:x.wallMs??null}));
 writeFileSync('results/tactical-'+name+'.jsonl',[head,...converted].map(JSON.stringify).join('\n')+'\n');
}
console.log('Split '+config.positions+' paired tactical items per SDK.');
