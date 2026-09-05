// Client-side hand categorisation for the board/hole-card popup.
//
// The server only names a player's best hand once the board is complete
// (showdown). During a hand the player wants to know what they hold right
// now, so this evaluates whatever is visible: 2 hole cards preflop, 5 on the
// flop, 6 on the turn, 7 on the river. Only the category is needed (not a
// full ranking), which keeps this small and dependency-free.
//
// Cards use the engine's 32-bit encoding (see Card.tsx): rank in bits 8..11
// (0 = deuce … 12 = ace), suit as one of the bits 0x1000/0x2000/0x4000/0x8000.
// "0", "?" and unparsable values are ignored.

export type HandName =
  | "royal flush"
  | "straight flush"
  | "four of a kind"
  | "full house"
  | "flush"
  | "straight"
  | "three of a kind"
  | "two pair"
  | "one pair"
  | "high card";

const ORDER: HandName[] = [
  "high card",
  "one pair",
  "two pair",
  "three of a kind",
  "straight",
  "flush",
  "full house",
  "four of a kind",
  "straight flush",
  "royal flush",
];

type Parsed = { rank: number; suit: number };

function parse(card: string | undefined | null): Parsed | null {
  if (!card || card === "?" || card === "0") {
    return null;
  }
  const c = Number(card);
  if (!Number.isFinite(c) || c <= 0) {
    return null;
  }
  const rank = (c >> 8) & 0x0f;
  const suit = c & 0xf000;
  if (rank > 12 || ![0x1000, 0x2000, 0x4000, 0x8000].includes(suit)) {
    return null;
  }
  return { rank, suit };
}

// Category of exactly five cards.
function categorizeFive(cards: Parsed[]): HandName {
  const counts = new Map<number, number>();
  for (const c of cards) {
    counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  }
  const groups = Array.from(counts.values()).sort((a, b) => b - a);
  const flush = cards.every((c) => c.suit === cards[0].suit);

  const ranks = Array.from(counts.keys()).sort((a, b) => a - b);
  let straight = false;
  let straightHigh = -1;
  if (ranks.length === 5) {
    if (ranks[4] - ranks[0] === 4) {
      straight = true;
      straightHigh = ranks[4];
    } else if (
      // Wheel: A-2-3-4-5 (ace is rank 12).
      ranks[0] === 0 &&
      ranks[1] === 1 &&
      ranks[2] === 2 &&
      ranks[3] === 3 &&
      ranks[4] === 12
    ) {
      straight = true;
      straightHigh = 3;
    }
  }

  if (straight && flush) {
    return straightHigh === 12 ? "royal flush" : "straight flush";
  }
  if (groups[0] === 4) {
    return "four of a kind";
  }
  if (groups[0] === 3 && groups[1] === 2) {
    return "full house";
  }
  if (flush) {
    return "flush";
  }
  if (straight) {
    return "straight";
  }
  if (groups[0] === 3) {
    return "three of a kind";
  }
  if (groups[0] === 2 && groups[1] === 2) {
    return "two pair";
  }
  if (groups[0] === 2) {
    return "one pair";
  }
  return "high card";
}

// Category from rank multiplicity only, for 2–4 cards (no flush or straight
// can be complete yet).
function categorizePartial(cards: Parsed[]): HandName {
  const counts = new Map<number, number>();
  for (const c of cards) {
    counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  }
  const groups = Array.from(counts.values()).sort((a, b) => b - a);
  if (groups[0] === 4) {
    return "four of a kind";
  }
  if (groups[0] === 3) {
    return "three of a kind";
  }
  if (groups[0] === 2 && groups[1] === 2) {
    return "two pair";
  }
  if (groups[0] === 2) {
    return "one pair";
  }
  return "high card";
}

/**
 * Best hand category makeable from the given cards (hole + board, in any
 * order). Returns null when fewer than two valid cards are present.
 */
export function bestHandName(
  cards: (string | undefined | null)[]
): HandName | null {
  const parsed = cards.map(parse).filter((c): c is Parsed => c !== null);
  if (parsed.length < 2) {
    return null;
  }
  if (parsed.length < 5) {
    return categorizePartial(parsed);
  }
  if (parsed.length === 5) {
    return categorizeFive(parsed);
  }
  // 6 or 7 cards: best category over every 5-card combination.
  let best = 0;
  const n = parsed.length;
  const pick: Parsed[] = [];
  const walk = (start: number) => {
    if (pick.length === 5) {
      const idx = ORDER.indexOf(categorizeFive(pick));
      if (idx > best) {
        best = idx;
      }
      return;
    }
    for (let i = start; i < n; i++) {
      pick.push(parsed[i]);
      walk(i + 1);
      pick.pop();
    }
  };
  walk(0);
  return ORDER[best];
}
