// Clock-plan arithmetic matches the game's CPU difficulty profile semantics.
// It is a pure function for benchmarks. NO actual 1.3s sleep is needed:
// charging virtual delay into a player's real three-minute search clock is
// equivalent for engine decision budgets, but does not model animation lag.
export function planTurn({remainingMs, nominalMs, divisor=20, preMoveDelayMs=0}) {
  if(!Number.isFinite(remainingMs)||remainingMs<0)throw Error('Invalid remainingMs');
  if(!Number.isFinite(nominalMs)||nominalMs<=0)throw Error('Invalid nominalMs');
  if(!Number.isInteger(divisor)||divisor<2||divisor>100)throw Error('Invalid divisor');
  if(!Number.isFinite(preMoveDelayMs)||preMoveDelayMs<0)throw Error('Invalid pre-move delay');
  const before=Math.floor(remainingMs);
  const delay=Math.max(0,Math.min(preMoveDelayMs,Math.floor(before/20)));
  const afterDelay=Math.max(0,before-delay);
  // Same formula as game scripts/cpu-difficulty.js: budget().
  const searchMs=Math.max(1,Math.min(
    nominalMs,Math.floor(afterDelay/divisor),afterDelay-150,
  ));
  return {clockBeforeMs:before,preMoveDelayChargedMs:delay,
    clockAfterDelayMs:afterDelay,searchMs};
}
