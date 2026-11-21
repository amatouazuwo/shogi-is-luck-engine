import { fileURLToPath as strengthPath, pathToFileURL as strengthFileURL } from 'node:url';
import { resolve as strengthJoin } from 'node:path';
const strengthArchive = strengthPath(new URL('../', import.meta.url));
const strengthGame = strengthJoin(process.env.GAME_REPO || strengthJoin(strengthArchive, '../../../shogi-is-luck'));
const strengthSdk = strengthJoin(process.env.OBSTACLE_SDK || strengthJoin(strengthGame, 'ai/obstacle-sdk'));

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { toSfen, toUsi } = await import(strengthFileURL(strengthJoin(strengthGame, 'ai/rsshogi-position.mjs')));

const source = readFileSync(strengthJoin(strengthGame, 'index.html'),'utf8');
function segment(start,end) {
  const first=source.indexOf(start), last=source.indexOf(end,first);
  assert.ok(first>=0&&last>first,start);
  return source.slice(first,last);
}
const rng=Object.create(Math);
const window={};
const game = new Function('Math','window',
  segment('const $=id=>','const names=')+
  segment('const rand=n=>','let g=null')+
  segment('const shallowBoard=','function drawCeremony(')+
  segment('function repeatHash(','// Dedicated pre-match selection view.')+
  'return {getLegal, sim, inCheck, independentBoard, boardHoles:blackholeCells, isInnerHole, piece}'
)(rng,window);

export const gameRules=game;
export const seedRng=(seed)=>{
  let x=seed>>>0;
  return ()=>{
    x=(Math.imul(1664525,x)+1013904223)>>>0;
    return x/4294967296;
  };
};
export const pieceUnits={R:10,B:8,G:6,S:5,N:4,L:3,P:1};
const pieceSet={R:2,B:2,G:4,S:4,N:4,L:4,P:18};
export const square=(index)=>String(9-index%9)+String.fromCharCode(97+(index/9|0));
export const fromSquare=(square)=>(square.charCodeAt(1)-97)*9+9-Number(square[0]);
export const point=(row,col)=>row*9+col;
export const position=(board,turn,holes,hands=[{},{}],steps=0)=>({board,turn,holes,hands,steps,time:[180000,180000]});

export function positionFromSfen(sfen,holeSquares) {
  const [ranks,side,hand,ply]=sfen.split(' ');
  const board=[];
  for(const row of ranks.split('/')){
    let promoted=false;
    for(const token of row){
      if(token==='+'){promoted=true;continue;}
      if(/[1-9]/.test(token))board.push(...Array(Number(token)).fill(null));
      else board.push(game.piece(token.toUpperCase(),Number(token===token.toLowerCase()),promoted));
      promoted=false;
    }
  }
  assert.equal(board.length,81);
  const hands=[{},{}];
  if(hand!=='-'){
    for(const [,quantity,token] of hand.matchAll(/(\d*)([RBGSNLPrbgsnlp])/g)){
      hands[Number(token===token.toLowerCase())][token.toUpperCase()]=Number(quantity||1);
    }
  }
  return position(board,side==='b'?0:1,holeSquares.map(fromSquare),hands,Number(ply)-1);
}
export function play(x,move) {
  const captured=x.board[move.to];
  assert.notEqual(captured?.type,'K');
  const hands=x.hands.map(hand=>({...hand}));
  if(captured)hands[x.turn][captured.type]=(hands[x.turn][captured.type]||0)+1;
  if(move.drop)hands[x.turn][move.drop]--;
  return position(game.sim(x,move,x.turn).board,1-x.turn,x.holes,hands,x.steps+1);
}
export function representable(x) {
  const counts={};
  const kings=[0,0];
  for(const [index,p] of x.board.entries()){
    if(!p)continue;
    if(x.holes.includes(index))return false;
    if(p.type==='K')kings[p.side]++;
    else counts[p.type]=(counts[p.type]||0)+1;
  }
  for(const hand of x.hands){
    for(const [type,count] of Object.entries(hand))counts[type]=(counts[type]||0)+count;
  }
  return kings.every(n=>n===1)&&Object.keys(counts).every(t=>counts[t]<=pieceSet[t])&&
    !game.inCheck(x,1-x.turn)&&Boolean(toSfen(x,{allowHoles:true}));
}
export const legal=x=>game.getLegal(x,x.turn);
const sortedUsi=moves=>moves.map(toUsi).sort();
const terminal=x=>legal(x).length===0;

