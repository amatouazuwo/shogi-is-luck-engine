import assert from 'node:assert/strict';
import test from 'node:test';
import {prioritizeProofPositions} from './proof-priority.mjs';
const make=(id,counts)=>({id,branches:counts.map((count,i)=>({played:i===0,legalOpponentReplies:count}))});
test('selects small branching positions, not merely earliest saved positions',()=>{
 const entries=[make('expensive',[120,140]),make('cheap',[2,3]),make('middle',[10,15])];
 assert.deepEqual(prioritizeProofPositions(entries,2).map(x=>x.record.id),['cheap','middle']);
});
test('ties are deterministic and do not imply a move-strength ranking',()=>{
 const entries=[make('first',[2,3]),make('second',[3,2])];
 assert.deepEqual(prioritizeProofPositions(entries,2).map(x=>x.record.id),['first','second']);
});
test('rejects missing actual move and malformed branching evidence',()=>{
 assert.throws(()=>prioritizeProofPositions([{branches:[{played:false,legalOpponentReplies:2}]}]),/Missing played branch/);
 assert.throws(()=>prioritizeProofPositions([make('bad',[-1])]),/Invalid legal reply counts/);
});
