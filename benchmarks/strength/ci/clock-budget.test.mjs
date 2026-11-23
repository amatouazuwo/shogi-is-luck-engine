import test from 'node:test';
import assert from 'node:assert/strict';
import {planTurn} from './clock-budget.mjs';

test('1500ms amateur-four-dan target matches game profile when clock full',()=>{
  const v=planTurn({remainingMs:180000,nominalMs:1500,divisor:20,preMoveDelayMs:1300});
  assert.deepEqual(v,{clockBeforeMs:180000,preMoveDelayChargedMs:1300,
    clockAfterDelayMs:178700,searchMs:1500});
});
test('maximum has different 1/12 clock fraction and 6000ms cap',()=>{
  const v=planTurn({remainingMs:180000,nominalMs:6000,divisor:12,preMoveDelayMs:1300});
  assert.equal(v.searchMs,6000);
  const short=planTurn({remainingMs:12000,nominalMs:6000,divisor:12,preMoveDelayMs:1300});
  assert.equal(short.preMoveDelayChargedMs,600);
  assert.equal(short.searchMs,950);
  const four=planTurn({remainingMs:12000,nominalMs:1500,divisor:20,preMoveDelayMs:1300});
  assert.equal(four.searchMs,570);
});
test('old comparisons stay byte-equivalent in turn budgets with defaults',()=>{
  const v=planTurn({remainingMs:50000,nominalMs:1500});
  assert.equal(v.preMoveDelayChargedMs,0);
  assert.equal(v.searchMs,1500);
  assert.equal(planTurn({remainingMs:9000,nominalMs:6000}).searchMs,450);
});
test('remaining clock cannot produce nonpositive native request',()=>{
  for(const ms of [100,500,1500,6000]){
    for(const clock of [1,50,149,150,151,1000]){
      const p=planTurn({remainingMs:clock,nominalMs:ms,divisor:ms===6000?12:20,preMoveDelayMs:1300});
      assert.ok(p.searchMs>=1);
      assert.ok(p.preMoveDelayChargedMs<=Math.floor(clock/20));
    }
  }
});
test('reject impossible parameters rather than silently corrupting trials',()=>{
  assert.throws(()=>planTurn({remainingMs:-2,nominalMs:6000}),/remaining/);
  assert.throws(()=>planTurn({remainingMs:180000,nominalMs:0}),/nominal/);
  assert.throws(()=>planTurn({remainingMs:180000,nominalMs:1500,divisor:0}),/divisor/);
  assert.throws(()=>planTurn({remainingMs:180000,nominalMs:1500,preMoveDelayMs:-1}),/delay/);
});
