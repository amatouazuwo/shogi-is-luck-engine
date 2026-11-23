import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {planTurn} from './clock-budget.mjs';
import {referenceProxyForDepth} from './gikou-reference-proxies.mjs';

const digest=s=>createHash('sha256').update(s).digest('hex');
const close=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<1.01;
const ratio=(wins,total)=>Math.round(wins/total*10000)/10000;
export const PINNED_GIKOU_PARAMS_SHA='6bbc573306839fe019634dd94b06af7c22834a641e8bc060e23889ae9b3b2195';

export function auditNormalReferenceGrid(events,openingCorpus,{
  expectedDepth,expectedTiers,expectedIds,
}={}){
  assert.ok(Array.isArray(events)&&events.length>2,'Expected recorded real Gikou matches');
  assert.ok(typeof openingCorpus==='string'&&openingCorpus.length>100,'Missing source corpus');
  const configs=events.filter(x=>x.event==='gikou-normal-match-config');
  assert.equal(configs.length,1,'Exactly one match configuration');
  const cfg=configs[0];
  assert.match(cfg.name,/gikou|技巧/i,'Real Gikou identity required');
  assert.equal(cfg.tag,'v2.0.2');
  assert.ok([2,3,4,5,8].includes(cfg.depthLimit),'Unreviewed reference depth');
  assert.deepEqual(cfg.referenceProxy??null,referenceProxyForDepth(cfg.depthLimit),
    'Provisional reference rank label must match selected depth without certification');
  assert.equal(cfg.book,false,'No book advantage');
  assert.equal(cfg.threads,1);
  assert.equal(cfg.referenceUsesDepthInsteadOfTimeLimit,true,
    'Reference is limited by DEPTH, not by an equal 1s time cap');
  assert.equal(cfg.referenceParamsHash,PINNED_GIKOU_PARAMS_SHA,'Unpinned external eval');
  for(const prop of ['referenceHash','nnueHash','workerHash'])
    assert.match(cfg[prop],/^[a-f0-9]{64}$/,'Missing reproducible engine digest');
  assert.equal(cfg.corpusHash,digest(openingCorpus),'Changed original normal corpus');
  assert.equal(cfg.clockMs,180000);
  assert.equal(cfg.nominalStudentMs,1000);
  assert.equal(cfg.clockDivisor,20);
  assert.equal(cfg.preMoveDelayMs,1300);
  assert.equal(cfg.maxPlies,300);
  assert.equal(cfg.noHumanRankClaim,true);
  assert.equal(cfg.outcomeIfRepetition,'neutral-unadjudicated');
  assert.ok(Array.isArray(cfg.nodeTiers)&&cfg.nodeTiers.length>0);
  assert.ok(cfg.nodeTiers.every(x=>Number.isSafeInteger(x)&&x>=500&&x<=50000));
  assert.equal(new Set(cfg.nodeTiers).size,cfg.nodeTiers.length);
  assert.ok(Array.isArray(cfg.fixtureIds)&&cfg.fixtureIds.length>=2);
  assert.equal(new Set(cfg.fixtureIds).size,cfg.fixtureIds.length);
  if(expectedDepth!==undefined)assert.equal(cfg.depthLimit,expectedDepth);
  if(expectedTiers!==undefined)assert.deepEqual(cfg.nodeTiers,expectedTiers);
  if(expectedIds!==undefined)assert.deepEqual(cfg.fixtureIds,expectedIds);

  const fixtures=openingCorpus.trim().split('\n').map(JSON.parse)
    .filter(x=>x.event==='opening'&&x.family==='hirate'&&cfg.fixtureIds.includes(x.pair));
  assert.equal(fixtures.length,cfg.fixtureIds.length,'Missing normal openings');
  const byId=new Map(fixtures.map(x=>[x.pair,x]));
  assert.equal(byId.size,fixtures.length,'Duplicate source opening');
  const logs=events.filter(x=>x.event==='gikou-normal-match-game');
  assert.equal(logs.length,cfg.nodeTiers.length*fixtures.length*2,
    'All node tiers must have both candidate colors at every source opening');
  const seen=new Set(),records=[];
  for(const g of logs){
    assert.ok(cfg.nodeTiers.includes(g.nodesCap),'Unknown node tier in outcome');
    const f=byId.get(g.pair);
    assert.ok(f,'Unregistered normal opening');
    assert.equal(g.start,f.opening,'Opening SFEN differs from archive');
    assert.ok(g.candidateSide===0||g.candidateSide===1);
    const id=[g.nodesCap,g.pair,g.candidateSide].join(':');
    assert.ok(!seen.has(id),'Duplicate paired game '+id);seen.add(id);
    assert.ok(Array.isArray(g.turns)&&g.turns.length<=300);
    assert.ok(Array.isArray(g.clocks)&&g.clocks.length===2);
    assert.ok([null,0,1].includes(g.winner));
    assert.ok(['no-legal','resign','clock','ply-cap',
      'repetition-unadjudicated','unsupported-entering-king'].includes(g.reason));
    if(['ply-cap','repetition-unadjudicated','unsupported-entering-king'].includes(g.reason))
      assert.equal(g.winner,null,'Unadjudicated position must remain neutral');
    else assert.notEqual(g.winner,null,'Decided position requires winner');
    if(g.reason==='ply-cap')assert.equal(g.turns.length,300,
      'Prematurely capped game cannot be labelled 300-ply');
    const remaining=[180000,180000];
    for(const [i,t] of g.turns.entries()){
      assert.equal(t.ply,i,'Nonsequential move record');
      assert.ok(t.side===0||t.side===1);
      if(i)assert.notEqual(t.side,g.turns[i-1].side,'Double move by same side');
      assert.equal(t.side,t.sfenBefore.split(' ')[1]==='b'?0:1,
        'Wrong SFEN side-to-move');
      const candidate=t.side===g.candidateSide;
      assert.equal(t.engine,candidate?'rsshogi':'gikou2');
      assert.equal(t.nodeCap,candidate?g.nodesCap:null);
      const plan=planTurn({remainingMs:remaining[t.side],
        nominalMs:1000,divisor:20,preMoveDelayMs:1300});
      assert.ok(close(t.clockBeforeMs,remaining[t.side]),'Clock not continuous');
      assert.ok(Number.isFinite(t.elapsedMs)&&t.elapsedMs>=0);
      assert.ok(close(t.chargedMs,t.elapsedMs+plan.preMoveDelayChargedMs),
        'Pre-move time must be debited from real game clock');
      remaining[t.side]-=t.chargedMs;
      assert.ok(close(t.clockAfterTurnMs,remaining[t.side]),'Clock after move mismatch');
      if(candidate){
        assert.equal(t.studentRequestMs,plan.searchMs,'Native search budget mismatch');
        assert.ok(Number.isSafeInteger(t.nodes)&&t.nodes>=0&&t.nodes<=g.nodesCap,
          'Native search exceeded node cap');
        assert.ok(Number.isSafeInteger(t.depth)&&t.depth>=0&&t.depth<=64,
          'Invalid NNUE depth');
      }else{
        assert.equal(t.studentRequestMs,null);
        assert.equal(t.nodes,null);
        assert.equal(t.depth,null);
      }
      assert.ok(typeof t.move==='string'&&t.move.length>=4,'Missing USI move');
    }
    if(g.reason!=='clock'){
      assert.ok(g.clocks.every((x,i)=>close(x,remaining[i])),
        'Final clocks mismatch turn history');
    }else assert.ok(g.clocks.some(x=>x<=0),'Clock loss needs expired clock');
    if(g.reason==='resign'){
      const last=g.turns.at(-1);
      assert.equal(last.move,'resign');
      assert.equal(g.winner,1-last.side,'Resignation awarded to wrong side');
    }
    records.push(g);
  }
  const summaries=events.filter(x=>x.event==='gikou-normal-match-summary');
  assert.equal(summaries.length,cfg.nodeTiers.length,'One summary per tier');
  const report=cfg.nodeTiers.map(tier=>{
    const games=records.filter(g=>g.nodesCap===tier);
    assert.equal(games.length,fixtures.length*2);
    const wins=games.filter(g=>g.winner===g.candidateSide).length;
    const losses=games.filter(g=>g.winner!==null&&g.winner!==g.candidateSide).length;
    const neutral=games.filter(g=>g.winner===null).length;
    const summary=summaries.find(s=>s.nodesCap===tier);
    assert.ok(summary&&summary.depthLimit===cfg.depthLimit);
    assert.equal(summary.games,games.length);
    assert.equal(summary.rsshogiWins,wins);
    assert.equal(summary.gikouWins,losses);
    assert.equal(summary.neutralUndecided,neutral);
    assert.deepEqual(summary.scoreBoundsIncludingNeutral,
      [ratio(wins,games.length),ratio(wins+neutral,games.length)]);
    assert.equal(summary.externallyCertifiedAmateurGrade,false);
    const byColor=[0,1].map(side=>{
      const slice=games.filter(g=>g.candidateSide===side);
      return {candidateSide:side,games:slice.length,
        rsshogiWins:slice.filter(g=>g.winner===side).length,
        gikouWins:slice.filter(g=>g.winner!==null&&g.winner!==side).length,
        neutral:slice.filter(g=>g.winner===null).length};
    });
    const times=games.flatMap(g=>g.turns.filter(t=>t.engine==='rsshogi'));
    const elapsedMean=times.length?Math.round(times.reduce((a,t)=>a+t.elapsedMs,0)/times.length*1000)/1000:null;
    const nativeMean=times.length?Math.round(times.reduce((a,t)=>a+t.nodes,0)/times.length):null;
    return {nodeCap:tier,games:games.length,
      rsshogiWins:wins,gikouWins:losses,neutralUndecided:neutral,
      scoreBoundsIncludingNeutral:summary.scoreBoundsIncludingNeutral,
      byCandidateColor:byColor,meanNativeSearchElapsedMs:elapsedMean,
      meanNativeNodes:nativeMean};
  });
  return {event:'gikou-depth-grid-audited',status:'exploratory-only',
    externalEngine:cfg.name,externalDepth:cfg.depthLimit,
    provisionalReference:referenceProxyForDepth(cfg.depthLimit),
    genuinePinnedParameterSha256:cfg.referenceParamsHash,
    sourceNormalOpeningIds:cfg.fixtureIds,uniqueOpeningCount:fixtures.length,
    totalGames:records.length,results:report,
    humanValidationRequested:false,amateurGradeAssigned:false,
    relativeTo:'Gikou2 v2.0.2 depth-limited engine only',
    limitations:'Paired games from correlated historic normal openings. Gikou uses depth limit, '+
      'not the same fixed 1-second cap as rsshogi. Even a 50% match score cannot '+ 
      'certify Shogi Club 24 grade or general amateur rank. Depth8 is a user-selected working label, not proof.'};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [, ,jsonl,source,depthArg,tierArg,idsArg]=process.argv;
 assert.ok(jsonl&&source&&depthArg&&tierArg&&idsArg,
   'Usage: node external-usi-depth-grid-scorecard.mjs JSONL SOURCE.jsonl DEPTH NODELIST IDS');
 const events=readFileSync(resolve(jsonl),'utf8').trim().split('\n').map(JSON.parse);
 const sourceText=readFileSync(resolve(source),'utf8');
 const opts={expectedDepth:Number(depthArg),
   expectedTiers:tierArg.split(',').map(Number),
   expectedIds:idsArg.split(',').map(Number)};
 console.log(JSON.stringify(auditNormalReferenceGrid(events,sourceText,opts)));
}
