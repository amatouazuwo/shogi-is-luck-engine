import { fileURLToPath as strengthPath, pathToFileURL as strengthFileURL } from 'node:url';
import { resolve as strengthJoin } from 'node:path';
const strengthArchive = strengthPath(new URL('../../', import.meta.url));
const strengthGame = strengthJoin(process.env.GAME_REPO || strengthJoin(strengthArchive, '../../../shogi-is-luck'));
const strengthSdk = strengthJoin(process.env.OBSTACLE_SDK || strengthJoin(strengthGame, 'ai/obstacle-sdk'));

import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const {MiniEngine} = await import(strengthFileURL(strengthJoin(strengthGame, 'ai/obstacle-sdk/mini.js')));
const {toSfen,toUsi} = await import(strengthFileURL(strengthJoin(strengthGame, 'ai/rsshogi-position.mjs')));
import {gameRules,gainScore,label,legal,play,positionFromSfen,pieceUnits,square} from '../../tactics/rules.mjs';

const source=strengthJoin(strengthArchive, 'tactics');
const reference=process.env.AUDIT_REFERENCE||source+'/reference-check';
const referenceSHA256=createHash('sha256').update(readFileSync(reference)).digest('hex');
const rows=file=>readFileSync(source+'/'+file,'utf8').trim().split('\n').map(JSON.parse);
const fixtures=rows('corpus.jsonl').filter(row=>row.category==='ray-blocking');
const trials=rows('worker-results.jsonl').filter(row=>row.event==='trial'&&row.category==='ray-blocking');
const emit=row=>console.log(JSON.stringify(row));
const toMoves=state=>legal(state).map(toUsi).sort();

function canonical(state,{holes=true}={}) {
  function orientation(reflectHorizontally,swapSides) {
    const indexMap=i=>{
      const r=Math.floor(i/9), c=i%9;
      return (swapSides?8-r:r)*9+((reflectHorizontally!==swapSides)?8-c:c);
    };
    const board=Array(81).fill(null);
    for (const [index,p] of state.board.entries()) {
      if(p) board[indexMap(index)]={...p,side:swapSides?1-p.side:p.side};
    }
    const transformed={...state,board,steps:0,turn:swapSides?1-state.turn:state.turn,
      hands:swapSides?state.hands.toReversed():state.hands,
      holes:holes?state.holes.map(indexMap).sort((a,b)=>a-b):[]};
    return toSfen(transformed,{allowHoles:true})+' '+transformed.holes.map(square).join(',');
  }
  return [orientation(false,false),orientation(true,false),orientation(false,true),orientation(true,true)].sort()[0];
}
const states=new Map(fixtures.map(row=>[row.id,positionFromSfen(row.sfen,row.holes)]));
const groups=Map.groupBy(fixtures,row=>canonical(states.get(row.id)));
const boardGroups=Map.groupBy(fixtures,row=>canonical(states.get(row.id),{holes:false}));
const queries=new Map();
function query(state) {
  const key=['legal',toSfen(state,{allowHoles:true}),state.holes.map(square).join(',')||'-'].join('\t');
  queries.set(key,toMoves(state));
}
let holesForbidden=0;
let allRuleScores=true;
for(const row of fixtures) {
  const state=states.get(row.id);
  query(state);
  const open={...state,holes:[]};
  query(open);
  const opened=toMoves(open);
  const masked=toMoves(state);
  if(row.blocked.every(move=>opened.includes(move)&&!masked.includes(move)))holesForbidden++;
  const expected=label(state,row.category);
  allRuleScores&&=expected.bestGain===row.bestGain&&expected.openedBest===row.openedBest
    &&JSON.stringify(expected.goodMoves)===JSON.stringify(row.goodMoves)
    &&JSON.stringify(expected.blocked)===JSON.stringify(row.blocked);
}

