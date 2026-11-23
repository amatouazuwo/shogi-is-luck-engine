import assert from 'node:assert/strict';
import { readFileSync,writeFileSync } from 'node:fs';
const parseLines=path=>readFileSync(path,'utf8').trim().split('\n').map(JSON.parse);
const suites=[
  {id:'primary',corpus:'corpus.jsonl',result:'worker-results.jsonl',proof:'oracle-verification.json',count:100},
  {id:'evasion',corpus:'evade-supplement.jsonl',result:'evade-worker-results.jsonl',proof:'evade-oracle-verification.json',count:16},
  {id:'mate-in-three',corpus:'mate-three-corpus.jsonl',result:'mate-three-worker-results.jsonl',proof:'mate-three-oracle-verification.json',count:12},
];
const score=(trials)=>{
  const active=trials.filter(x=>!x.terminal);
  const count=predicate=>trials.filter(predicate).length;
  const mean=(list,key)=>list.length?list.reduce((sum,x)=>sum+(x[key]??0),0)/list.length:null;
  return {
    count:trials.length,correct:count(x=>x.success),active:active.length,
    activeCorrect:active.filter(x=>x.success).length,meanWallMs:mean(active,'wallMs'),
    meanDepth:mean(active,'depth'),meanNodes:mean(active,'nodes'),
    illegal:count(x=>x.legal===false),unexpectedResignation:count(x=>x.resign&&!x.terminal),
    errors:count(x=>x.error&&!x.timeout),timeout:count(x=>x.timeout),overBudgetBy50:count(x=>x.overBudgetBy50),
    throttled:count(x=>x.throttlingIntervals),maxWallMs:Math.max(...trials.map(x=>x.wallMs||0)),
  };
};
const allExamples=[
  'pit/mate-in-one/01',
  'blackhole/evade-supplement/1/2',
  'pit/material-gain/01',
  'blackhole/ray-blocking/01',
  'pit/no-legal-loss/01',
  'blackhole/mate-in-three/0/1',
];
const examples=[];
const analyses=[];
for(const suite of suites){
  const corpus=parseLines(suite.corpus);
  const results=parseLines(suite.result);
  const proof=JSON.parse(readFileSync(suite.proof));
  const config=results.find(r=>r.event==='config');
  const trials=results.filter(r=>r.event==='trial');
  assert.equal(corpus.length,suite.count);
  assert.equal(trials.length,suite.count*config.budgets.length);
  assert.equal(config.corpusSha256,proof.corpusSha256);
  const budgets=Object.fromEntries([...Map.groupBy(trials,r=>r.budget)].map(([budget,rows])=>[
    budget,{all:score(rows),strata:Object.fromEntries([...Map.groupBy(rows,r=>r.kind+'/'+r.category)].map(([group,data])=>[group,score(data)]))}
  ]));
  analyses.push({id:suite.id,config,proof,budgets});
  for(const puzzle of corpus.filter(puzzle=>allExamples.includes(puzzle.id))){
    const {available,...example}=puzzle;
    examples.push({...example,legalMovesCount:available.length,movesByBudget:Object.fromEntries(trials.filter(x=>x.id===puzzle.id).map(x=>[x.budget,x.move]))});
  }
}
examples.sort((a,b)=>allExamples.indexOf(a.id)-allExamples.indexOf(b.id));
assert.equal(examples.length,allExamples.length);
writeFileSync('tactical-summary.json',JSON.stringify({analyses,examples},null,2)+'\n');
const columns=['suite','budget_ms','hazard_and_category','trials','correct','active_trials','active_correct','mean_active_depth','mean_active_nodes','mean_active_wall_ms','illegal','hard_timeouts','over_budget_50ms','cgroup_throttled'];
const lines=[columns.join(',')];
for(const {id,budgets} of analyses){
  for(const [ms,{all,strata}] of Object.entries(budgets)){
    for(const [category,row] of Object.entries({all,...strata})){
      lines.push([id,ms,category,row.count,row.correct,row.active,row.activeCorrect,row.meanDepth,row.meanNodes,row.meanWallMs,row.illegal,row.timeout,row.overBudgetBy50,row.throttled].join(','));
    }
  }
}
writeFileSync('tactical-scorecard.csv',lines.join('\n')+'\n');
writeFileSync('tactical-examples.json',JSON.stringify(examples,null,2)+'\n');
for(const a of analyses){
  for(const [budget,{all}] of Object.entries(a.budgets)){
    console.log(a.id,budget,JSON.stringify(all));
  }
}
