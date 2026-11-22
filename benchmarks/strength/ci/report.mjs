import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,appendFileSync,mkdirSync} from 'node:fs';

// Conservative paired results. This does not grant approval to deploy.
const inputs=process.argv.slice(2);
assert.ok(inputs.length>0,'Pass one or more JSONL match result files');
const round=(x,n=2)=>Number(x.toFixed(n));
const p100=x=>round(x*100);
function exactSignP(a,b) {
  const n=a+b;
  if(!n)return null;
  let term=Math.pow(.5,n),sum=term;
  for(let k=0;k<Math.min(a,b);k++){term*=((n-k)/(k+1));sum+=term;}
  return Math.min(1,round(2*sum,6));
}
function result(g) {
  if(g.winner===null)return g.reason==='repetition'?'draw':'unfinished';
  assert.ok(g.winner===0||g.winner===1,'Unknown winner');
  return g.winner===g.candidateSide?'win':'loss';
}
function summarize(games) {
  const c={win:0,loss:0,draw:0,unfinished:0};
  const moves=[];
  for(const g of games) {
    c[result(g)]++;
    moves.push(...g.turns.filter(t=>t.engine==='candidate'));
  }
  const mean=key=>moves.length?round(moves.reduce((s,m)=>s+(m[key]||0),0)/moves.length):null;
  return {...c,games:games.length,
    scoreBoundsPct:[p100((c.win+c.draw*.5)/games.length),p100((c.win+c.draw*.5+c.unfinished)/games.length)],
    candidateMoves:moves.length,meanSearchWallMs:mean('elapsed'),meanDepth:mean('depth'),meanNodes:mean('nodes'),
    overBudget50:moves.filter(t=>t.elapsed>t.requestMs+50).length};
}
function group(games,kind){
  const subset=games.filter(g=>g.kind===kind),pairs=new Map();
  for(const g of subset){
    if(!pairs.has(g.pair))pairs.set(g.pair,new Map());
    const colors=pairs.get(g.pair);
    assert.ok(!colors.has(g.candidateSide),'Duplicate pair/color '+kind+'/'+g.pair);
    colors.set(g.candidateSide,g);
  }
  let positive=0,negative=0,tied=0,unresolved=0;
  for(const [pair,colors] of pairs){
    assert.equal(colors.size,2,'Incomplete color pair '+kind+'/'+pair);
    let lo=0,hi=0;
    for(const g of colors.values()){
      const r=result(g);
      if(r==='win'){lo++;hi++;}
      else if(r==='draw'){lo+=.5;hi+=.5;}
      else if(r==='unfinished')hi++;
    }
    if(lo>1)positive++;
    else if(hi<1)negative++;
    else if(lo===1&&hi===1)tied++;
    else unresolved++;
  }
  const p=exactSignP(positive,negative);
  const status=pairs.size<10||unresolved>0?'INSUFFICIENT_SAMPLE_OR_UNFINISHED':
    p!==null&&p<=.05?(positive>negative?'PROMISING_REVIEW_ONLY':'NEGATIVE_REVIEW_ONLY'):'INCONCLUSIVE';
  return {kind,uniquePairs:pairs.size,...summarize(subset),
    candidateSente:summarize(subset.filter(g=>g.candidateSide===0)),
    candidateGote:summarize(subset.filter(g=>g.candidateSide===1)),
    pairDirections:{positive,negative,tied,unresolved},exploratoryExactSignP:p,assessment:status};
}
const reports=[];
for(const file of inputs){
  const rows=readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const configs=rows.filter(x=>x.event==='config');
  assert.equal(configs.length,1,'Missing config '+file);
  const games=rows.filter(x=>x.event==='game');
  assert.ok(games.length>0,'Missing game data '+file);
  const config=configs[0];
  const kinds=[...new Set(games.map(x=>x.kind))];
  assert.equal(games.length,config.pairs*2*kinds.length,'Incomplete match list '+file);
  assert.ok(games.every(x=>Array.isArray(x.turns)&&['no-legal','resign','clock','ply-cap','repetition','repetition-unadjudicated'].includes(x.reason)),'Unexpected game outcome');
  reports.push({file,config,overall:summarize(games),byKind:kinds.map(k=>group(games,k))});
}
const payload={schema:1,workflowCommit:process.env.GITHUB_SHA||null,generatedAt:new Date().toISOString(),
  notice:'Archived openings, not independent fresh holdout; do not automatically promote AI. Unfinished games are bounds, not draws. Do not pool overlapping seeds across budgets or types.',reports};
mkdirSync('results',{recursive:true});
writeFileSync('results/scorecard.json',JSON.stringify(payload,null,2)+'\n');
const lines=['## Conservative strength scorecard','No automatic AI adoption. Archived fixtures, not fresh holdout.',
  '| File / board | Opening pairs | W / L / unresolved | Score bounds | Paired +/-/=/unresolved | Assessment |',
  '|---|---:|---|---|---|---|'];
for(const rep of reports)for(const s of rep.byKind)lines.push('| '+rep.file+' / '+s.kind+
  ' | '+s.uniquePairs+' | '+s.win+' / '+s.loss+' / '+s.unfinished+' | '+s.scoreBoundsPct.join('–')+
  '% | '+[s.pairDirections.positive,s.pairDirections.negative,s.pairDirections.tied,s.pairDirections.unresolved].join('/')+' | '+s.assessment+' |');
lines.push('P values are exploratory exact paired sign tests; related starts and budgets are not independent, and these results cannot establish human ranks.');
const markdown=lines.join('\n')+'\n';
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,markdown);
console.log(markdown);
