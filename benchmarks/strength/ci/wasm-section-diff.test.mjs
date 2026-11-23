import test from 'node:test';
import assert from 'node:assert/strict';
import {parseWasm,compareWasm} from './wasm-section-diff.mjs';
const header=Buffer.from([0,97,115,109,1,0,0,0]);
function section(id,payload){
  assert.ok(payload.length<128);
  return Buffer.concat([Buffer.from([id,payload.length]),Buffer.from(payload)]);
}
function custom(name,content){
  const n=Buffer.from(name);
  return section(0,Buffer.concat([Buffer.from([n.length]),n,Buffer.from(content)]));
}
function wasm(meta='a',code=[1,2,3],data=[9,8]){
  return Buffer.concat([
    header,
    custom('producers',Buffer.from(meta)),
    section(1,[2,3]),
    section(10,code),
    section(11,data),
  ]);
}
test('same byte sequence produces identical sha and section listing',()=>{
  const a=wasm();
  const r=compareWasm(a,Buffer.from(a));
  assert.equal(r.comparison,'byte-identical');
  assert.equal(r.byteIdentical,true);
  assert.equal(r.nonCustomSectionsIdentical,true);
  assert.equal(r.changed.length,0);
  assert.equal(r.left.sections[0].name,'custom:producers');
});
test('differences limited to a custom section do not alter noncustom section bytes',()=>{
  const r=compareWasm(wasm('alpha'),wasm('different metadata'));
  assert.equal(r.comparison,'custom-sections-only');
  assert.equal(r.nonCustomSectionsIdentical,true);
  assert.equal(r.codeSectionIdentical,true);
  assert.equal(r.dataSectionIdentical,true);
  assert.equal(r.changed.length,1);
  assert.equal(r.changed[0].section,'custom:producers');
});
test('code section difference is flagged, never falsely marked equivalent',()=>{
  const r=compareWasm(wasm('alpha',[1,2,3]),wasm('alpha',[1,2,4]));
  assert.equal(r.comparison,'non-custom-sections-differ');
  assert.equal(r.codeSectionIdentical,false);
  assert.equal(r.dataSectionIdentical,true);
  assert.equal(r.changed.length,1);
  assert.equal(r.changed[0].section,'section:10');
  assert.equal(r.changed[0].firstDifferentPayloadByte,2,
    'Diagnostic byte offsets must exclude section ID and length framing');
});
test('data section difference is also a noncustom difference',()=>{
  const r=compareWasm(wasm('alpha',[1,2,3],[9,8]),
                      wasm('alpha',[1,2,3],[9,7]));
  assert.equal(r.dataSectionIdentical,false);
  assert.equal(r.codeSectionIdentical,true);
  assert.equal(r.comparison,'non-custom-sections-differ');
});
test('order/size changes in custom sections do not trigger false code differences',()=>{
  const a=wasm('one');
  const b=Buffer.concat([a,custom('name',Buffer.from('other'))]);
  const r=compareWasm(a,b);
  assert.equal(r.comparison,'custom-sections-only');
  assert.equal(r.codeSectionIdentical,true);
});
test('invalid header, truncated section and malformed name are rejected',()=>{
  assert.throws(()=>parseWasm(Buffer.from('not a wasm')));
  assert.throws(()=>parseWasm(Buffer.concat([header,Buffer.from([10,100,0])])),/Truncated/);
  assert.throws(()=>parseWasm(Buffer.concat([header,Buffer.from([0,2,9,0])])),/Truncated/);
  assert.throws(()=>parseWasm(Buffer.concat([header,Buffer.from([15,0])])),/Unexpected/);
});
