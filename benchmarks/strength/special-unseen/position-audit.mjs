import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, relative, resolve } from 'node:path';
import { position, positionFromSfen, square } from '../tactics/rules.mjs';
import { toSfen } from './game-context.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const archive=resolve(process.env.SPECIAL_ARCHIVE_ROOT||resolve(here,'..'));
const work=resolve(process.env.SPECIAL_RESULTS_ROOT||dirname(archive));
const knownFilename=resolve(here,'prior-special-identities.json');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const skip=new Set(['.git','node_modules','target','eval','python-tools','special-unseen']);

function coordinates(holes) {
  const list=Array.isArray(holes)?holes:typeof holes==='string'?holes.split(/[ ,]+/):[];
  if(!list.length)return null;
  const normalized=list.map(i=>Number.isInteger(i)&&i>=0&&i<81?square(i):i);
  return normalized.every(i=>typeof i==='string'&&/^[1-9][a-i]$/.test(i))?normalized:null;
}

export function canonical({sfen,holes}) {
  const cells=coordinates(holes);
  assert.ok(cells?.length,sfen);
  assert.equal(new Set(cells).size,cells.length,sfen);
  const x=positionFromSfen(sfen,cells);
  const options=[];
  for(const swap of [false,true]){
    for(const mirror of [false,true]){
      const flip=i=>{
        const row=i/9|0,col=i%9;
        const r=swap?8-row:row;
        const c=swap!==mirror?8-col:col;
        return r*9+c;
      };
      const board=Array(81).fill(null);
      for(const [i,p] of x.board.entries()){
        if(p)board[flip(i)]={...p,side:swap?1-p.side:p.side};
      }
      const obstructions=x.holes.map(flip);
      const hands=swap?x.hands.slice().reverse():x.hands;
      const transformed=position(board,swap?1-x.turn:x.turn,obstructions,hands,0);
      const rendered=toSfen(transformed,{allowHoles:true});
      if(!rendered)throw Error('Unsupported SFEN '+sfen);
      options.push(rendered.split(' ').slice(0,3).join(' ')+' '+obstructions.map(square).sort().join(','));
    }
  }
  return options.sort()[0];
}

export function loadPrior() {
  return new Set(JSON.parse(readFileSync(knownFilename,'utf8')).keys);
}

function knownFiles(){
  const found=[];
  function visit(directory){
    for(const item of readdirSync(directory,{withFileTypes:true})){
      if(skip.has(item.name)||item.name.startsWith('YaneuraOu')||item.name.startsWith('startup-prime-sandbox.'))continue;
      const path=resolve(directory,item.name);
      if(item.isDirectory())visit(path);
      else if(item.isFile()&&/\.jsonl?$/.test(item.name)&&statSync(path).size<=48*1024*1024)found.push(path);
    }
  }
  visit(archive);
  for(const item of readdirSync(work,{withFileTypes:true})){
    if(item.isFile()&&/^benchmark.*\.jsonl$/.test(item.name))found.push(resolve(work,item.name));
  }
  return found.sort();
}
function findPositions(data,visit){
  if(!data||typeof data!=='object')return;
  if(typeof data.sfen==='string'&&coordinates(data.holes))visit(data);
  for(const value of Object.values(data))if(value&&typeof value==='object')findPositions(value,visit);
}
function build() {
  const keys=new Set(), sources=[], rejected=[];
  for(const file of knownFiles()){
    const raw=readFileSync(file);
    const text=raw.toString('utf8').trim();
    if(!text)continue;
    const path=relative(work,file);
    let observed=0;
    const add=data=>findPositions(data,p=>{
      try{keys.add(canonical(p));observed++;}
      catch(error){rejected.push({file:path,sfen:p.sfen,reason:error.message});}
    });
    if(file.endsWith('.jsonl')){
      for(const line of text.split('\n')){
        try{add(JSON.parse(line));}
        catch(error){throw Error(path+' invalid JSONL row', {cause:error});}
      }
    }else add(JSON.parse(text));
    if(observed)sources.push({path,observed,sha256:hash(raw)});
  }
  const manifest={policy:'SFEN board/turn/hands plus sorted holes. Canonical under file mirror and 180° rotation with color/turn exchange. Move number ignored.',
    unique:keys.size,sources,rejected,keys:[...keys].sort()};
  writeFileSync(knownFilename,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({oldUnique:keys.size,files:sources.length,rejectedRecords:rejected.length,sha256:hash(readFileSync(knownFilename))}));
}
if(process.argv[1]&&basename(process.argv[1])===basename(fileURLToPath(import.meta.url)))build();
