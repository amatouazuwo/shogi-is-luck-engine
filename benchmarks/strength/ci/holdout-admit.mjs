import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';

// Admission gate for externally generated *new* opening positions.
// It rejects exact duplicates against archived fixtures. It cannot prove that
// a position was never seen during engine training or human analysis.
const [candidatePath, ...archivePaths]=process.argv.slice(2);
assert.ok(candidatePath && archivePaths.length>0,
  'Usage: node holdout-admit.mjs new-cases.jsonl archived1.jsonl [archived2.jsonl...]');
function normalize(row) {
  const sfen=row.sfen??row.opening;
  assert.ok(typeof sfen==='string' && sfen.split(' ').length===4,'Missing SFEN');
  const kind=row.kind??row.family;
  assert.ok(typeof kind==='string'&&kind.length>0,'Missing board type');
  const holes=row.holes??[];
  assert.ok(Array.isArray(holes)&&holes.every(x=>typeof x==='string'));
  return JSON.stringify({kind,sfen:sfen.split(' ').slice(0,3).join(' '),holes:holes.slice().sort()});
}
const rows=path=>readFileSync(path,'utf8').split('\n').filter(Boolean).map(JSON.parse)
  .filter(x=>x.event===undefined||x.event==='opening');
const archived=new Set();
for(const path of archivePaths)for(const row of rows(path))archived.add(normalize(row));
const proposals=rows(candidatePath);
assert.ok(proposals.length>0,'No new proposals');
const seen=new Set(), admitted=[];
for(const row of proposals) {
  const key=normalize(row);
  assert.ok(!archived.has(key),'Candidate duplicates an archived opening');
  assert.ok(!seen.has(key),'Duplicate candidate opening');
  assert.ok(typeof row.source==='string'&&row.source.length>=5,'Missing independent origin');
  assert.ok(typeof row.sourceId==='string'&&row.sourceId.length>=1,'Missing source identifier');
  assert.ok(typeof row.collectedAt==='string'&&!Number.isNaN(Date.parse(row.collectedAt)),
    'Missing collection timestamp');
  assert.ok(['pit','blackhole','hirate','game'].includes(row.kind??row.family));
  seen.add(key);
  admitted.push({source:row.source,sourceId:row.sourceId,
    collectedAt:row.collectedAt,keySha256:createHash('sha256').update(key).digest('hex')});
}
mkdirSync('results',{recursive:true});
const payload={schema:1,fixtureSha256:createHash('sha256').update(readFileSync(candidatePath)).digest('hex'),
  admittedCount:admitted.length,admitted,
  warning:'Passing the exact-dedup gate is NOT proof of unseen training exposure, legal validity, or impartial case selection. Keep these positions sealed until a frozen candidate is evaluated.'};
writeFileSync('results/holdout-admission.json',JSON.stringify(payload,null,2)+'\n');
console.log('Admitted '+admitted.length+' novel-by-exact-key fixture candidates. Source audit still required.');
