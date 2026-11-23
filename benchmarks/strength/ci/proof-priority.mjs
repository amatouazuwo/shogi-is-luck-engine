// Prefer diagnostic positions whose recorded branches have fewer legal opponent
// responses. This is a SEARCH-COST heuristic, not an indicator of bad moves.
export function prioritizeProofPositions(records, limit=2) {
  if(!Number.isInteger(limit)||limit<0)throw Error('Invalid proof position limit');
  return records.map((record,index)=>{
    if(!Array.isArray(record.branches)||!record.branches.some(b=>b.played===true))throw Error('Missing played branch');
    const counts=record.branches.map(b=>b.legalOpponentReplies);
    if(counts.some(n=>!Number.isInteger(n)||n<0))throw Error('Invalid legal reply counts');
    return {record,index,maxReplies:Math.max(...counts),totalReplies:counts.reduce((a,b)=>a+b,0)};
  }).sort((a,b)=>a.maxReplies-b.maxReplies||a.totalReplies-b.totalReplies||a.index-b.index)
    .slice(0,limit);
}
