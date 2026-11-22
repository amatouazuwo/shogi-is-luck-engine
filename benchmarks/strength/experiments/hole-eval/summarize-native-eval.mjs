import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync, appendFileSync} from 'node:fs';
import {dirname} from 'node:path';

// Compare native rsshogi playing strength, not tactical label agreement.
// A capped game is UNDECIDED. Treat the same opening repeated at different
// think times as a correlated observation, not an independent new sample.
const [outputPath, ...filePaths]=process.argv.slice(2);
assert.ok(outputPath&&filePaths.length, 'Usage: node summarize-native-eval.mjs OUTPUT.json GAMES.jsonl [GAMES2.jsonl ...]');
const asAverage=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const asNumber=v=>Number.isFinite(v)?v:null;
const result={schema:1,generatedFrom:filePaths,experiments:[],total:{games:0,candidateWins:0,candidateLosses:0,undecided:0,
  openingPairs:0,firstMoveDifferences:0,firstMoveComparisons:0,
  identicalPositionComparisons:0,identicalPositionMoveAgreements:0,
  firstDivergenceCount:0,completedPairedOpenings:0,incompletePairedOpenings:0,
  candidateSweeps:0,baselineSweeps:0,splitPairs:0},
 warning:'Native-playing-strength A/B only. Undecided ply-capped games are neither wins nor draws. First root move similarity is a diagnostic, not playing strength. Starts reused across budgets and previous experiments are correlated; do not auto-promote.'};
