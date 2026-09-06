import { Game as GameType } from "../interfaces";

// A single table animation event derived from two consecutive game snapshots.
export type FxAction =
  | { kind: "bet"; position: number; amount: number } // any bet/call/raise
  | { kind: "check"; position: number } // checked (no chips committed)
  | { kind: "fold"; position: number };

// In-play stages only (PreFlop..River); Showdown (6) is handled separately.
export const STAGE_BETTING_MIN = 2;
export const STAGE_BETTING_MAX = 5;

// Compare a previous game snapshot against the current one and return the
// table events that happened in between. Each snapshot is the full server
// state broadcast, so every connected client derives the same event stream.
export function diffTableActions(
  prev: GameType | null,
  next: GameType
): FxAction[] {
  if (!prev || prev.handsPlayed !== next.handsPlayed) {
    return [];
  }

  const events: FxAction[] = [];

  // Fold detection works regardless of whether betting ended (a fold can end
  // the street or the hand outright). Only folds inside the same hand count.
  const prevByPos = new Map(prev.players.map((p) => [p.position, p]));
  for (const p of next.players) {
    const before = prevByPos.get(p.position);
    if (!before) continue;
    if (before.in && !p.in && p.left === false) {
      events.push({ kind: "fold", position: p.position });
    }
  }

  // Chips committed by a bet/raise/call/all-in. Gate on the *previous*
  // snapshot being a live street, not the next one: a call that closes a
  // street is dealt through by the server in the same update (stage +1, or
  // Showdown after the river), and an all-in that leaves nobody to act turns
  // `betting` off. In all of those the caller's chips still went in and must
  // animate. Blinds are excluded because they are posted from NotReady.
  const fromLiveStreet =
    prev.betting &&
    prev.stage >= STAGE_BETTING_MIN &&
    prev.stage <= STAGE_BETTING_MAX;

  if (fromLiveStreet) {
    for (const p of next.players) {
      const before = prevByPos.get(p.position);
      if (!before) continue;
      // totalBet is cumulative for the whole hand, so it survives the
      // per-street `bet` reset. An uncalled excess refund lowers it, which
      // correctly yields no event for the refunded player.
      const committed = (p.totalBet ?? 0) - (before.totalBet ?? 0);
      if (committed > 0 && p.in) {
        events.push({ kind: "bet", position: p.position, amount: committed });
      }
    }

    // A check: the player who was to act stayed in, put no chips in, and the
    // turn moved on (action changed, the street advanced, or betting closed).
    // The last two guards keep no-op re-broadcasts during a live street (a
    // spectator reserving a seat, the action clock arming) - where the same
    // player is still to act - from reading as a check.
    if (prev.action < prev.players.length) {
      const was = prev.players[prev.action];
      const now = next.players.find((p) => p.position === was.position);
      const committed = now ? (now.totalBet ?? 0) - (was.totalBet ?? 0) : 1; // gone: not a check
      const moved =
        next.action !== prev.action ||
        next.stage !== prev.stage ||
        !next.betting;
      if (
        now &&
        was.in &&
        now.in &&
        now.left === false &&
        committed === 0 &&
        moved
      ) {
        events.push({ kind: "check", position: was.position });
      }
    }
  }

  return events;
}
