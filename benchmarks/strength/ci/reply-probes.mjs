import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,appendFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

// Diagnostic only: for each losing choice point, compare the played move with
// deterministic legal alternatives and independently search ONE opponent reply.
// Both following moves are from the reference; no value score or best-move claim is produced.
const [referee,input] = process.argv.slice(2);
assert.ok(referee && input,'Usage: node reply-probes.mjs REFEREE replay-checkpoints.json');
const archive=JSON.parse(readFileSync(input,'utf8'));
assert.equal(archive.schema,1);
assert.ok(Array.isArray(archive.checkpoints));
const child=spawn(referee,[],{stdio:['pipe','pipe','inherit']});
const lines=createInterface({input:child.stdout})[Symbol.asyncIterator]();
async function query(...parts) {
  child.stdin.write(parts.join('\t')+'\n');
  let timer;
  try {
    const response=await Promise.race([lines.next(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Referee timeout')),10000)})]);
    assert.equal(response.done,false,'Referee unexpectedly stopped');
    const data=JSON.parse(response.value);
    assert.ok(!data.error,'Referee failure: '+parts[0]);
    return data;
  } finally {clearTimeout(timer);}
}
const records=[];
try {
  // Bounded smoke: at most 4 positions; played move plus 2 sorted alternatives.
  for(const point of archive.checkpoints.slice(0,4)) {
    assert.ok(point.legalMoves.includes(point.playedMove),'Played move not in checkpoint legal set');
    const holes=point.holes.join(',');
    const actual=(await query('legal',point.sfen,holes)).moves.slice().sort();
    assert.deepEqual(actual,point.legalMoves,'Legality changed since checkpoint');
    const moves=[point.playedMove,...actual.filter(x=>x!==point.playedMove).slice(0,2)];
    const branches=[];
    for(const move of moves) {
      const after=(await query('step',point.sfen,holes,move)).sfen;
      const replies=(await query('legal',after,holes)).moves.slice().sort();
      let reply=null,replyPosition=null,referenceSearch=null;
      if(replies.length) {
        await query('reset');
        const r=await query('go','100',after,holes);
        assert.ok(replies.includes(r.bestmove),'Referee returned an illegal reply');
        reply=r.bestmove;
        referenceSearch={depth:r.depth??null,nodes:r.nodes??null,elapsedMs:r.elapsed_ms??null};
        replyPosition=(await query('step',after,holes,reply)).sfen;
      }
      // A second reference move shows one possible continuation, not a candidate-engine response.
      let referenceContinuation=null;
      if(replyPosition!==null) {
        const continuationMoves=(await query('legal',replyPosition,holes)).moves.slice().sort();
        if(continuationMoves.length) {
          await query('reset');
          const next=await query('go','100',replyPosition,holes);
          assert.ok(continuationMoves.includes(next.bestmove),'Illegal reference continuation');
          const nextPosition=(await query('step',replyPosition,holes,next.bestmove)).sfen;
          referenceContinuation={move:next.bestmove,afterSfen:nextPosition,
            legalCount:continuationMoves.length,depth:next.depth??null,
            nodes:next.nodes??null,elapsedMs:next.elapsed_ms??null};
        }
      }
      branches.push({move,played:move===point.playedMove,afterCandidateSfen:after,
        legalOpponentReplies:replies.length,referenceReply:reply,afterReplySfen:replyPosition,
        referenceSearch,referenceContinuation});
    }
    records.push({file:point.file,kind:point.kind,pair:point.pair,candidateSide:point.candidateSide,
      candidatePly:point.candidatePly,sfen:point.sfen,holes:point.holes,
      sourceFixtureSha256:point.sourceFixtureSha256,budgetMs:point.budgetMs,
      rootLegalMoveCount:actual.length,exploredCandidateMoveCount:branches.length,
      allCandidateMovesCovered:branches.length===actual.length,
      branches,assessment:'UNRANKED_REPLIES_ONLY'});
  }
} finally {child.stdin.end();child.kill();}
mkdirSync('results',{recursive:true});
const payload={schema:1,referenceReplyBudgetMs:100,maxPositions:4,maxAlternativesPerPosition:2,
  records,warning:'Two reference continuation moves are not minimax, a candidate-engine search, a move score, tactical proof or evidence of improvement. Archived losing lines are not fresh holdout data.'};
writeFileSync('results/reply-probes.json',JSON.stringify(payload,null,2)+'\n');
const md='## Diagnostic reply probes\nExamined '+records.length+' losing choice points and '+records.reduce((n,x)=>n+x.branches.length,0)+
  ' played/alternative branches at 100ms per reference search for up to two continuation plies. No moves are ranked.\n';
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,md);
console.log(md);
