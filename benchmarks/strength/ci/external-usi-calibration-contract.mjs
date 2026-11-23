import assert from 'node:assert/strict';

export function parseUsiHandshake(lines){
  assert.ok(Array.isArray(lines)&&lines.at(-1)==='usiok','USI handshake not finished');
  const name=lines.find(s=>s.startsWith('id name '))?.slice(8).trim();
  const options=lines.filter(s=>s.startsWith('option name ')).map(s=>{
    const m=s.match(/^option name (.*?) type /);return m?.[1];
  }).filter(Boolean);
  assert.ok(name&&name.length>1,'USI engine did not identify itself');
  assert.ok(options.length>0,'Expected USI option definitions');
  return {name,options};
}

export function referenceSettings(handshake,{depth=2}={}){
  assert.ok(handshake&&typeof handshake.name==='string');
  assert.ok(Number.isInteger(depth)&&depth>=1&&depth<=10,'Uncalibrated reference probe depth must be 1..10');
  const required=['DepthLimit','OwnBook','Threads'];
  for(const name of required)assert.ok(handshake.options.includes(name),
    'Reference engine lacks documented Gikou2 setting: '+name);
  return {
    depth,
    commands:[
      'setoption name DepthLimit value '+depth,
      'setoption name OwnBook value false',
      'setoption name Threads value 1',
      ...(handshake.options.includes('USI_Hash')?['setoption name USI_Hash value 16']:[]),
    ],
  };
}

export function parseUsiBestmove(line,legal){
  assert.ok(typeof line==='string'&&line.startsWith('bestmove '),
    'USI must return bestmove');
  const move=line.split(/\s+/)[1];
  assert.ok(Array.isArray(legal)&&legal.includes(move),
    'External engine proposed illegal or unsupported move');
  return move;
}

export function scoreExternalNormalProbe(rows,params){
  assert.ok(Array.isArray(rows)&&rows.length>=2,'At least two ordinary shogi positions required');
  assert.ok(params&&params.referenceName&&params.sourceTag==='v2.0.2');
  assert.ok(params.referenceSha256&&params.rsshogiWasmSha256);
  assert.ok(Number.isInteger(params.referenceDepth)&&params.referenceDepth>=1);
  const tiers=[500,2000,10000,50000];
  const agree=tiers.map(nodes=>{
    const found=rows.map(r=>{
      assert.ok(typeof r.sfen==='string'&&r.sfen.length>0);
      assert.ok(Array.isArray(r.legal)&&r.legal.length>0);
      assert.ok(r.legal.includes(r.referenceMove),'External move is illegal');
      assert.ok(r.candidates&&r.candidates.length===tiers.length);
      const c=r.candidates.find(t=>t.nodesCap===nodes);
      assert.ok(c&&r.legal.includes(c.bestmove),'rsshogi move is illegal');
      assert.ok(c.actualNodes<=nodes,'Native student exceeded node cap');
      assert.equal(c.agreesWithReference,c.bestmove===r.referenceMove);
      return c;
    });
    const matches=found.filter(x=>x.agreesWithReference).length;
    return {nodeCap:nodes,samples:found.length,agreements:matches,
      rate:Math.round(matches/found.length*1000)/1000};
  });
  return {
    event:'external-reference-normal-probe',
    status:'reference-move-comparison-only',positions:rows.length,
    referenceName:params.referenceName,referenceVersion:params.sourceTag,
    referenceDepth:params.referenceDepth,
    referenceBinarySha256:params.referenceSha256,
    nativeWasmSha256:params.rsshogiWasmSha256,
    tiers:agree,
    matchWinRateMeasured:false,
    amateurRankCalibrated:false,
    caution:'USI bestmove agreement is not head-to-head win rate, Elo or amateur grade. '+
      'Gikou2 published historical depth-to-24-rank estimates do not transfer automatically to rsshogi.',
  };
}
