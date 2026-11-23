import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseAdaptiveThink} from './adaptive-think-policy.mjs';

const features=(patch={})=>({inCheck:false,legalCount:35,
  captureMoves:0,promotionMoves:0,...patch});
test('quiet moves get one second, not six seconds',()=>{
  const p=chooseAdaptiveThink(features(),180000);
  assert.deepEqual(p,{maxThinkMs:1000,rawTargetMs:1000,
    reason:'quiet',clockGuard:'none',policy:'adaptive-feature-v1'});
});
test('checks always request up to six seconds with full clock',()=>{
  const p=chooseAdaptiveThink(features({inCheck:true,legalCount:3}),180000);
  assert.equal(p.maxThinkMs,6000);
  assert.equal(p.reason,'king-under-check');
});
test('tactical positions get intermediate cap, not always max',()=>{
  assert.equal(chooseAdaptiveThink(features({captureMoves:2}),180000).maxThinkMs,3000);
  assert.equal(chooseAdaptiveThink(features({promotionMoves:2}),180000).maxThinkMs,3000);
  assert.equal(chooseAdaptiveThink(features({legalCount:8}),180000).maxThinkMs,3000);
  assert.equal(chooseAdaptiveThink(features({captureMoves:1}),180000).maxThinkMs,1500);
});
test('near-flag safeguards bound even check-related requests',()=>{
  assert.equal(chooseAdaptiveThink(features({inCheck:true}),60000).maxThinkMs,1500);
  assert.equal(chooseAdaptiveThink(features({inCheck:true}),30000).maxThinkMs,750);
  assert.equal(chooseAdaptiveThink(features({inCheck:true}),10000).maxThinkMs,250);
  assert.equal(chooseAdaptiveThink(features(),10000).maxThinkMs,250);
});
test('bad or contradictory referee data is refused',()=>{
  assert.throws(()=>chooseAdaptiveThink(features({captureMoves:36}),180000),/exceeds/);
  assert.throws(()=>chooseAdaptiveThink(features({promotionMoves:-1}),180000),/Invalid/);
  assert.throws(()=>chooseAdaptiveThink(features({inCheck:0}),180000),/inCheck/);
  assert.throws(()=>chooseAdaptiveThink(features(),-1),/clock/);
});