function branch(state,move) {
  const next=play(state,move);
  query(next);
  return next;
}
function choose(state,usi) {
  const decision=legal(state).find(move=>toUsi(move)===usi);
  assert.ok(decision,usi);
  return decision;
}
const decisions=[];
const misses=Map.groupBy(trials.filter(row=>!row.success),row=>row.id);
for(const [id,failed] of misses) {
  const expected=fixtures.find(row=>row.id===id);
  const state=states.get(id);
  const expectedUsi=expected.goodMoves[0];
  assert.equal(expected.goodMoves.length,1);
  const selected=choose(state,failed[0].move),target=choose(state,expectedUsi);
  const promoted=branch(state,selected);
  const earlyCapture=branch(state,target);
  const promotionDefenses=legal(promoted).map(move=>{
    const answer=branch(promoted,move);
    const capture=legal(answer).find(candidate=>toUsi(candidate)===expectedUsi);
    const score=capture?gainScore(answer).scores[expectedUsi]:null;
    const child=capture?branch(answer,capture):null;
    return {defense:toUsi(move),piece:promoted.board[move.from]?.type,available:!!capture,score,
      dragonSurvives:child?.board[selected.to]?.pr&&child?.board[selected.to]?.type==='R'};
  });
  const earlyCounterchecks=legal(earlyCapture).filter(move=>{
    if (!move.promote||earlyCapture.board[move.from]?.type!=='R') return false;
    const next=branch(earlyCapture,move);
    return gameRules.inCheck(next,next.turn);
  }).map(toUsi);
  const lateCaptureCounterchecks=promotionDefenses.map(({defense})=>{
    const afterDefense=branch(promoted,choose(promoted,defense));
    const captured=branch(afterDefense,choose(afterDefense,expectedUsi));
    return {defense,rookCountercheck:legal(captured).filter(move=>{
      if (!move.promote||captured.board[move.from]?.type!=='R') return false;
      const next=branch(captured,move);
      return gameRules.inCheck(next,next.turn);
    }).map(toUsi)};
  });
  decisions.push({id,budgets:failed.map(r=>r.budget).sort((a,b)=>a-b),
    expected:expectedUsi,immediateNet:expected.bestGain,chosen:toUsi(selected),
    chosenIsPromotion:selected.promote,chosenCapture:!!state.board[selected.to],
    opponentInCheck:gameRules.inCheck(promoted,promoted.turn),
    captureValue:pieceUnits[state.board[target.to].type],promotionDefenses,
    earlyCounterchecks,lateCaptureCounterchecks});
}

const wasm=readFileSync(strengthJoin(strengthGame, 'ai/obstacle-sdk/rsshogi_nnue_mini.wasm'));
const wasmSHA256=createHash('sha256').update(wasm).digest('hex');
assert.equal(wasmSHA256,rows('worker-results.jsonl')[0].wasmSha256);
const engine=await MiniEngine.create(wasm);
assert.ok(engine.request({command:'load_embedded'}).ok);
assert.ok(engine.request({command:'configure',hash_mb:16,threads:1}).ok);
try {
  for(const [query,wanted] of queries) {
    const [,sfen,holeText]=query.split('\t');
    const holes=holeText==='-'?[]:holeText.split(',');
    const position=engine.request({command:'set_obstacle_position',sfen,holes});
    assert.ok(position.ok,JSON.stringify(position));
    const result=engine.request({command:'legal_moves'});
    assert.ok(result.ok,JSON.stringify(result));
    assert.deepEqual(result.result.toSorted(),wanted,query);
  }
} finally {
  engine.dispose();
}
const replyLines=execFileSync(reference,{input:[...queries.keys()].join('\n')+'\n',
  encoding:'utf8',timeout:30000}).trim().split('\n').map(JSON.parse);
assert.equal(replyLines.length,queries.size);
for(const [[key,wanted],answer] of [...queries.entries()].map((row,i)=>[row,replyLines[i]])) {
  const moves=Array.isArray(answer)?answer:answer.moves;
  assert.ok(moves,key+' '+JSON.stringify(answer));
  assert.deepEqual(moves.toSorted(),wanted,key);
}
emit({event:'sample',fixtures:fixtures.length,oldTrials:trials.length,rawMisses:trials.filter(row=>!row.success).length,
  distinctBoards:boardGroups.size,distinctBoardAndMaskOrbits:groups.size,rawExactBoards:new Set(fixtures.map(row=>row.sfen)).size,
  rawExactMasked:new Set(fixtures.map(row=>row.sfen+' '+row.holes.join(','))).size,
  outcomesPerOrbit:[...groups.values()].map(group=>({family:group[0].family,hazard:group[0].kind,cases:group.length,
    successes:group.filter(row=>trials.filter(x=>x.id===row.id).every(x=>x.success)).length})),
  independentLegalChecks:queries.size,referenceSHA256,modifiedWasmLegalChecks:queries.size,wasmSHA256,holesForbidden,allRuleScores});
for (const data of decisions) emit({event:'line',...data});
