import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

const [, ,binary]=process.argv;
assert.ok(binary,'Usage: node referee-feature-smoke.mjs PATH_TO_REFEREE');
const proc=spawn(binary,{stdio:['pipe','pipe','inherit']});
const it=createInterface({input:proc.stdout})[Symbol.asyncIterator]();
const ask=async (command,sfen)=>{
  proc.stdin.write(command+'\t'+sfen+'\t\n');
  let timer;
  try {
    const n=await Promise.race([it.next(),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Referee timeout')),5000))]);
    assert.equal(n.done,false);
    const result=JSON.parse(n.value);
    assert.ok(!result.error,JSON.stringify(result));
    return result;
  }finally{clearTimeout(timer);}
};
try{
  const sfen='4k4/9/9/9/4R4/9/9/9/4K4 w - 1';
  const check=await ask('features',sfen);
  const legal=await ask('legal',sfen);
  assert.equal(check.inCheck,true,'White king is under rook check');
  assert.equal(check.legalCount,legal.moves.length);
  assert.ok(Number.isInteger(check.captureMoves)&&check.captureMoves>=0);
  assert.ok(Number.isInteger(check.promotionMoves)&&check.promotionMoves>=0);
  const notCheck=await ask('features','4k4/9/9/9/4R4/9/9/9/4K4 b - 1');
  assert.equal(notCheck.inCheck,false,'Black king is not in check');
  console.log(JSON.stringify({event:'referee-features-smoke',status:'PASS',
    checkedKingState:true,legalCount:check.legalCount}));
}finally{proc.stdin.end();proc.kill();}
