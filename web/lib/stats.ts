import type { PlayerStats } from "../interfaces";

// Invalid historical counts cannot be reconstructed from percentages. Show
// unavailable rather than presenting an impossible rate or a fabricated 100%.
export function vpipRate(count: number, hands: number): string {
  if (
    !Number.isSafeInteger(count) ||
    !Number.isSafeInteger(hands) ||
    hands <= 0 ||
    count < 0 ||
    count > hands
  ) {
    return "—";
  }
  return Math.round((count / hands) * 100) + "%";
}

export function positionVpipRate(
  stats: PlayerStats | null,
  pos: number
): string {
  if (!stats || pos < 0 || pos >= 6 || !Number.isInteger(pos)) return "—";
  const { handsByPos, vpipByPos, handsPlayed } = stats;
  // Older samples mix table sizes; their five-player subset is unknown.
  if (stats.positionStatsVersion !== 2) return "—";
  if (handsByPos?.length !== 6 || vpipByPos?.length !== 6) return "—";
  if (
    !Number.isSafeInteger(handsPlayed) ||
    handsPlayed < 0 ||
    handsByPos.some(
      (hands, i) =>
        !Number.isSafeInteger(hands) ||
        hands < 0 ||
        !Number.isSafeInteger(vpipByPos[i]) ||
        vpipByPos[i] < 0 ||
        vpipByPos[i] > hands
    )
  )
    return "—";
  const totalHands = handsByPos.reduce((sum, n) => sum + n, 0);
  if (totalHands > handsPlayed) return "—";
  return vpipRate(vpipByPos[pos], handsByPos[pos]);
}

export function threeBetRate(stats: PlayerStats | null): string {
  if (!stats || stats.threeBetStatsVersion !== 1) return "—";
  const opportunities = stats.threeBetOpportunities;
  if (
    !Number.isSafeInteger(stats.handsPlayed) ||
    stats.handsPlayed < 0 ||
    opportunities === undefined ||
    opportunities > stats.handsPlayed
  )
    return "—";
  return vpipRate(stats.threeBets, opportunities);
}
