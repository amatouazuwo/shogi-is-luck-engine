import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync, appendFileSync} from 'node:fs';

// Creates an auditable, unranked shortlist for Codex investigation.
// Differences in reference responses are clues for inspection, NOT strength evidence.
const [input='results/reply-probes.json'] = process.argv.slice(2);
const payload=JSON.parse(readFileSync(input,'utf8'));
assert.equal(payload.schema,1,'Unsupported reply-probe schema');
assert.ok(Array.isArray(payload.records),'Missing probe records');
const result=[];
for(const r of payload.records) {
  assert.ok(typeof r.sfen==='string' && Array.isArray(r.holes));
  assert.ok(Array.isArray(r.branches) && r.branches.length>0 && r.branches.length<=3);
  assert.equal(r.branches.filter(b=>b.played===true).length,1,'Exactly one played move required');
  assert.equal(new Set(r.branches.map(b=>b.move)).size,r.branches.length,'Duplicate moves');
  for(const branch of r.branches) {
    assert.ok(typeof branch.move==='string' && typeof branch.afterCandidateSfen==='string');
    if(branch.referenceReply===null) {
      assert.equal(branch.legalOpponentReplies,0,'Missing reply despite legal opponent moves');
    } else {
      assert.ok(branch.legalOpponentReplies>0,'Reply was present in terminal position');
      assert.ok(typeof branch.afterReplySfen==='string','Missing replay position');
    }
  }
  const played=r.branches.find(b=>b.played);
  const alternatives=r.branches.filter(b=>!b.played);
  const distinctReplies=new Set(r.branches.map(b=>b.referenceReply??'(terminal)'));
  const divergent=distinctReplies.size>1;
  const terminals=r.branches.filter(b=>b.legalOpponentReplies===0).length;
  result.push({
    sourceFile:r.file,boardKind:r.kind,pair:r.pair,candidateSide:r.candidateSide,
    candidatePly:r.candidatePly,startSfen:r.sfen,holes:r.holes,
    sourceFixtureSha256:r.sourceFixtureSha256??null,budgetMs:r.budgetMs,
    actualMove:played.move,actualReferenceReply:played.referenceReply,
    alternatives:alternatives.map(b=>({move:b.move,referenceReply:b.referenceReply,
      referenceContinuation:b.referenceContinuation??null})),
    differingReferenceReplies:divergent,terminalBranches:terminals,
    inspectionTier:terminals>0?'TERMINAL_RULE_CHECK':divergent?'RESPONSE_DIVERGENCE':'SAME_REFERENCE_REPLY',
    interpretation:'Diagnostic priority only; not a move-quality ranking or proof that the played move was bad.'
  });
}
const order={TERMINAL_RULE_CHECK:0,RESPONSE_DIVERGENCE:1,SAME_REFERENCE_REPLY:2};
result.sort((a,b)=>order[a.inspectionTier]-order[b.inspectionTier] ||
 a.sourceFile.localeCompare(b.sourceFile) || a.boardKind.localeCompare(b.boardKind) ||
 a.pair-b.pair || a.candidatePly-b.candidatePly || a.candidateSide-b.candidateSide);
mkdirSync('results',{recursive:true});
const output={schema:1,source:input,caseCount:result.length,cases:result,
 caveats:[
  'Original starts are archived; this is not a fresh held-out evaluation.',
  'A different reference reply does not imply a better alternative move.',
  'Search results have not been checked for tactical correctness against all legal replies.',
  'Do not promote or deploy a candidate based on this diagnostic list.'
 ]};
writeFileSync('results/codex-review.json',JSON.stringify(output,null,2)+'\n');
const lines=[
 '## Codex diagnostic review shortlist',
 'Cases are sorted for investigation, NOT ranked as stronger moves.',
 '| Board / pair / ply | Played | Other explored moves | Reference replies diverge | Inspection tier |',
 '|---|---|---|---|---|',
 ...result.map(x=>'| '+x.boardKind+' / '+x.pair+' / '+x.candidatePly+
 ' | '+x.actualMove+' | '+x.alternatives.map(y=>y.move).join(', ')+
 ' | '+(x.differingReferenceReplies?'yes':'no')+' | '+x.inspectionTier+' |'),
 'No tactical proof, engine score, or human-dan estimate is claimed.'
];
const summary=lines.join('\n')+'\n';
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary);
console.log(summary);
