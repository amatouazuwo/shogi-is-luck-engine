import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const gameRoot = resolve(process.env.GAME_REPO || process.argv[2] || '.');
const {toSfen,toUsi} = await import(pathToFileURL(resolve(gameRoot,'ai/rsshogi-position.mjs')));
const source = await readFile(resolve(gameRoot,'index.html'),'utf8');
function segment(begin,end) {
  const first=source.indexOf(begin);
  const last=source.indexOf(end,first);
  assert.ok(first>=0&&last>first,begin);
  return source.slice(first,last);
}
const rules=[
  segment('const $=id=>','const names='),
  segment('const rand=n=>','let g=null'),
  segment('const shallowBoard=','function drawCeremony('),
  segment('function repeatHash(','// Dedicated pre-match selection view.'),
].join('\n');
const math=Object.create(Math);
const game=new Function('Math',rules+
  '\nreturn {independentBoard,piece,getLegal,inCheck,sim};')(math);
const standard='lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL';
const nativeBoard=()=>Array.from(standard.replaceAll('/','').replace(/[1-9]/g,n=>'.'.repeat(Number(n))),
  byte=>byte==='.'?null:game.piece(byte.toUpperCase(),byte===byte.toUpperCase()?0:1));
const wealth={P:1,L:3,N:4,S:5,G:6,B:8,R:10,K:0};
const digest=text=>createHash('sha256').update(text).digest('hex');
const write=row=>console.log(JSON.stringify(row));

function seededRandom(seed) {
  let state=seed;
  return ()=>{
    state=(Math.imul(state,1664525)+1013904223)>>>0;
    return state/2**32;
  };
}

function apply(position,move) {
  const target=position.board[move.to];
  if (target) {
    assert.notEqual(target.type,'K');
    const hand=position.hands[position.turn];
    hand[target.type]=(hand[target.type]||0)+1;
    position.captures++;
  }
  if (move.drop) position.hands[position.turn][move.drop]--;
  position.board=game.sim(position,move,position.turn).board;
  position.turn=1-position.turn;
  position.steps++;
}

function materialGap(position) {
  const total=[0,0];
  for (const piece of position.board) if(piece) total[piece.side]+=wealth[piece.type]+(piece.pr?1:0);
  for (const [side,hand] of position.hands.entries()) {
    for (const [piece,count] of Object.entries(hand)) total[side]+=wealth[piece]*count;
  }
  return total[0]-total[1];
}

function legalOptions(position) {
  return game.getLegal(position,position.turn).map(move=>({move,usi:toUsi(move)}));
}

function tacticalOptions(position,legal) {
  let checking=0;
  let winning=0;
  for (const {move} of legal) {
    const reply={...position,hands:position.hands.map(hand=>({...hand}))};
    apply(reply,move);
    if(game.inCheck(reply,reply.turn)) checking++;
    if (!game.getLegal(reply,reply.turn).length) winning++;
  }
  return {checking,winning};
}

const starts=[
  {family:'standard-middle',stage:'middle',makeBoard:nativeBoard,plies:36,minHands:2,minCaptures:3,minChecks:0,rootSeed:0x3d39a98b},
  {family:'random-middle',stage:'middle',makeBoard:()=>game.independentBoard(),plies:41,minHands:3,minCaptures:4,minChecks:0,rootSeed:0xd48db69f},
  {family:'standard-late',stage:'late',makeBoard:nativeBoard,plies:104,minHands:6,minCaptures:8,minChecks:2,rootSeed:0x89238521},
  {family:'random-late',stage:'late',makeBoard:()=>game.independentBoard(),plies:109,minHands:6,minCaptures:8,minChecks:2,rootSeed:0x6c2459ad},
];
write({event:'config',purpose:'Optional unused normal middle and late positions; no timed engine evaluated these fixtures',
  seedPolicy:'First accepted game-legal playout from four independently fixed starting seeds',
  playoutPolicy:'Random among legal moves weighted 3 for captures, 1 otherwise, plus 1 when promoting',
  ruleSha256:digest(rules),indexSha256:digest(source),
  constraints:{minimumLegalMoves:12,maximumAbsoluteMaterialGap:8,maximumMaterialGapLate:10,
    kingsOutOfCheck:true,winningInOneForBothSides:0,attemptsPerStratum:192},
  strata:starts.map(({makeBoard,...fields})=>fields)});
for (const [index,sample] of starts.entries()) {
  const {family,stage,makeBoard,plies,minHands,minCaptures,minChecks,rootSeed}=sample;
  const pair=200+index;
  let accepted;
  for(let attempt=0;attempt<192;attempt++) {
    const seed=(rootSeed ^ Math.imul(attempt,0x85ebca6b))>>>0;
    const random=seededRandom(seed);
    math.random=random;
    const position={board:makeBoard(),turn:0,hands:[{},{}],steps:0,holes:[],captures:0};
    const initial=toSfen(position);
    const sequence=[];
    while(position.steps<plies) {
      const legal=game.getLegal(position,position.turn);
      if(!legal.length) break;
      const weighted=legal.flatMap(move=>Array((position.board[move.to]?3:1)+Number(move.promote)).fill(move));
      const move=weighted[Math.floor(random()*weighted.length)];
      sequence.push(toUsi(move));
      apply(position,move);
    }
    if(position.steps!==plies||position.captures<minCaptures) continue;
    const legal=legalOptions(position);
    const heldPieces=position.hands.flatMap(hand=>Object.values(hand)).reduce((a,b)=>a+b,0);
    const balance=materialGap(position);
    if(legal.length<12||heldPieces<minHands||Math.abs(balance)>(stage==='late'?10:8)) continue;
    if ([0,1].some(side=>game.inCheck(position,side))) continue;
    const opponent={...position,turn:1-position.turn};
    const own=tacticalOptions(position,legal);
    const their=tacticalOptions(opponent,legalOptions(opponent));
    if (own.winning||their.winning||own.checking+their.checking<minChecks) continue;
    accepted={event:'opening',level:100,family,stage,pair,rootSeed,seed,opening:toSfen(position),initial,
      legal:legal.length,legalMoves:legal.map(row=>row.usi).sort(),sequence,captures:position.captures,
      heldPieces,materialGap:balance,checkingBySideToMove:own.checking,checkingByOtherSide:their.checking,
      immediateWinsBothSides:[own.winning,their.winning],attempt};
    break;
  }
  assert.ok(accepted,`${family}/${plies}: no suitable candidate from frozen seeds`);
  write(accepted);
}
