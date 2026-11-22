import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,appendFileSync} from 'node:fs';
import {dirname} from 'node:path';

// Only a schedule-level change is permitted: the compared WASM/NNUE binaries
// must be BYTE-IDENTICAL. Keep unfinished games neutral and never score them
// as losses/draws, including repetition not adjudicated by the game.
const [outPath,...files]=process.argv.slice(2);
assert.ok(outPath&&files.length,'Usage: node report.mjs OUTPUT.json GAME1.jsonl [...]');
const avg=x=>x.length?x.reduce((a,b)=>a+b,0)/x.length:null;
const percentile=(x,p)=>x.length?[...x].sort((a,b)=>a-b)[Math.ceil(p*x.length)-1]:null;
const result={schema:1,files,groups:[],total:{games:0,wins:0,losses:0,undecided:0,
 completeColorPairs:0,incompleteColorPairs:0,illegalMoves:0,changedRootMoves:0},
 warning:'UNDECIDED is neutral, not a loss or inferior play. Search-depth improvements and archived opening results alone never justify deployment. Continuous synchronous WASM cannot accept stop until search returns.'};
const collate=(rows,role,budget)=> {
 const plies=rows.flatMap(x=>x.turns.filter(t=>t.engine===role));
 const elapsed=plies.map(x=>x.elapsed);
 const nodes=plies.map(x=>x.nodes).filter(Number.isFinite);
 const depths=plies.map(x=>x.depth).filter(Number.isFinite);
 const totalNodes=nodes.reduce((a,b)=>a+b,0);
 const totalElapsed=elapsed.reduce((a,b)=>a+b,0);
 return {moves:plies.length,meanDepth:avg(depths),meanNodes:avg(nodes),
  meanWallMs:avg(elapsed),p95WallMs:percentile(elapsed,.95),maxWallMs:elapsed.length?Math.max(...elapsed):null,
  meanNodesPerSecond:totalElapsed>0?totalNodes/(totalElapsed/1000):null,
  budgetOverrun50:elapsed.filter(x=>x>budget+50).length,
  budgetOverrun200:elapsed.filter(x=>x>budget+200).length,
  missingResultFields:plies.filter(x=>!Number.isFinite(x.depth)||!Number.isFinite(x.nodes)||!Number.isFinite(x.elapsed)).length};
};
for(const file of files){
 const events=readFileSync(file,'utf8').trim().split('\n').map(JSON.parse);
 const configurations=events.filter(x=>x.event==='config');
 assert.equal(configurations.length,1,'Expected one config for '+file);
 const config=configurations[0];
 assert.equal(config.opponent,'baseline');
 assert.equal(config.candidateSha,config.baselineSha,'WASM mismatch in continuous scheduling experiment');
 assert.notEqual(config.candidateWorkerSha,config.baselineWorkerSha,'Worker candidates are not distinct');
 assert.ok([100,500,1500].includes(config.budget));
 const games=events.filter(x=>x.event==='game');
 assert.equal(games.length,4*config.pairs,'Incomplete paired games in '+file);
 const cases=new Map(),statistics={wins:0,losses:0,undecided:0,decidedReasons:{},undecidedReasons:{},byKind:[]};
 for(const g of games){
  assert.ok(['pit','blackhole'].includes(g.kind));
  assert.ok([0,1].includes(g.candidateSide));
  assert.ok(g.winner===null||[0,1].includes(g.winner));
  assert.ok(Array.isArray(g.turns)&&g.turns.length<=config.cap);
  const key=[g.pair,g.kind].join('/');
  if(!cases.has(key))cases.set(key,[]);
  cases.get(key).push(g);
  if(g.winner===null){
   assert.ok(['ply-cap','repetition-unadjudicated'].includes(g.reason),'Unexpected unadjudicated end reason');
   statistics.undecided++;
   statistics.undecidedReasons[g.reason]=(statistics.undecidedReasons[g.reason]??0)+1;
  }else{
   assert.ok(['no-legal','clock','resign'].includes(g.reason),'Unexpected adjudicated end reason');
   statistics[g.winner===g.candidateSide?'wins':'losses']++;
   statistics.decidedReasons[g.reason]=(statistics.decidedReasons[g.reason]??0)+1;
  }
  for(const ply of g.turns)assert.ok(['candidate','opponent'].includes(ply.engine));
 }
 assert.equal(cases.size,2*config.pairs);
 const paired={complete:0,incomplete:0,candidateSweeps:0,baselineSweeps:0,splits:0,firstMoveDifferences:0};
 for(const [key,gamesOfPair] of cases){
  assert.equal(gamesOfPair.length,2,'Missing reverse color assignment '+key);
  const a=gamesOfPair.find(x=>x.candidateSide===0),b=gamesOfPair.find(x=>x.candidateSide===1);
  assert.ok(a&&b,'Both colors required '+key);
  assert.equal(a.start,b.start,'Different root SFEN '+key);
  assert.deepEqual(a.holes,b.holes,'Different hole mask '+key);
  assert.ok(a.turns[0]&&b.turns[0],'No first move '+key);
  if(a.turns[0].move!==b.turns[0].move)paired.firstMoveDifferences++;
  if(a.winner===null||b.winner===null)paired.incomplete++;
  else{
   paired.complete++;
   const n=[a,b].filter(x=>x.winner===x.candidateSide).length;
   if(n===2)paired.candidateSweeps++;
   else if(n===0)paired.baselineSweeps++;
   else paired.splits++;
  }
 }
 for(const kind of ['pit','blackhole']){
  const subset=games.filter(x=>x.kind===kind);
  statistics.byKind.push({kind,games:subset.length,
   wins:subset.filter(x=>x.winner!==null&&x.winner===x.candidateSide).length,
   losses:subset.filter(x=>x.winner!==null&&x.winner!==x.candidateSide).length,
   undecided:subset.filter(x=>x.winner===null).length});
 }
 const group={file,budget:config.budget,cap:config.cap,openingPairs:config.pairs,
  wasmSha:config.candidateSha,candidateWorkerSha:config.candidateWorkerSha,
  baselineWorkerSha:config.baselineWorkerSha,
  ...statistics,paired,
  candidateSearch:collate(games,'candidate',config.budget),
  baselineSearch:collate(games,'opponent',config.budget)};
 result.groups.push(group);
 result.total.games+=games.length;
 for(const k of ['wins','losses','undecided'])result.total[k]+=statistics[k];
 result.total.completeColorPairs+=paired.complete;
 result.total.incompleteColorPairs+=paired.incomplete;
 result.total.changedRootMoves+=paired.firstMoveDifferences;
}
assert.equal(result.total.wins+result.total.losses+result.total.undecided,result.total.games);
const lines=[
'## Native continuous-search experiment (identical rsshogi WASM)',
'| Experiment | Wins | Losses | Neutral undecided | Complete swapped pairs | Avg depth candidate / baseline | >budget+50ms candidate / baseline |',
'|---|---:|---:|---:|---:|---:|---:|',
...result.groups.map(g=>'| '+g.budget+'ms / '+g.cap+' ply / '+g.file+' | '+g.wins+' | '+g.losses+' | '+g.undecided+
 ' | '+g.paired.complete+'/'+(g.paired.complete+g.paired.incomplete)+' | '+
 g.candidateSearch.meanDepth?.toFixed(2)+' / '+g.baselineSearch.meanDepth?.toFixed(2)+' | '+
 g.candidateSearch.budgetOverrun50+' / '+g.baselineSearch.budgetOverrun50+' |'),
'**UNDECIDED is neutral, and this limited archived sample cannot certify stronger play. One uninterrupted search cannot accept stop messages mid-search.**'
];
mkdirSync(dirname(outPath),{recursive:true});
writeFileSync(outPath,JSON.stringify(result,null,2)+'\n');
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,lines.join('\n')+'\n');
console.log(lines.join('\n'));
