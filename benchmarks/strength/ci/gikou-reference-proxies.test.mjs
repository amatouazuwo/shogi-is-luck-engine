import test from 'node:test';
import assert from 'node:assert/strict';
import {FOUR_DAN_PROVISIONAL_GIKOU,referenceProxyForDepth}
  from './gikou-reference-proxies.mjs';

test('user-defined Gikou depth8 is a clearly provisional fourth-dan reference',()=>{
  const profile=referenceProxyForDepth(8);
  assert.equal(profile,FOUR_DAN_PROVISIONAL_GIKOU);
  assert.equal(profile.depthLimit,8);
  assert.equal(profile.label,'アマ四段程度（仮）');
  assert.equal(profile.classification,'user-defined-working-assumption');
  assert.equal(profile.verifiedAgainstHumanPlayers,false);
  assert.equal(profile.officialGikouClaim,false);
  assert.equal(profile.applyToGameDifficulty,false);
});
test('do not attribute a provisional fourth-dan label to other depths',()=>{
  for(const depth of [2,3,4,5,6,7,9,10])assert.equal(referenceProxyForDepth(depth),null);
  assert.equal(Object.isFrozen(FOUR_DAN_PROVISIONAL_GIKOU),true);
});
