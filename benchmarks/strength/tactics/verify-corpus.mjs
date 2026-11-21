import { fileURLToPath as strengthPath, pathToFileURL as strengthFileURL } from 'node:url';
import { resolve as strengthJoin } from 'node:path';
const strengthArchive = strengthPath(new URL('../', import.meta.url));
const strengthGame = strengthJoin(process.env.GAME_REPO || strengthJoin(strengthArchive, '../../../shogi-is-luck'));
const strengthSdk = strengthJoin(process.env.OBSTACLE_SDK || strengthJoin(strengthGame, 'ai/obstacle-sdk'));

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gameRules, legal, play, square, fromSquare, pieceUnits, positionFromSfen, rayCrosses, winsInOne } from './rules.mjs';
const { toSfen, toUsi } = await import(strengthFileURL(strengthJoin(strengthGame, 'ai/rsshogi-position.mjs')));

const ref=process.env.REFERENCE_BINARY||strengthJoin(strengthArchive, 'reference/obstacle-reference');
const source=readFileSync(process.env.TACTICS_CORPUS||new URL('corpus.jsonl',import.meta.url));
const original=source.toString('utf8').trim().split('\n').map(JSON.parse);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const sorted=values=>values.slice().sort();
const key=(x,command)=>[command,toSfen(x,{allowHoles:true}),x.holes.length?x.holes.map(square).join(','):'-'].join('\t');
const queries=new Set();
const conclusions=[];
function ask(x,command){
  const entry=key(x,command);
  queries.add(entry);
  return answers=>answers.get(entry);
}
function parseTarget(usi){return fromSquare(usi.slice(2,4));}

