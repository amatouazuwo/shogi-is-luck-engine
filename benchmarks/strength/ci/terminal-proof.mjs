import assert from 'node:assert/strict';

/**
 * Bounded AND/OR terminal proof using an independent legal-move/referee adapter.
 * Outcomes are relative to the player to move. Only exhaustive search under
 * the supplied rules and horizon can produce WIN/LOSS; anything else is UNKNOWN.
 */
export async function proveTerminal({sfen, holes='', legal, step, depth=3, nodeLimit=400}) {
  assert.ok(Number.isInteger(depth) && depth>=0 && depth<=6, 'Depth must be 0..6');
  assert.ok(Number.isInteger(nodeLimit) && nodeLimit>=1 && nodeLimit<=100000);
  let nodes=0, capped=false;
  const active=new Set();
  async function dfs(position, remaining) {
    if(nodes>=nodeLimit){capped=true;return {outcome:'UNKNOWN',distance:null};}
    nodes++;
    // Repetition/continuous checks require a separate adjudicator; do not claim proof.
    const key=position.split(' ').slice(0,3).join(' ');
    if(active.has(key)) return {outcome:'UNKNOWN',distance:null};
    active.add(key);
    try {
      const moves=(await legal(position,holes)).slice().sort();
      assert.equal(new Set(moves).size,moves.length,'Duplicate legal moves');
      if(!moves.length)return {outcome:'LOSS',distance:0};
      if(remaining===0)return {outcome:'UNKNOWN',distance:null};
      let longestForcedLoss=0, unknown=false, shortestWin=Infinity;
      for(const move of moves) {
        const next=await step(position,holes,move);
        const child=await dfs(next,remaining-1);
        if(child.outcome==='LOSS')shortestWin=Math.min(shortestWin,child.distance+1);
        else if(child.outcome==='WIN')longestForcedLoss=Math.max(longestForcedLoss,child.distance+1);
        else unknown=true;
        // A single reply proving a forced win suffices; it is a valid existential proof.
        if(shortestWin!==Infinity)return {outcome:'WIN',distance:shortestWin};
      }
      if(unknown)return {outcome:'UNKNOWN',distance:null};
      return {outcome:'LOSS',distance:longestForcedLoss};
    } finally {active.delete(key);}
  }
  const proof=await dfs(sfen,depth);
  return {...proof,nodes,exhausted:!capped};
}
export function candidateOutcome(childOutcome) {
  return childOutcome==='WIN'?'LOSS':childOutcome==='LOSS'?'WIN':'UNKNOWN';
}
