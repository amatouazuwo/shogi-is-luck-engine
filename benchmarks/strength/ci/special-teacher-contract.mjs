import assert from 'node:assert/strict';

// Pilot search tiers. Not grades, Elo, or a rank-calibration table.
export const TRIAL_NODE_TIERS=Object.freeze([500,2000,10000,50000]);
export const TEACHER_BUDGET_MS=6000;
export const STUDENT_TIME_CAP_MS=1000;
export const FIXTURE_STAGES=Object.freeze(['opening','middle','reduced']);

const round=x=>Math.round(x*1000)/1000;

export function auditTeacherDataset(rows,expectedFixtures){
  assert.ok(Array.isArray(rows)&&rows.length>0,'Teacher positions required');
  assert.ok(Array.isArray(expectedFixtures)&&expectedFixtures.length===rows.length,
    'All source positions must be evaluated');
  const observed=new Set();
  for(const row of rows){
    const f=expectedFixtures.find(x=>x.pair===row.pair&&x.kind===row.kind);
    assert.ok(f,'Unknown teacher source position');
    const key=row.pair+':'+row.kind;
    assert.ok(!observed.has(key),'Repeated teacher position');observed.add(key);
    assert.equal(row.stage,f.stage);
    assert.equal(row.sfen,f.sfen);
    assert.deepEqual(row.holes,f.holes);
    assert.ok(Number.isInteger(row.legal)&&row.legal>0);
    assert.ok(Array.isArray(row.legalMoves)&&row.legalMoves.length===row.legal);
    assert.ok(row.legalMoves.includes(row.teacher.bestmove),
      'Teacher must choose an independently legal move');
    assert.ok(row.teacher.depth>=0&&row.teacher.depth<=64);
    assert.ok(Number.isInteger(row.teacher.nodes)&&row.teacher.nodes>=0);
    assert.ok(row.teacher.elapsed_ms>=0);
    assert.equal(row.teacher.requestMs,TEACHER_BUDGET_MS);
    assert.equal(row.students.length,TRIAL_NODE_TIERS.length);
    assert.deepEqual(row.students.map(x=>x.nodeCap),TRIAL_NODE_TIERS);
    for(const x of row.students){
      assert.ok(row.legalMoves.includes(x.bestmove),
        'Student must choose an independently legal move');
      assert.ok(x.nodes>=0&&x.nodes<=x.nodeCap,
        'Student exceeded configured native node limit');
      assert.ok(x.depth>=0&&x.depth<=64);
      assert.ok(Number.isFinite(x.score),'Missing numeric candidate score');
      assert.ok(x.elapsed_ms>=0);
      assert.equal(x.requestMs,STUDENT_TIME_CAP_MS);
      assert.equal(x.sameMoveAsTeacher,x.bestmove===row.teacher.bestmove,
        'Teacher agreement was miscounted');
    }
  }
  const stats=tier=>{
    const picked=rows.map(x=>x.students.find(y=>y.nodeCap===tier));
    const matches=picked.filter(x=>x.sameMoveAsTeacher).length;
    return {
      nodeCap:tier,samples:picked.length,
      matches,disagreements:picked.length-matches,
      moveAgreementRate:round(matches/picked.length),
      meanSearchDepth:round(picked.reduce((a,x)=>a+x.depth,0)/picked.length),
      meanNodes:round(picked.reduce((a,x)=>a+x.nodes,0)/picked.length),
      meanElapsedMs:round(picked.reduce((a,x)=>a+x.elapsed_ms,0)/picked.length),
    };
  };
  const across=TRIAL_NODE_TIERS.map(stats);
  const byStage=Object.fromEntries(FIXTURE_STAGES.map(stage=>{
    const subset=rows.filter(x=>x.stage===stage);
    assert.ok(subset.length>0,'No observations for stage '+stage);
    return [stage,TRIAL_NODE_TIERS.map(tier=>{
      const candidate=subset.map(r=>r.students.find(x=>x.nodeCap===tier));
      const matches=candidate.filter(x=>x.sameMoveAsTeacher).length;
      return {nodeCap:tier,samples:candidate.length,matches,
        rate:round(matches/candidate.length)};
    })];
  }));
  const byObstacle=Object.fromEntries(['pit','blackhole'].map(kind=>{
    const subset=rows.filter(x=>x.kind===kind);
    return [kind,TRIAL_NODE_TIERS.map(tier=>{
      const candidate=subset.map(r=>r.students.find(x=>x.nodeCap===tier));
      const matches=candidate.filter(x=>x.sameMoveAsTeacher).length;
      return {nodeCap:tier,samples:candidate.length,matches,
        rate:round(matches/candidate.length)};
    })];
  }));
  return {
    event:'special-position-teacher-scorecard',status:'pilot-only',
    reference:'same-rsshogi-NNUE-Worker-6000ms',
    teacherIsGroundTruth:false,teacherIsExternalHuman:false,
    amateurRankEstablished:false,
    independentBestmoveCount:1,multiPvAvailable:false,
    positions:rows.length,across,byStage,byObstacle,
    caution:'Only top-move agreement, never a correct-move rate. A deeper NNUE '+
      'is not ground truth; many moves may be equally good, and teacher judgment '+
      'can change with time and environment. Do not compare score magnitudes '+
      'across differently budgeted searches or call disagreements blunders.',
  };
}
