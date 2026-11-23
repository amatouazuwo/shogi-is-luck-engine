import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,appendFileSync} from 'node:fs';

// Compare the same archived tactical problems at the same search budget.
// Every improved or regressed item retains its identity for follow-up.
// Tactical correctness does not prove overall playing strength.
const [candidatePath,baselinePath,budgetText='100'] = process.argv.slice(2);
assert.ok(candidatePath&&baselinePath,'Usage: node tactical-delta.mjs candidate.jsonl baseline.jsonl [budget]');
const budget=Number(budgetText);
assert.ok([100,500,1500].includes(budget),'Unsupported budget');
function load(path) {
 const records=readFileSync(path,'utf8').split('\n').filter(Boolean).map(JSON.parse);
 const configs=records.filter(x=>x.event==='config');
 assert.equal(configs.length,1,'Expected one candidate config in '+path);
 const config=configs[0];
 const trials=records.filter(x=>x.event==='trial'&&x.budget===budget);
 const allTrials=records.filter(x=>x.event==='trial');
 assert.equal(trials.length,config.positions,'Every target-budget position must appear once');
 assert.ok(allTrials.every(x=>x.legal===true&&!x.error&&!x.timeout),'Illegal or failed tactical trial in '+path);
 const byId=new Map();
 for(const t of trials) {
  assert.ok(typeof t.id==='string' && typeof t.category==='string' && typeof t.kind==='string');
  assert.equal(typeof t.success,'boolean');
  assert.ok(!byId.has(t.id),'Duplicate ID '+t.id);
  byId.set(t.id,t);
 }
 return {config,byId};
}
const a=load(candidatePath),b=load(baselinePath);
assert.equal(a.config.corpusSha256,b.config.corpusSha256,'Different corpora');
assert.equal(a.byId.size,b.byId.size,'Different item counts');
assert.deepEqual([...a.byId.keys()].sort(),[...b.byId.keys()].sort(),'Different item IDs');
const groups=new Map(),changes=[];
for(const [id,c] of a.byId) {
 const p=b.byId.get(id);
 assert.equal(c.kind,p.kind,'Board kind mismatch: '+id);
 assert.equal(c.category,p.category,'Problem category mismatch: '+id);
 const group=c.kind+'/'+c.category;
 if(!groups.has(group))groups.set(group,{group,category:c.category,kind:c.kind,total:0,candidateCorrect:0,baselineCorrect:0,improved:0,regressed:0,unchanged:0});
 const s=groups.get(group);s.total++;
 if(c.success)s.candidateCorrect++;
 if(p.success)s.baselineCorrect++;
 const change=c.success&&!p.success?'improved':!c.success&&p.success?'regressed':'unchanged';
 s[change]++;
 if(change!=='unchanged')changes.push({id,group,change,candidateMove:c.move,baselineMove:p.move,
  candidateCorrect:c.success,baselineCorrect:p.success});
}
const byCategory=new Map();
for(const g of groups.values()) {
 if(!byCategory.has(g.category))byCategory.set(g.category,{category:g.category,total:0,candidateCorrect:0,baselineCorrect:0,improved:0,regressed:0,unchanged:0});
 const dest=byCategory.get(g.category);
 for(const key of ['total','candidateCorrect','baselineCorrect','improved','regressed','unchanged'])dest[key]+=g[key];
}
const sort=(x,y)=>x.category.localeCompare(y.category)||(x.kind??'').localeCompare(y.kind??'');
const summary={schema:1,budgetMs:budget,corpusSha256:a.config.corpusSha256,
 candidateWasmSha256:a.config.wasmSha256,baselineWasmSha256:b.config.wasmSha256,
 candidateWorkerSha256:a.config.workerSha256,baselineWorkerSha256:b.config.workerSha256,
 total:a.byId.size,byCategory:[...byCategory.values()].sort(sort),
 byBoardCategory:[...groups.values()].sort(sort),
 changedProblems:changes.sort((x,y)=>x.id.localeCompare(y.id)),
 warning:'These are archived, previously seen tactical labels and not a fresh holdout, a mathematical blunder proof, a complete game-rules proof, or evidence of overall improved playing strength. Regressions must be investigated, not ignored.'};
mkdirSync('results',{recursive:true});
writeFileSync('results/tactical-delta.json',JSON.stringify(summary,null,2)+'\n');
const lines=['## Paired tactical regression diagnostic (ARCHIVED problems)',
 '| Category | Correct candidate / total | Correct baseline / total | Fixed | Regressed |',
 '|---|---:|---:|---:|---:|',
 ...summary.byCategory.map(g=>'| '+g.category+' | '+g.candidateCorrect+'/'+g.total+' | '+g.baselineCorrect+'/'+g.total+' | '+g.improved+' | '+g.regressed+' |'),
 'Changes are by problem identity, not independent paired matches. This is not a promotion decision.'];
const md=lines.join('\n')+'\n';
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,md);
console.log(md);
