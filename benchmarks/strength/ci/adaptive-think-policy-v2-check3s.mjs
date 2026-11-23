import {chooseAdaptiveThinkV2} from './adaptive-think-policy-v2.mjs';

// Experimental A/B: change ONLY the 6s forced-check response in v2 to 3s.
// Fewer legal replies does not by itself justify a longer search.
// All remaining v2 triggers and low-clock guards stay identical.
export function chooseAdaptiveThinkV2Check3s(features,remainingMs){
  const v2=chooseAdaptiveThinkV2(features,remainingMs);
  if(features.inCheck && features.legalCount<=3) {
    return {...v2,rawTargetMs:3000,
      maxThinkMs:Math.min(v2.maxThinkMs,3000),
      reason:'forced-king-defence-capped-at-3s',
      policy:'adaptive-feature-v2-check3s'};
  }
  return {...v2,policy:'adaptive-feature-v2-check3s'};
}
