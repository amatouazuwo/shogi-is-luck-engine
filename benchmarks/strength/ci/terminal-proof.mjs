import assert from 'node:assert/strict';

/**
 * Exhaustive finite-horizon terminal proof. The reference considers a position
 * with no legal moves a LOSS for the side to move. Cycles and horizon/cap
 * exhaustion are UNKNOWN, never draws. No real-game special-event proof.
 *
 * A WIN certificate is existential: one move into the opponent's proved LOSS.
 * A LOSS certificate is universal: EVERY legal move gives the opponent a
 * proved WIN. Verification MUST replay it against an independent referee.
 */
export async function proveTerminal({sfen, holes='', legal, step, depth=3, nodeLimit=400}) {
  assert.ok(Number.isInteger(depth) && depth>=0 && depth<=6, 'Depth must be 0..6');
  assert.ok(Number.isInteger(nodeLimit) && nodeLimit>=1 && nodeLimit<=100000);
  let nodes=0, capped=false;
  const active=new Set();
  async function dfs(position, remaining) {
    if(nodes>=nodeLimit){capped=true;return {outcome:'UNKNOWN',distance:null,certificate:null};}
    nodes++;
    // Repetition/continuous checks require a separate adjudicator; do not claim proof.
    const key=position.split(' ').slice(0,3).join(' ');
    if(active.has(key)) return {outcome:'UNKNOWN',distance:null,certificate:null};
    active.add(key);
    try {
      const moves=(await legal(position,holes)).slice().sort();
      assert.equal(new Set(moves).size,moves.length,'Duplicate legal moves');
      if(!moves.length)return {outcome:'LOSS',distance:0,
        certificate:{kind:'terminal',sfen:position}};
      if(remaining===0)return {outcome:'UNKNOWN',distance:null,certificate:null};
      let longestForcedLoss=0, unknown=false;
      const children=[];
      for(const move of moves) {
        const next=await step(position,holes,move);
        const child=await dfs(next,remaining-1);
        if(child.outcome==='LOSS')return {
          outcome:'WIN',distance:child.distance+1,
          certificate:{kind:'exists',sfen:position,move,child:child.certificate}
        };
        if(child.outcome==='WIN') {
          longestForcedLoss=Math.max(longestForcedLoss,child.distance+1);
          children.push({move,child:child.certificate});
        } else unknown=true;
      }
      if(unknown)return {outcome:'UNKNOWN',distance:null,certificate:null};
      return {outcome:'LOSS',distance:longestForcedLoss,
        certificate:{kind:'forall',sfen:position,children}};
    } finally {active.delete(key);}
  }
  const proof=await dfs(sfen,depth);
  return {...proof,nodes,exhausted:!capped};
}

export function candidateOutcome(childOutcome) {
  return childOutcome==='WIN'?'LOSS':childOutcome==='LOSS'?'WIN':'UNKNOWN';
}

/**
 * Rechecks a proof tree using fresh legal/step oracle calls. Unlike a plausible
 * principal variation, this requires complete coverage at every LOSS node.
 */
export async function verifyTerminalCertificate({sfen,holes='',certificate,legal,step,maxNodes=100000}) {
  assert.ok(Number.isInteger(maxNodes)&&maxNodes>=1);
  let nodes=0;
  async function walk(pos,node) {
    assert.ok(node && typeof node==='object','Missing proof node');
    assert.equal(node.sfen,pos,'Certificate position mismatch');
    assert.ok(++nodes<=maxNodes,'Certificate node count exceeded');
    const moves=(await legal(pos,holes)).slice().sort();
    assert.equal(new Set(moves).size,moves.length,'Duplicate legal moves');
    if(node.kind==='terminal') {
      assert.equal(moves.length,0,'Terminal certificate has legal moves');
      return 'LOSS';
    }
    assert.ok(moves.length>0,'Non-terminal certificate at terminal position');
    if(node.kind==='exists') {
      assert.ok(moves.includes(node.move),'Proof move is not legal');
      const next=await step(pos,holes,node.move);
      assert.equal(await walk(next,node.child),'LOSS','Existential proof must defeat opponent');
      return 'WIN';
    }
    if(node.kind==='forall') {
      assert.ok(Array.isArray(node.children),'Missing universal children');
      assert.deepEqual(node.children.map(x=>x.move).slice().sort(),moves,
        'Universal proof must cover ALL legal moves');
      for(const item of node.children) {
        const next=await step(pos,holes,item.move);
        assert.equal(await walk(next,item.child),'WIN','Universal proof must handle each legal move');
      }
      return 'LOSS';
    }
    throw Error('Unknown certificate kind');
  }
  const outcome=await walk(sfen,certificate);
  return {valid:true,outcome,verifiedNodes:nodes};
}
