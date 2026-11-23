import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync, appendFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

// Verify complete logged move sequences using the independent reference.
// Generate bounded, reproducible candidate checkpoints. This does NOT evaluate moves.
const [referee, ...inputs] = process.argv.slice(2);
assert.ok(referee && inputs.length, 'Usage: node replay-check.mjs REFEREE matches.jsonl [other.jsonl...]');
const child = spawn(referee, [], {stdio: ['pipe','pipe','inherit']});
const lines = createInterface({input: child.stdout})[Symbol.asyncIterator]();
async function query(...args) {
  child.stdin.write(args.join('\t') + '\n');
  let timeout;
  try {
    const response = await Promise.race([
      lines.next(),
      new Promise((_, reject) => {timeout=setTimeout(()=>reject(Error('Referee timeout')),10000);})
    ]);
    assert.equal(response.done, false, 'Referee stopped unexpectedly');
    const value = JSON.parse(response.value);
    assert.ok(!value.error, 'Referee error during ' + args[0]);
    return value;
  } finally {clearTimeout(timeout);}
}
const checkpoints = [];
let verifiedGames = 0, verifiedMoves = 0, skippedTerminalMoves = 0;
try {
  for(const file of inputs) {
    const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
    const config = rows.find(r=>r.event==='config');
    assert.ok(config, 'Missing config: '+file);
    for(const game of rows.filter(r=>r.event==='game')) {
      assert.ok(Array.isArray(game.turns) && typeof game.start==='string' && Array.isArray(game.holes));
      const holes = game.holes.join(',');
      let sfen = game.start;
      const candidatePositions = [];
      for(let i=0;i<game.turns.length;i++) {
        const turn=game.turns[i];
        assert.equal(turn.sfenBefore, sfen, 'SFEN mismatch: '+file+' / '+game.kind+' / '+game.pair+' ply '+(i+1));
        const side=sfen.split(' ')[1]==='b'?0:1;
        assert.equal(turn.side,side,'Turn mismatch at ply '+(i+1));
        const legal=(await query('legal',sfen,holes)).moves;
        if(turn.engine==='candidate') candidatePositions.push({ply:i+1,sfen,move:turn.move,legal});
        if(turn.move==='resign') {
          assert.equal(game.reason,'resign','Unexpected resignation');
          assert.equal(i,game.turns.length-1,'Moves after resignation');
          skippedTerminalMoves++;
          break;
        }
        assert.ok(legal.includes(turn.move),'Illegal logged move: '+turn.move+' at ply '+(i+1));
        verifiedMoves++;
        // Clock is checked before step in the match runner.
        if(game.reason==='clock' && i===game.turns.length-1) {
          skippedTerminalMoves++;
          break;
        }
        sfen=(await query('step',sfen,holes,turn.move)).sfen;
      }
      verifiedGames++;
      if(game.winner!==null && game.winner!==game.candidateSide) {
        // Last forced move (only one legal option) is rarely an actionable improvement.
        // Keep the most recent three genuine choice points as independent replay probes.
        const options = candidatePositions.filter(x=>x.legal.length>=2).slice(-3).reverse();
        for(const position of options) {
          checkpoints.push({
            file, kind:game.kind, pair:game.pair, candidateSide:game.candidateSide,
            reason:game.reason, start:game.start, holes:game.holes,
            sourceFixtureSha256:config.fixtureSha??null,
            sourceCandidateWasmSha256:config.candidateSha??null,
            sourceBaselineWasmSha256:config.baselineSha??null,
            budgetMs:config.budget, candidatePly:position.ply,
            sfen:position.sfen, playedMove:position.move,
            legalMoveCount:position.legal.length,
            legalMoves:position.legal.slice().sort(),
            notice:'Choice point in a loss, not a proven blunder. Legal alternatives are not ranked.'
          });
        }
      }
    }
  }
} finally {
  child.stdin.end();
  child.kill();
}
checkpoints.sort((a,b)=>a.file.localeCompare(b.file)||a.kind.localeCompare(b.kind)||a.pair-b.pair||a.candidateSide-b.candidateSide);
mkdirSync('results',{recursive:true});
const payload={schema:1, verifiedGames, verifiedMoves, skippedTerminalMoves,
  checkpointCount:checkpoints.length, perLossLimit:3, checkpoints,
  warning:'Reference-rules replay only. Does not prove parity with private game, strength improvement, or blunder causality.'};
writeFileSync('results/replay-checkpoints.json',JSON.stringify(payload,null,2)+'\n');
const summary='## Independent replay integrity\nVerified games: '+verifiedGames+
  '; legal moves: '+verifiedMoves+'; terminal moves without state transition: '+skippedTerminalMoves+
  '; loss checkpoints: '+checkpoints.length+'.\nAll candidate alternatives are legal moves, not ranked suggestions.\n';
if(process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary);
console.log(summary);
