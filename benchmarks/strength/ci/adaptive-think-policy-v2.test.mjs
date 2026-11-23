import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseAdaptiveThinkV2} from './adaptive-think-policy-v2.mjs';

const f=(x={})=>({inCheck:false,legalCount:32,captureMoves:4,promotionMoves:1,...x});
test('ordinary positions with captures stay on one second',()=>{
  for(const captures of [0,1,2,3,4,5,8]){
    const p=chooseAdaptiveThinkV2(f({captureMoves:captures,promotionMoves:1}),180000);
    assert.equal(p.maxThinkMs,1000);
  }
});
test('king defence has priority, forced narrow response may use six seconds',()=>{
  const forced=chooseAdaptiveThinkV2(f({inCheck:true,legalCount:2,captureMoves:0,promotionMoves:0}),180000);
  assert.equal(forced.rawTargetMs,6000);
  assert.equal(forced.reason,'forced-king-defence');
  const ordinary=chooseAdaptiveThinkV2(f({inCheck:true,legalCount:9,captureMoves:1,promotionMoves:0}),180000);
  assert.equal(ordinary.maxThinkMs,3000);
});
test('only strong composite tactical signals deserve 2 seconds',()=>{
  assert.equal(chooseAdaptiveThinkV2(f({captureMoves:5,promotionMoves:2}),180000).maxThinkMs,2000);
  assert.equal(chooseAdaptiveThinkV2(f({captureMoves:4,promotionMoves:2}),180000).maxThinkMs,1000);
  assert.equal(chooseAdaptiveThinkV2(f({captureMoves:5,promotionMoves:1}),180000).maxThinkMs,1000);
  assert.equal(chooseAdaptiveThinkV2(f({legalCount:5,captureMoves:0,promotionMoves:0}),180000).maxThinkMs,3000);
});
test('clock safety takes precedence even under forced check',()=>{
  const forced=f({inCheck:true,legalCount:2,captureMoves:0,promotionMoves:0});
  for(const [ms,expected] of [[90000,6000],[60000,1500],[30000,750],[10000,250]]){
    assert.equal(chooseAdaptiveThinkV2(forced,ms).maxThinkMs,expected);
  }
});
test('invalid feature counts and clocks fail closed',()=>{
  assert.throws(()=>chooseAdaptiveThinkV2(f({captureMoves:33}),180000),/exceeds/);
  assert.throws(()=>chooseAdaptiveThinkV2(f({legalCount:-1}),180000),/legalCount/);
  assert.throws(()=>chooseAdaptiveThinkV2(f({inCheck:null}),180000),/inCheck/);
  assert.throws(()=>chooseAdaptiveThinkV2(f(),-1),/remaining/);
});