export function winsInOne(x,{stopAfterOne=false}={}) {
  const wins=[];
  for(const move of legal(x)){
    const child=play(x,move);
    if(terminal(child)){
      wins.push({move:toUsi(move),mate:game.inCheck(child,child.turn)});
      if(stopAfterOne)break;
    }
  }
  return wins;
}
export function safeMoves(x) {
  const roots=legal(x);
  const safe=[];
  for(const move of roots){
    const child=play(x,move);
    if(!winsInOne(child,{stopAfterOne:true}).length)safe.push(move);
  }
  return sortedUsi(safe);
}
export function gainScore(x) {
  // Value of the captured piece minus the largest legal immediate reply capture.
  // The score implies material only. Promotions do not alter this value.
  const captures=legal(x).filter(move=>x.board[move.to]);
  const scores=new Map();
  for(const move of captures){
    const child=play(x,move);
    const value=pieceUnits[x.board[move.to].type];
    let replyCost=0;
    for(const reply of legal(child)){
      const victim=child.board[reply.to];
      if(victim)replyCost=Math.max(replyCost,pieceUnits[victim.type]);
    }
    scores.set(toUsi(move),value-replyCost);
  }
  const best=Math.max(0,...scores.values());
  const bestMoves=[...scores].filter(([,score])=>best>0&&score===best).map(([move])=>move).sort();
  return {best,bestMoves,scores:Object.fromEntries(scores)};
}
export function rayCrosses(x,move) {
  const piece=x.board[move.from];
  if(!piece||!['R','B','L'].includes(piece.type)||piece.pr&&piece.type==='L')return false;
  const row=(move.from/9)|0, col=move.from%9;
  const dr=((move.to/9)|0)-row, dc=move.to%9-col;
  if(!(dr===0||dc===0||Math.abs(dr)===Math.abs(dc)))return false;
  if((piece.type==='R'&&dr&&dc)||(piece.type==='B'&&(!dr||!dc)))return false;
  const span=Math.max(Math.abs(dr),Math.abs(dc));
  for(let i=1;i<span;i++){
    if(x.holes.includes(point(row+i*Math.sign(dr),col+i*Math.sign(dc))))return true;
  }
  return false;
}
export function label(x,category) {
  const moves=legal(x);
  const available=sortedUsi(moves);
  if(category==='no-legal-loss'){
    return {available,goodMoves:!available.length&&!game.inCheck(x,x.turn)?['resign']:[]};
  }
  if(category==='mate-in-one'){
    const wins=winsInOne(x);
    return {available,goodMoves:wins.length&&wins.every(w=>w.mate)?wins.map(w=>w.move).sort():[]};
  }
  if(category==='evade-forced-win'){
    return {available,goodMoves:safeMoves(x)};
  }
  const gain=gainScore(x);
  if(category==='material-gain'){
    return {available,goodMoves:gain.best>=4?gain.bestMoves:[],bestGain:gain.best};
  }
  if(category==='ray-blocking'){
    const opened={...x,holes:[]};
    if(game.inCheck(opened,1-opened.turn))return {available,goodMoves:[]};
    const advanced=gainScore(opened);
    const blocked=legal(opened).filter(m=>advanced.bestMoves.includes(toUsi(m))&&rayCrosses(x,m)).map(toUsi).sort();
    const goodMoves=gain.best>=3&&advanced.best>gain.best&&blocked.length===advanced.bestMoves.length?gain.bestMoves:[];
    return {available,goodMoves,bestGain:gain.best,openedBest:advanced.best,blocked};
  }
  assert.fail(category);
}
export function info(x,category){
  const {available,goodMoves,...training}=label(x,category);
  return {
    sfen:toSfen(x,{allowHoles:true}),
    holes:x.holes.map(square),
    goodMoves,
    available,
    inCheck:game.inCheck(x,x.turn),
    ...training,
  };
}
