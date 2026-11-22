#!/usr/bin/env node
// Package the same verified rsshogi WASM/model with only the experimental Worker
// replaced. All other bytes remain identical; manifest + checksums are updated.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,copyFileSync,cpSync,mkdirSync,existsSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const [baseDir,outDir]=process.argv.slice(2);
assert.ok(baseDir&&outDir,'Usage: node build-sdk.mjs VERIFIED_BASE_SDK OUTPUT_SDK');
const base=resolve(baseDir),out=resolve(outDir);
assert.notEqual(base,out,'Input and output must differ');
assert.ok(!existsSync(out),'Output SDK must not already exist');
const digest=b=>createHash('sha256').update(b).digest('hex');
const sum=(dir)=>{
 const lines=readFileSync(join(dir,'SHA256SUMS'),'utf8').trim().split('\n');
 for(const line of lines){
  const m=/^([a-f0-9]{64})  ([A-Za-z0-9_.-]+)$/.exec(line);
  assert.ok(m,'Malformed SHA256SUMS line: '+line);
  assert.equal(digest(readFileSync(join(dir,m[2]))),m[1],'SDK artifact changed: '+m[2]);
 }
};
sum(base);
const inputManifest=JSON.parse(readFileSync(join(base,'manifest.json'),'utf8'));
assert.equal(inputManifest.package,'rsshogi-nnue-mini-obstacle');
assert.equal(inputManifest.embedded_rsnn_sha256,
 '787739972eabb5a1c42c471d178ac0c97b688dce35c72b4291e7e1eeefa9786f',
 'Only the expected exact rsshogi NNUE model is permitted');
mkdirSync(dirname(out),{recursive:true});
cpSync(base,out,{recursive:true});
const worker=fileURLToPath(new URL('./worker.js',import.meta.url));
copyFileSync(worker,join(out,'worker.js'));
const manifest={...inputManifest,
 modifications:[...inputManifest.modifications,
  'EXPERIMENT ONLY: one uninterrupted native search per move in place of 35ms cooperative slices'],
 experiment:{
  type:'continuous-obstacle',
  note:'Synchronous search blocks the Worker. mid-search stop is unsupported; no deployment without stop/cancel strategy.',
  baselineWorkerSha256:digest(readFileSync(join(base,'worker.js'))),
  experimentalWorkerSha256:digest(readFileSync(join(out,'worker.js'))),
  baselineWasmSha256:digest(readFileSync(join(base,'rsshogi_nnue_mini.wasm')))
 },
 artifacts_sha256:{...inputManifest.artifacts_sha256,
  'worker.js':digest(readFileSync(join(out,'worker.js')))}
};
writeFileSync(join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
const artifactLines=readFileSync(join(base,'SHA256SUMS'),'utf8').trim().split('\n')
 .map(line=>line.slice(66));
assert.ok(artifactLines.includes('worker.js'));
assert.ok(artifactLines.includes('manifest.json'));
writeFileSync(join(out,'SHA256SUMS'),
 artifactLines.map(name=>digest(readFileSync(join(out,name)))+'  '+name).join('\n')+'\n');
sum(out);
for(const name of ['rsshogi_nnue_mini.wasm','mini.js','package.json','LICENSE','THIRD-PARTY-NOTICES.txt']){
 assert.equal(digest(readFileSync(join(out,name))),digest(readFileSync(join(base,name))),
  'Unintended change: '+name);
}
console.log(JSON.stringify({
 experiment:'continuous-obstacle',wasmSha:manifest.experiment.baselineWasmSha256,
 baselineWorkerSha:manifest.experiment.baselineWorkerSha256,
 candidateWorkerSha:manifest.experiment.experimentalWorkerSha256,model:manifest.embedded_rsnn_sha256
}));
