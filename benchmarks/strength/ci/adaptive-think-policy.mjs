// Experimental only. A conservative, transparent rule-based allocation.
// The referee computes tactical signals independently of rsshogi, so the
// candidate sees no privileged search output. Never claim this is optimal.
export function chooseAdaptiveThink(features, remainingMs) {
  if(!features || typeof features.inCheck!=='boolean')throw Error('Missing inCheck');
  for(const field of ['legalCount','captureMoves','promotionMoves']) {
    const value=features[field];
    if(!Number.isSafeInteger(value)||value<0)throw Error('Invalid '+field);
  }
  if(features.captureMoves>features.legalCount ||
     features.promotionMoves>features.legalCount)throw Error('Feature count exceeds legal moves');
  if(!Number.isFinite(remainingMs)||remainingMs<0)throw Error('Invalid remaining clock');
  let rawTargetMs=1000, reason='quiet';
  if(features.inCheck){
    rawTargetMs=6000;reason='king-under-check';
  }else if(features.legalCount<=8) {
    rawTargetMs=3000;reason='few-safe-options';
  }else if(features.captureMoves>=2||features.promotionMoves>=2){
    rawTargetMs=3000;reason='multiple-tactical-options';
  }else if(features.captureMoves===1||features.promotionMoves===1){
    rawTargetMs=1500;reason='single-tactical-option';
  }
  // Preserve time for the next turns instead of spending 6s when low.
  let maxThinkMs=rawTargetMs, clockGuard='none';
  if(remainingMs<=10000){
    maxThinkMs=Math.min(maxThinkMs,250);clockGuard='critical';
  }else if(remainingMs<=30000){
    maxThinkMs=Math.min(maxThinkMs,750);clockGuard='low';
  }else if(remainingMs<=60000){
    maxThinkMs=Math.min(maxThinkMs,1500);clockGuard='moderate';
  }
  return {maxThinkMs,rawTargetMs,reason,clockGuard,policy:'adaptive-feature-v1'};
}
