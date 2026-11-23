// Development-only reference assumption. NOT an official Gikou skill rating.
// A user-specified, approximate target for automated normal-shogi comparisons.
export const FOUR_DAN_PROVISIONAL_GIKOU=Object.freeze({
  id:'provisional-amateur-four-dan',
  engine:'Gikou 2',
  tag:'v2.0.2',
  depthLimit:8,
  label:'アマ四段程度（仮）',
  classification:'user-defined-working-assumption',
  verifiedAgainstHumanPlayers:false,
  officialGikouClaim:false,
  appliedTo:'external-normal-shogi-reference-only',
  applyToGameDifficulty:false,
});
export function referenceProxyForDepth(depth){
  return depth===FOUR_DAN_PROVISIONAL_GIKOU.depthLimit
    ?FOUR_DAN_PROVISIONAL_GIKOU:null;
}