function exactLegal(x,label){
  const reply=ask(x,'legal');
  const expected=sorted(legal(x).map(toUsi));
  return answers=>{
    const data=reply(answers);
    assert.deepEqual(sorted(data.moves),expected,label);
    if(typeof data.inCheck==='boolean')assert.equal(data.inCheck,gameRules.inCheck(x,x.turn),label+' check');
    else if(typeof data.in_check==='boolean')assert.equal(data.in_check,gameRules.inCheck(x,x.turn),label+' check');
    return data.moves;
  };
}
function exactWinsInOne(x,label){
  const reply=ask(x,'mate');
  const expected=winsInOne(x);
  return answers=>{
    const {mate,noLegalWithoutCheck}=reply(answers);
    assert.deepEqual(sorted(mate),sorted(expected.filter(move=>move.mate).map(move=>move.move)),label+' mate');
    assert.deepEqual(sorted(noLegalWithoutCheck),sorted(expected.filter(move=>!move.mate).map(move=>move.move)),label+' terminal without check');
    return {mate:sorted(mate),terminal:sorted(mate.concat(noLegalWithoutCheck))};
  };
}
function exactMaterial(x,label){
  const root=exactLegal(x,label);
  const children=new Map();
  for(const move of legal(x)){
    const victim=x.board[move.to];
    if(!victim)continue;
    const child=play(x,move);
    const childLabels=exactLegal(child,label+' '+toUsi(move));
    children.set(toUsi(move),answers=>{
      const total=pieceUnits[victim.type];
      const values=childLabels(answers).map(reply=>pieceUnits[child.board[parseTarget(reply)]?.type]||0);
      return total-Math.max(0,...values);
    });
  }
  return answers=>{
    const recaptures=root(answers).filter(move=>children.has(move)).map(move=>[move,children.get(move)(answers)]);
    const best=Math.max(0,...recaptures.map(([,gain])=>gain));
    return {best,moves:sorted(recaptures.filter(([,gain])=>best>0&&gain===best).map(([move])=>move))};
  };
}
for(const entry of original){
  const {id,sfen,holes,category,goodMoves}=entry;
  const p=positionFromSfen(sfen,holes);
  const root=exactLegal(p,id);
  if(category==='mate-in-one'){
    const solve=exactWinsInOne(p,id);
    conclusions.push(answers=>{
      root(answers);
      assert.deepEqual(solve(answers).terminal,sorted(goodMoves),id);
    });
  }else if(category==='mate-in-three'){
    const immediate=exactWinsInOne(p,id+' shortest length');
    const attacks=legal(p).map(first=>{
      const child=play(p,first);
      const replyMoves=exactLegal(child,id+' '+toUsi(first));
      const inCheck=gameRules.inCheck(child,child.turn);
      const defenses=inCheck?legal(child).map(reply=>({
        move:toUsi(reply),mate:exactWinsInOne(play(child,reply),[id,toUsi(first),toUsi(reply)].join(' ')),
      })):[];
      return {move:toUsi(first),replyMoves,defenses};
    });
    conclusions.push(answers=>{
      root(answers);
      assert.deepEqual(immediate(answers).terminal,[],id+' immediate terminal');
      const proof={};
      for(const {move,replyMoves,defenses} of attacks){
        replyMoves(answers);
        if(!defenses.length)continue;
        const lines=defenses.map(({move,mate})=>[move,mate(answers).mate]);
        if(lines.every(([,mate])=>mate.length))proof[move]=Object.fromEntries(lines);
      }
      assert.deepEqual(sorted(Object.keys(proof)),sorted(goodMoves),id);
      assert.deepEqual(proof,entry.proof,id+' proof branches');
    });
  }else if(category==='evade-forced-win'){
    const children=legal(p).map(move=>({move:toUsi(move),terminal:exactWinsInOne(play(p,move),id+' '+toUsi(move))}));
    conclusions.push(answers=>{
      root(answers);
      const safe=children.filter(child=>child.terminal(answers).terminal.length===0).map(child=>child.move);
      assert.deepEqual(sorted(safe),sorted(goodMoves),id);
    });
  }else if(category==='material-gain'){
    const compare=exactMaterial(p,id);
    conclusions.push(answers=>{
      const outcome=compare(answers);
      assert.deepEqual(outcome,{best:entry.bestGain,moves:sorted(goodMoves)},id);
    });
  }else if(category==='ray-blocking'){
    const compare=exactMaterial(p,id),open={...p,holes:[]};
    const openCompare=exactMaterial(open,id+' opened');
    conclusions.push(answers=>{
      assert.deepEqual(compare(answers),{best:entry.bestGain,moves:sorted(goodMoves)},id);
      const opened=openCompare(answers);
      assert.equal(opened.best,entry.openedBest,id);
      assert.deepEqual(opened.moves,sorted(entry.blocked),id);
      assert.ok(legal(open).filter(move=>opened.moves.includes(toUsi(move))).every(move=>rayCrosses(p,move)),id);
    });
  }else{
    assert.equal(category,'no-legal-loss');
    const open=exactLegal({...p,holes:[]},id+' opened');
    conclusions.push(answers=>{
      assert.deepEqual(root(answers),[],id);
      assert.ok(open(answers).length>0,id+' dependence on the hole');
      assert.equal(gameRules.inCheck(p,p.turn),false,id);
      assert.deepEqual(goodMoves,['resign'],id);
    });
  }
}
const commands=[...queries];
const ran=execFileSync(ref,[],{input:commands.join('\n')+'\n',encoding:'utf8',maxBuffer:48*1024*1024});
const responses=ran.trim().split('\n').map(JSON.parse);
assert.equal(responses.length,commands.length);
assert.ok(responses.every(r=>!r.error),JSON.stringify(responses.find(r=>r.error)));
const answers=new Map(commands.map((cmd,index)=>[cmd,responses[index]]));
for(const check of conclusions)check(answers);
const counts=Object.fromEntries([...Map.groupBy(commands,c=>c.split('\t')[0])].map(([opcode,queries])=>[opcode,queries.length]));
console.log(JSON.stringify({event:'oracle-verification',corpusSha256:digest(source),referenceSha256:digest(readFileSync(ref)),
  positions:original.length,checks:counts,moveSetDifferences:0,labelDifferences:0,verifiedChecks:responses[0]?.inCheck!==undefined||responses[0]?.in_check!==undefined},null,2));
