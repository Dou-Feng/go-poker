type PotAmount = { amount: number };
type PlayerContribution = { totalBet: number };

export function totalPot(
  pots: PotAmount[],
  players: PlayerContribution[]
): number {
  const potsTotal = pots.reduce((sum, pot) => sum + pot.amount, 0);
  return potsTotal || players.reduce((sum, player) => sum + player.totalBet, 0);
}

export function raisePresetAmounts(
  pot: number,
  currentBet: number,
  maxBet: number,
  minAmount: number,
  stack: number
) {
  const clamp = (value: number) =>
    Math.min(stack, Math.max(minAmount, Math.round(value)));
  const callAmount = Math.max(0, maxBet - currentBet);
  const potAfterCall = pot + callAmount;

  return {
    min: clamp(minAmount),
    half: clamp(callAmount + Math.ceil(potAfterCall / 2)),
    pot: clamp(callAmount + potAfterCall),
    double: clamp(callAmount + potAfterCall * 2),
  };
}