for(const path of filePaths) {
 const entries=readFileSync(path,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
 const configs=entries.filter(x=>x.event==='config');
 assert.equal(configs.length,1,'Exactly one config: '+path);
 const config=configs[0];
 assert.ok(['baseline'].includes(config.opponent),'Expected direct current-rsshogi baseline');
 const games=entries.filter(x=>x.event==='game');
 assert.equal(games.length,config.pairs*4,'Missing native direct games: '+path);
 assert.ok(Number.isInteger(config.cap)&&config.cap>0);
 const byId=new Map(),stats={games:games.length,wins:0,losses:0,undecided:0,reasonCounts:{},
  byBoard:[],pairs:[],firstMoveDifferences:0,firstMoveComparisons:0,
  identicalPositionComparisons:0,identicalPositionMoveAgreements:0,firstDivergenceCount:0,
  completedPairedOpenings:0,incompletePairedOpenings:0,candidateSweeps:0,baselineSweeps:0,splitPairs:0};
 for(const game of games) {
  assert.ok(['pit','blackhole'].includes(game.kind));
  assert.ok([0,1].includes(game.candidateSide));
  assert.ok(game.winner===null||[0,1].includes(game.winner));
  assert.ok(Array.isArray(game.turns));
  assert.ok(game.turns.length<=config.cap,'Game exceeded move cap');
  assert.ok(game.reason==='ply-cap'||game.winner!==null,'Unresolved result without ply cap');
  if(game.reason==='ply-cap')assert.equal(game.winner,null,'Ply cap incorrectly adjudicated as a win');
  const key=game.kind+'/'+game.pair;
  if(!byId.has(key))byId.set(key,[]);
  byId.get(key).push(game);
  const outcome=game.winner===null?'undecided':game.winner===game.candidateSide?'wins':'losses';
  stats[outcome]++;
  stats.reasonCounts[game.reason]=(stats.reasonCounts[game.reason]||0)+1;
 }
 assert.equal(byId.size,config.pairs*2);
 for(const kind of ['pit','blackhole']) {
  const cases=games.filter(x=>x.kind===kind);
  stats.byBoard.push({kind,games:cases.length,wins:cases.filter(x=>x.winner!==null&&x.winner===x.candidateSide).length,
   losses:cases.filter(x=>x.winner!==null&&x.winner!==x.candidateSide).length,
   undecided:cases.filter(x=>x.winner===null).length});
 }
 const engineData={candidate:{depths:[],nodes:[],elapsedMs:[]},baseline:{depths:[],nodes:[],elapsedMs:[]}};
 for(const game of games)for(const ply of game.turns) {
  const key=ply.engine==='candidate'?'candidate':ply.engine==='opponent'?'baseline':null;
  assert.ok(key,'Unexpected engine role');
  const out=engineData[key];
  if(Number.isFinite(ply.depth))out.depths.push(ply.depth);
  if(Number.isFinite(ply.nodes))out.nodes.push(ply.nodes);
  if(Number.isFinite(ply.elapsed))out.elapsedMs.push(ply.elapsed);
 }
 for(const [key,instances] of byId) {
  assert.equal(instances.length,2,'Each opening must be played with colors swapped: '+key);
  const start=instances.find(x=>x.candidateSide===0);
  const switchSides=instances.find(x=>x.candidateSide===1);
  assert.ok(start&&switchSides,'Missing one candidate side: '+key);
  assert.equal(start.start,switchSides.start,'Mismatched starting SFEN: '+key);
  assert.deepEqual(start.holes,switchSides.holes,'Mismatched hole locations: '+key);
  const firstA=start.turns[0],firstB=switchSides.turns[0];
  assert.ok(firstA&&firstB,'Missing first turn: '+key);
  assert.equal(firstA.side,firstB.side,'Root player mismatch: '+key);
  assert.equal(firstA.engine,'candidate','First root should be played by candidate');
  assert.equal(firstB.engine,'opponent','Swapped first root should be played by baseline');
  const firstMoveDiff=firstA.move!==firstB.move;
  if(firstMoveDiff)stats.firstMoveDifferences++;
  stats.firstMoveComparisons++;
  // Pairing by identical positions is valid only while the two runs have
  // played exactly the same preceding moves. Stop at their first divergence;
  // subsequent evaluations concern different board states.
  let comparable=0,identical=0,firstDivergencePly=null;
  const minimum=Math.min(start.turns.length,switchSides.turns.length);
  for(let ply=0;ply<minimum;ply++) {
   const first=start.turns[ply],other=switchSides.turns[ply];
   if(first.sfenBefore!==other.sfenBefore)break;
   assert.equal(first.side,other.side,'Identical position but inconsistent mover: '+key);
   assert.notEqual(first.engine,other.engine,'Paired position should compare different engines: '+key);
   comparable++;
   if(first.move!==other.move) {
    firstDivergencePly=ply;
    break;
   }
   identical++;
  }
  stats.identicalPositionComparisons+=comparable;
  stats.identicalPositionMoveAgreements+=identical;
  if(firstDivergencePly!==null)stats.firstDivergenceCount++;
  const bothDecided=start.winner!==null&&switchSides.winner!==null;
  if(bothDecided) {
   stats.completedPairedOpenings++;
   const winCount=[start,switchSides].filter(x=>x.winner===x.candidateSide).length;
   if(winCount===2)stats.candidateSweeps++;
   else if(winCount===1)stats.splitPairs++;
   else stats.baselineSweeps++;
  } else stats.incompletePairedOpenings++;
  stats.pairs.push({key,kind:start.kind,pair:start.pair,
   pairedResult:bothDecided?[start,switchSides].every(x=>x.winner===x.candidateSide)?'candidate-sweep':
    [start,switchSides].every(x=>x.winner!==x.candidateSide)?'baseline-sweep':'split'
    :'incomplete',
   candidateRootMove:firstA.move,baselineRootMove:firstB.move,firstMoveDiff,
   identicalPositionComparisons:comparable,identicalPositionMoveAgreements:identical,
   firstDivergencePly,
   sides:[start,switchSides].map(x=>({candidateSide:x.candidateSide,
    winner:x.winner,reason:x.reason,plies:x.turns.length,
    result:x.winner===null?'UNDECIDED':x.winner===x.candidateSide?'WIN':'LOSS'}))});
 }
 stats.pairs.sort((a,b)=>a.key.localeCompare(b.key));
 const throughput=Object.fromEntries(Object.entries(engineData).map(([key,v])=>[key,{
  turns:v.depths.length,meanDepth:asAverage(v.depths),
  meanNodes:asAverage(v.nodes),meanWallMs:asAverage(v.elapsedMs),
  meanNodesPerSecond:asAverage(v.nodes.map((n,i)=>v.elapsedMs[i]>0?n*1000/v.elapsedMs[i]:0))}]));
 const experiment={path,budgetMs:config.budget,plyCap:config.cap,openingFamilies:config.pairs,
  openingCorpusSha:config.fixtureSha,candidateWasmSha256:config.candidateSha,
  baselineWasmSha256:config.baselineSha,...stats,throughput};
 result.experiments.push(experiment);
 result.total.games+=stats.games;
 result.total.candidateWins+=stats.wins;
 result.total.candidateLosses+=stats.losses;
 result.total.undecided+=stats.undecided;
 result.total.openingPairs+=stats.pairs.length;
 result.total.firstMoveComparisons+=stats.firstMoveComparisons;
 result.total.firstMoveDifferences+=stats.firstMoveDifferences;
 result.total.identicalPositionComparisons+=stats.identicalPositionComparisons;
 result.total.identicalPositionMoveAgreements+=stats.identicalPositionMoveAgreements;
 result.total.firstDivergenceCount+=stats.firstDivergenceCount;
 for(const key of ['completedPairedOpenings','incompletePairedOpenings','candidateSweeps','baselineSweeps','splitPairs'])
  result.total[key]+=stats[key];
}
assert.equal(result.total.candidateWins+result.total.candidateLosses+result.total.undecided,result.total.games);
mkdirSync(dirname(outputPath),{recursive:true});
writeFileSync(outputPath,JSON.stringify(result,null,2)+'\n');
const summary=[
 '## Paired obstacle rsshogi playing strength, capped games are UNDECIDED',
 '| Sample / budget | Candidate wins | Losses | Undecided | Fully decided swapped pairs | Different first moves | Same-position move agreement |',
 '|---|---:|---:|---:|---:|---:|---:|',
 ...result.experiments.map(x=>'| '+x.path+' / '+x.budgetMs+'ms | '+x.wins+' | '+x.losses+' | '+x.undecided+
 ' | '+x.completedPairedOpenings+'/'+(x.completedPairedOpenings+x.incompletePairedOpenings)+
  ' | '+x.firstMoveDifferences+'/'+x.firstMoveComparisons+' | '+
  x.identicalPositionMoveAgreements+'/'+x.identicalPositionComparisons+' |'),
 '**Only finalized results establish a game win/loss. This is a correlated, historical-opening experiment, not a new strength certificate.**'
].join('\n')+'\n';
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary);
console.log(summary);
