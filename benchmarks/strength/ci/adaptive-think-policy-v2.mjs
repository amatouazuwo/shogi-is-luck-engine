// Hypothesis v2: most positions use one second. Reserve longer thinking
// for forced king defence and unusually rich capture+promotion positions.
// Not a proven position-strength evaluator or production configuration.
export function chooseAdaptiveThinkV2(features, remainingMs) {
  if(!features || typeof features.inCheck!=='boolean')throw Error('Missing inCheck');
  for(const key of ['legalCount','captureMoves','promotionMoves']) {
    if(!Number.isSafeInteger(features[key])||features[key]<0)throw Error('Invalid '+key);
    if(key!=='legalCount'&&features[key]>features.legalCount)
      throw Error('Feature count exceeds legal moves');
  }
  if(!Number.isFinite(remainingMs)||remainingMs<0)throw Error('Invalid remainingMs');
  let rawTargetMs=1000,reason='quiet-or-ordinary-captures';
  if(features.inCheck){
    if(features.legalCount<=3) {
      rawTargetMs=6000;reason='forced-king-defence';
    }else{
      rawTargetMs=3000;reason='king-defence';
    }
  }else if(features.legalCount<=5){
    rawTargetMs=3000;reason='constrained-legal-options';
  }else if(features.captureMoves>=5&&features.promotionMoves>=2){
    rawTargetMs=2000;reason='rich-capture-and-promotion';
  }
  let maxThinkMs=rawTargetMs,clockGuard='none';
  if(remainingMs<=10000){
    maxThinkMs=Math.min(maxThinkMs,250);clockGuard='critical';
  }else if(remainingMs<=30000){
    maxThinkMs=Math.min(maxThinkMs,750);clockGuard='low';
  }else if(remainingMs<=60000){
    maxThinkMs=Math.min(maxThinkMs,1500);clockGuard='moderate';
  }
  return {maxThinkMs,rawTargetMs,reason,clockGuard,policy:'adaptive-feature-v2'};
}
