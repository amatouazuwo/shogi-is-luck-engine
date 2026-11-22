import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

// Archived, independently adjudicated obstacle problems, plus known forced-loss
// escapes. The corpus is NOT a newly sealed holdout for current development.
// Require per-position paired evidence, avoid pooling attack with defense.
const [pairFile,fixtureFile,outFile='results/verified-special-delta.json'] = process.argv.slice(2);
assert.ok(pairFile && fixtureFile,'Usage: node verified-special-delta.mjs PAIRS.jsonl FIXTURES.jsonl [OUTPUT.json]');
const hash=data=>createHash('sha256').update(data).digest('hex');
const bytes=readFileSync(fixtureFile);
const fixtures=bytes.toString('utf8').trim().split('\n').map(JSON.parse);
assert.ok(fixtures.length>0);
const fixtureById=new Map();
for(const x of fixtures) {
 assert.ok(typeof x.id==='string'&&!fixtureById.has(x.id),'Duplicate/missing fixture');
 assert.ok(['pit','blackhole'].includes(x.kind),'Unexpected board type');
 assert.ok(typeof x.category==='string','Missing category');
 assert.ok(Array.isArray(x.holes)&&Array.isArray(x.goodMoves)&&Array.isArray(x.available));
 assert.ok(x.goodMoves.length>0&&x.goodMoves.every(m=>x.available.includes(m)));
 if(x.proof!==undefined)assert.equal(x.proof.status,'ok','Unproved fixture');
 fixtureById.set(x.id,x);
}
const rows=readFileSync(pairFile,'utf8').trim().split('\n').map(JSON.parse);
const configurations=rows.filter(x=>x.event==='config');
assert.equal(configurations.length,1);
const config=configurations[0];
assert.equal(config.corpusSha256,hash(bytes),'Corpus SHA mismatch');
assert.equal(config.positions,fixtures.length,'Corpus count mismatch');
assert.equal(config.rounds,1,'Only one round per distinct case supported');
assert.ok(Array.isArray(config.budgets)&&config.budgets.length>0);
assert.ok(Array.isArray(config.sdk)&&config.sdk.length===2);
const sourceNames=config.sdk.map(s=>s.name);
assert.deepEqual(sourceNames.slice().sort(),['baseline','candidate']);
const trials=rows.filter(x=>x.event==='trial');
const lookup=new Map();
for(const trial of trials) {
 assert.ok(fixtureById.has(trial.id),'Unknown case '+trial.id);
 assert.ok(sourceNames.includes(trial.name),'Unknown SDK '+trial.name);
 assert.ok(config.budgets.includes(trial.budget),'Unexpected budget');
 assert.ok(!trial.error&&!trial.timeout&&trial.legal===true,'Invalid trial: '+trial.id);
 assert.equal(typeof trial.correct,'boolean');
 const f=fixtureById.get(trial.id);
 assert.equal(trial.kind,f.kind,'Board kind mismatch '+trial.id);
 assert.equal(trial.category,f.category,'Category mismatch '+trial.id);
 assert.equal(trial.correct,f.goodMoves.includes(trial.move),'Incorrect label attribution '+trial.id);
 const key=[trial.budget,trial.id,trial.name].join('/');
 assert.ok(!lookup.has(key),'Duplicate trial '+key);
 lookup.set(key,trial);
}
assert.equal(lookup.size,fixtures.length*config.budgets.length*2,'Incomplete paired results');
const cases=[],groups=new Map();
for(const budgetMs of config.budgets)for(const f of fixtures) {
 const candidate=lookup.get([budgetMs,f.id,'candidate'].join('/'));
 const baseline=lookup.get([budgetMs,f.id,'baseline'].join('/'));
 assert.ok(candidate&&baseline,'Missing trial pair');
 const part=f.category.startsWith('forced-loss-escape')||f.category.startsWith('avoid-forced-mate')?'defense':'attack';
 const outcome=candidate.correct&&!baseline.correct?'improved':
  !candidate.correct&&baseline.correct?'regressed':'unchanged';
 const entry={id:f.id,kind:f.kind,category:f.category,part,budgetMs,
  candidateMove:candidate.move,baselineMove:baseline.move,
  candidateCorrect:candidate.correct,baselineCorrect:baseline.correct,
  changedMove:candidate.move!==baseline.move,outcome,
  candidateDepth:candidate.depth??null,baselineDepth:baseline.depth??null};
 cases.push(entry);
 const key=[budgetMs,f.kind,part].join('/');
 if(!groups.has(key))groups.set(key,{budgetMs,kind:f.kind,part,
  total:0,candidateCorrect:0,baselineCorrect:0,improved:0,regressed:0,unchanged:0,changedMoves:0});
 const g=groups.get(key);g.total++;g[outcome]++;
 if(candidate.correct)g.candidateCorrect++;
 if(baseline.correct)g.baselineCorrect++;
 if(entry.changedMove)g.changedMoves++;
}
const summary=[...groups.values()].sort((a,b)=>a.budgetMs-b.budgetMs||
 a.kind.localeCompare(b.kind)||a.part.localeCompare(b.part));
const record={schema:1,sourceCorpus:fixtureFile,corpusSha256:config.corpusSha256,
 baselineWasmSha256:config.sdk.find(x=>x.name==='baseline').wasmSha256,
 candidateWasmSha256:config.sdk.find(x=>x.name==='candidate').wasmSha256,
 positionCount:fixtures.length,budgetsMs:config.budgets,byBoardAndPurpose:summary,cases,
 warning:'Archived, previously studied positions, NOT newly unseen cases. Forced-loss-escape labels concern only the fixed proof horizon. No skill improvement or promotion without additional genuinely new positions and paired games.'};
mkdirSync('results',{recursive:true});
writeFileSync(outFile,JSON.stringify(record,null,2)+'\n');
const lines=['## Independently labelled obstacle tactical comparisons (archived)',
 '| Budget | Board | Type | Candidate | Baseline | Fixed | Regressed | Moves changed |',
 '|---|---|---|---:|---:|---:|---:|---:|',
 ...summary.map(g=>'| '+g.budgetMs+'ms | '+g.kind+' | '+g.part+' | '+
 g.candidateCorrect+'/'+g.total+' | '+g.baselineCorrect+'/'+g.total+' | '+
 g.improved+' | '+g.regressed+' | '+g.changedMoves+' |'),
 'Archive-based and limited-horizon: not evidence of general playing strength.'];
const report=lines.join('\n')+'\n';
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,report);
console.log(report);
