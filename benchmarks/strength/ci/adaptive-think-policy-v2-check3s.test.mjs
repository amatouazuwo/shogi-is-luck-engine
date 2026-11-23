import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseAdaptiveThinkV2} from './adaptive-think-policy-v2.mjs';
import {chooseAdaptiveThinkV2Check3s} from './adaptive-think-policy-v2-check3s.mjs';

const f=(v={})=>({inCheck:false,legalCount:30,captureMoves:4,promotionMoves:1,...v});
test('single legal check response: 3s not 6s with a full clock',()=>{
  const features=f({inCheck:true,legalCount:1,captureMoves:0,promotionMoves:0});
  assert.equal(chooseAdaptiveThinkV2(features,180000).maxThinkMs,6000);
  const p=chooseAdaptiveThinkV2Check3s(features,180000);
  assert.equal(p.maxThinkMs,3000);
  assert.equal(p.rawTargetMs,3000);
  assert.equal(p.reason,'forced-king-defence-capped-at-3s');
  assert.equal(p.policy,'adaptive-feature-v2-check3s');
});
test('all other situations retain v2 search ceilings',()=>{
  for(const features of [
    f(),f({captureMoves:6,promotionMoves:2}),
    f({inCheck:true,legalCount:4,captureMoves:0,promotionMoves:0}),
    f({legalCount:5,captureMoves:1,promotionMoves:0}),
  ]) for(const clock of [180000,60000,30000,10000]){
    const old=chooseAdaptiveThinkV2(features,clock);
    const current=chooseAdaptiveThinkV2Check3s(features,clock);
    assert.equal(current.maxThinkMs,old.maxThinkMs);
    assert.equal(current.rawTargetMs,old.rawTargetMs);
    assert.equal(current.reason,old.reason);
    assert.equal(current.clockGuard,old.clockGuard);
  }
});
test('low clock protections still dominate forced-check variation',()=>{
  const features=f({inCheck:true,legalCount:3,captureMoves:0,promotionMoves:0});
  for(const [clock,max] of [[60000,1500],[30000,750],[10000,250]]){
    assert.equal(chooseAdaptiveThinkV2Check3s(features,clock).maxThinkMs,max);
  }
});
test('bad tactical and clock inputs are rejected by original validation',()=>{
  assert.throws(()=>chooseAdaptiveThinkV2Check3s(f({legalCount:-1}),180000),/legalCount/);
  assert.throws(()=>chooseAdaptiveThinkV2Check3s(f(),-1),/remaining/);
});
