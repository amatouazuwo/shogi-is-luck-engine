import { fileURLToPath as strengthPath, pathToFileURL as strengthFileURL } from 'node:url';
import { resolve as strengthJoin } from 'node:path';
const strengthArchive = strengthPath(new URL('../../', import.meta.url));
const strengthGame = strengthJoin(process.env.GAME_REPO || strengthJoin(strengthArchive, '../../../shogi-is-luck'));
const strengthSdk = strengthJoin(process.env.OBSTACLE_SDK || strengthJoin(strengthGame, 'ai/obstacle-sdk'));

import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const repo=strengthGame;
const rows=readFileSync(strengthJoin(strengthArchive, 'obstacle-reference-midgame.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
const source=execFileSync('git',['show',`${rows[0].gameCommit}:index.html`],{cwd:repo,encoding:'utf8'});
const {toObstaclePosition,toUsi}=await import(pathToFileURL(`${repo}/ai/rsshogi-position.mjs`));
function section(start,end) {
  const a=source.indexOf(start), b=source.indexOf(end,a);
  assert.ok(a>=0&&b>a);
  return source.slice(a,b);
}
const ruleSource=[section('const $=id=>','const names='),section('const rand=n=>','let g=null'),
  section('const shallowBoard=','function drawCeremony('),section('function repeatHash(','// Dedicated pre-match selection view.')].join('\n');
assert.equal(createHash('sha256').update(ruleSource).digest('hex'), rows[0].rulesSha256);
const {getLegal,inCheck,piece,sim,repeatHash}=new Function('Math',`${ruleSource}\nreturn {getLegal,inCheck,piece,sim,repeatHash}`)(Math);

function square(s) { return (s.charCodeAt(1)-97)*9+9-Number(s[0]); }
function parse({sfen,holes}) {
  const [placement,turn,holdings,steps]=sfen.split(' ');
  const board=placement.replaceAll('/','').match(/\+?[a-zA-Z]|[1-9]/g).flatMap(symbol=>{
    if (/^\d$/.test(symbol)) return Array(Number(symbol)).fill(null);
    const type=symbol.at(-1), upper=type.toUpperCase();
    return [piece(upper,Number(type!==upper),symbol.startsWith('+'))];
  });
  assert.equal(board.length,81);
  const hands=[{},{}];
  if (holdings!=='-') for (const m of holdings.matchAll(/(\d*)([a-zA-Z])/g)) {
    const upper=m[2].toUpperCase();
    hands[Number(upper!==m[2])][upper]=Number(m[1])||1;
  }
  const p={board,hands,holes:holes.map(square),turn:Number(turn==='w'),steps:Number(steps)-1};
  assert.deepEqual(toObstaclePosition(p),{sfen,holes});
  return p;
}
function play(p,m) {
  const hands=p.hands.map(h=>({...h}));
  const taken=p.board[m.to];
  if(taken) {
    assert.notEqual(taken.type,'K');
    hands[p.turn][taken.type]=(hands[p.turn][taken.type]||0)+1;
  }
  if(m.drop) hands[p.turn][m.drop]--;
  return {...p,board:sim(p,m,p.turn).board,hands,turn:1-p.turn,steps:p.steps+1};
}

const losses=rows.filter(g=>g.event==='game'&&g.winner!==null&&g.winner!==g.nnueSide);
assert.equal(losses.length,5);
const games=[];
for (const loss of losses) {
  let p=parse(loss.start);
  const name=`${loss.kind}-${loss.budget}`;
  const history=[];
  const seen=new Map([[repeatHash(p),1]]);
  const replay=[];
  for (const [i,t] of loss.turns.entries()) {
    const pre=toObstaclePosition(p);
    const legal=getLegal(p,p.turn);
    assert.equal(p.turn,t.side);
    const m=legal.find(m=>toUsi(m)===t.bestmove);
    assert.ok(m, `${name} ply ${i+1}: ${t.bestmove}`);
    const next=play(p,m);
    const key=repeatHash(next);
    const visits=(seen.get(key)||0)+1;
    assert.ok(visits<4);
    seen.set(key,visits);
    const post=toObstaclePosition(next);
    const frame={name,ply:i+1,absolutePly:p.steps+1,pre,post,legal:legal.map(toUsi),checked:inCheck(p,p.turn),
      capture:p.board[m.to],piece:m.drop||p.board[m.from]?.type,turn:t.side,engine:t.engine,played:t.bestmove};
    if (process.argv.includes('--tsv')&&t.engine==='nnue') {
      console.log([`${name}:${i+1}`,pre.sfen,pre.holes.join(','),t.bestmove,history.join('|')].join('\t'));
    }
    replay.push(frame);
    history.push(pre.sfen);
    p=next;
  }
  assert.equal(getLegal(p,p.turn).length,0);
  assert.ok(inCheck(p,p.turn));
  games.push({name,start:loss.start,nnueSide:loss.nnueSide,gap:loss.gap,absorbed:loss.absorbed,replay});
}
if (!process.argv.includes('--tsv')) console.log(JSON.stringify(games));
