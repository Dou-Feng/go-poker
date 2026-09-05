import classNames from "classnames";
import { Card as CardType } from "../interfaces";

type cardProps = {
  card: CardType;
  placeholder: boolean;
  folded: boolean;
  hidden: boolean;
};

type ParsedCard = {
  rank: string;
  suit: string;
};

function cardToString(card: CardType): ParsedCard | null {
  // convert int32 cards to a rank/suit pair that we can display directly

  // card is the type representing a single playing card. It is 32 bits long, packed according to the following schematic:
  // 	+--------+--------+--------+--------+
  // 	|xxxbbbbb|bbbbbbbb|cdhsrrrr|xxpppppp|
  // 	+--------+--------+--------+--------+
  //
  // 	p 	= prime number of rank (deuce=2,trey=3,four=5,...,ace=41)
  // 	r 	= rank of card (deuce=0,trey=1,four=2,five=3,...,ace=12)
  // 	cdhs	= suit of card (bit turned on based on suit of card)
  // 	b 	= bit turned on depending on rank of card

  // opponents cards represented with "?"
  if (card === "?") {
    return null;
  }

  let c = parseInt(card);
  // bitwise operations to map int32 representation to string representation
  let rank = (c >> 8) & 0x0f;
  let suit = c & 0xf000;

  const numToCharRanks = [
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "J",
    "Q",
    "K",
    "A",
  ];
  const numToCharSuits = new Map<number, string>();
  numToCharSuits.set(0x8000, "C");
  numToCharSuits.set(0x4000, "D");
  numToCharSuits.set(0x2000, "H");
  numToCharSuits.set(0x1000, "S");

  const suitChar = numToCharSuits.get(suit);
  if (!suitChar) {
    return null;
  }

  return { rank: numToCharRanks[rank], suit: suitChar };
}

// Suit pips as inline SVG filled with the current text colour. The Unicode
// glyphs (\u2665\u2666\u2663\u2660) are unreliable: Android and some phone fonts render \u2666 and \u2663
// in emoji presentation with their own baked-in colours (red diamond, black
// club), ignoring CSS, so the four-colour deck only showed on desktop.
const SUIT_PATHS: Record<string, string> = {
  S: "M12 2C9.2 6.6 4 9.4 4 14a4 4 0 0 0 7 2.6c-.3 1.7-1.2 3.1-2.6 4.4h7.2c-1.4-1.3-2.3-2.7-2.6-4.4A4 4 0 0 0 20 14c0-4.6-5.2-7.4-8-12z",
  H: "M12 21.3S3.5 15.6 3.5 9.8A4.6 4.6 0 0 1 12 7.4a4.6 4.6 0 0 1 8.5 2.4c0 5.8-8.5 11.5-8.5 11.5z",
  D: "M12 1.8 20.4 12 12 22.2 3.6 12z",
  C: "M12 2.2a4.1 4.1 0 0 0-3.5 6.2 4.1 4.1 0 1 0 2.2 6c-.2 2.2-1.2 4.3-3.2 6.6h9c-2-2.3-3-4.4-3.2-6.6a4.1 4.1 0 1 0 2.2-6A4.1 4.1 0 0 0 12 2.2z",
};

function SuitPip({ suit, className }: { suit: string; className?: string }) {
  const d = SUIT_PATHS[suit];
  if (!d) {
    return null;
  }
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path d={d} />
    </svg>
  );
}

// Pip size tracks the old glyph size: ~20px on phones, ~40px on desktop.
const pipClass = "h-5 w-5 sm:h-10 sm:w-10";

function color(suit: string) {
  return classNames(
    {
      "text-red-700": suit == "H",
      "text-blue-700": suit == "D",
      "text-green-700": suit == "C",
      "text-black": suit == "S",
    },
    // Phone size is 36x56px: rank (text-base, 20px line) + suit (text-xl,
    // 25px line) + top padding must stay under 56px or the suit glyph spills
    // past the card's bottom edge. Desktop (64x96px) has room for the larger
    // faces.
    "rounded-md border border-zinc-100 shadow-2xl bg-white pt-0.5 px-1 text-xl leading-tight font-normal w-9 h-14 sm:pt-1 sm:px-2.5 sm:text-5xl sm:leading-normal sm:w-16 sm:h-24 flex items-center justify-start flex-col overflow-hidden"
  );
}

const rankClass =
  "flex w-full items-start justify-start text-base leading-tight font-semibold sm:text-3xl sm:leading-normal";

export default function Card({ card, placeholder, folded, hidden }: cardProps) {
  if (placeholder) {
    // Undealt board slot: a faint white outline of a card on the felt, not a
    // dark block (which looked like a cut-out in the table).
    return (
      <div className="bg-white/15 flex h-14 w-9 items-center justify-center rounded-md border border-white/40 sm:h-24 sm:w-16"></div>
    );
  }

  // A hidden card renders its back no matter whether the value parses:
  // censored hole cards arrive as 0 (see GameView.CensorFor), which has no
  // valid suit, but the back must still be drawn.
  if (hidden) {
    if (folded) {
      return (
        <div
          className={
            "animate-fold-away flex h-14 w-9 items-center justify-center rounded-md border-4 border border-white bg-red-900 sm:h-24 sm:w-16"
          }
        ></div>
      );
    }
    return (
      <div
        className={
          "flex h-14 w-9 items-center justify-center rounded-md border-4 border border-white bg-red-900 sm:h-24 sm:w-16"
        }
      ></div>
    );
  }
  const c = cardToString(card);
  if (!c) {
    return null;
  }
  if (folded) {
    return (
      <div className={classNames(color(c.suit), "animate-deal-in")}>
        <div className={classNames(rankClass, "opacity-40")}>{c.rank}</div>
        <SuitPip suit={c.suit} className={classNames(pipClass, "opacity-40")} />
      </div>
    );
  }
  return (
    <div className={classNames(color(c.suit), "animate-deal-in")}>
      <div className={rankClass}>{c.rank}</div>
      <SuitPip suit={c.suit} className={pipClass} />
    </div>
  );
}
