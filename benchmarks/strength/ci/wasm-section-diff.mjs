// WASM binary reproducibility inspection.
// This tool compares byte identity and non-custom section identity; it does
// NOT assert semantic equivalence merely because two modules both execute.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const sha=b=>createHash('sha256').update(b).digest('hex');
const labels={
  0:'custom',1:'type',2:'import',3:'function',4:'table',5:'memory',
  6:'global',7:'export',8:'start',9:'element',10:'code',11:'data',
  12:'data-count',13:'tag',
};
function leb(b,offset,limit=b.length){
  let value=0, multiplier=1, n=0;
  for(let i=offset;i<limit&&n<5;i++,n++){
    const byte=b[i];
    value+=(byte&127)*multiplier;
    if(!(byte&128)){
      if(value>0xffffffff)throw Error('Invalid LEB128 value beyond uint32');
      return {value,at:i+1};
    }
    multiplier*=128;
  }
  throw Error('Invalid or truncated unsigned LEB128');
}
function customName(bytes){
  const {value:length,at}=leb(bytes,0);
  if(at+length>bytes.length)throw Error('Truncated WASM custom section name');
  return bytes.subarray(at,at+length).toString('utf8');
}
export function parseWasm(input){
  const b=Buffer.from(input);
  if(b.length<8||b.subarray(0,4).toString('hex')!=='0061736d')
    throw Error('Missing WASM magic header');
  if(b.readUInt32LE(4)!==1)throw Error('Expected core WebAssembly binary format v1');
  const sections=[];
  let at=8;
  while(at<b.length){
    const start=at, id=b[at++];
    if(id>13)throw Error('Unexpected WASM section id: '+id);
    const len=leb(b,at);at=len.at;
    if(len.value>b.length-at)throw Error('Truncated WASM section payload');
    const end=at+len.value;
    const payload=b.subarray(at,end);
    const name=id===0?customName(payload):null;
    sections.push({
      id,name,label:labels[id]??'unknown',
      payload_length:len.value,payload_sha256:sha(payload),
      span_start:start,span_end:end,
      raw:b.subarray(start,end),
    });
    at=end;
  }
  const noncustom=Buffer.concat([b.subarray(0,8),
    ...sections.filter(s=>s.id!==0).map(s=>s.raw)]);
  return {
    size:b.length,sha256:sha(b),
    noCustomSha256:sha(noncustom),noCustomBytes:noncustom.length,
    sections,
  };
}
function firstDifference(a,b){
  const n=Math.min(a.length,b.length);
  for(let i=0;i<n;i++)if(a[i]!==b[i])return i;
  return a.length===b.length?null:n;
}
function groups(sections){
  const map=new Map();
  for(const s of sections){
    const id=s.id===0?'custom:'+s.name:'section:'+s.id;
    if(!map.has(id))map.set(id,[]);
    map.get(id).push(s);
  }
  return map;
}
export function compareWasm(a,b){
  const A=parseWasm(a),B=parseWasm(b);
  const left=groups(A.sections),right=groups(B.sections);
  const keys=[...new Set([...left.keys(),...right.keys()])].sort();
  const changed=[];
  for(const key of keys){
    const xs=left.get(key)??[], ys=right.get(key)??[];
    const n=Math.max(xs.length,ys.length);
    for(let i=0;i<n;i++){
      const x=xs[i],y=ys[i];
      if(x?.payload_sha256===y?.payload_sha256&&x?.payload_length===y?.payload_length)
        continue;
      changed.push({
        section:key,occurrence:i,
        leftLength:x?.payload_length??null,rightLength:y?.payload_length??null,
        leftSha256:x?.payload_sha256??null,rightSha256:y?.payload_sha256??null,
        firstDifferentPayloadByte:x&&y?
          firstDifference(x.raw,y.raw):null,
      });
    }
  }
  const display=m=>({
    byteLength:m.size,sha256:m.sha256,
    nonCustomByteLength:m.noCustomBytes,
    nonCustomSha256:m.noCustomSha256,
    sections:m.sections.map(s=>({
      name:s.id===0?'custom:'+s.name:s.label,
      length:s.payload_length,sha256:s.payload_sha256,
    })),
  });
  return {
    event:'wasm-reproducibility-section-diff',
    comparison:A.sha256===B.sha256?'byte-identical':
      A.noCustomSha256===B.noCustomSha256?'custom-sections-only':
      'non-custom-sections-differ',
    byteIdentical:A.sha256===B.sha256,
    nonCustomSectionsIdentical:A.noCustomSha256===B.noCustomSha256,
    codeSectionIdentical:!changed.some(c=>c.section==='section:10'),
    dataSectionIdentical:!changed.some(c=>c.section==='section:11'),
    changed, left:display(A),right:display(B),
  };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [, ,fileA,fileB]=process.argv;
  if(!fileA||!fileB)throw Error('Usage: node wasm-section-diff.mjs A.wasm B.wasm');
  const results=compareWasm(readFileSync(fileA),readFileSync(fileB));
  console.log(JSON.stringify(results));
  console.error('RESULT: '+results.comparison+', changed sections='+
    results.changed.map(x=>x.section).join(','));
}
