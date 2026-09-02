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

function getSuitChar(letter: string) {
  // convert letter suit to unicode symbol
  switch (letter) {
    case "H":
      return "\u2665";
    case "D":
      return "\u2666";
    case "C":
      return "\u2663";
    case "S":
      return "\u2660";
    default:
      return "";
  }
}

function color(suit: string) {
  return classNames(
    {
      "text-red-700": suit == "H",
      "text-blue-700": suit == "D",
      "text-green-700": suit == "C",
      "text-black": suit == "S",
    },
    "rounded-md border border-zinc-100 shadow-2xl bg-white pt-0.5 px-1 text-2xl font-normal w-9 h-14 sm:pt-1 sm:px-2.5 sm:text-5xl sm:w-16 sm:h-24 flex items-center justify-start flex-col"
  );
}

export default function Card({ card, placeholder, folded, hidden }: cardProps) {
  if (placeholder) {
    return (
      <div className="flex h-14 w-9 items-center justify-center rounded-md bg-green-900 opacity-20 sm:h-24 sm:w-16"></div>
    );
  }

  const c = cardToString(card);
  if (!c) {
    return null;
  }
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
  if (folded) {
    return (
      <div className={classNames(color(c.suit), "animate-deal-in")}>
        <div
          className={
            "flex w-full items-start justify-start text-xl font-semibold opacity-40 sm:text-3xl"
          }
        >
          {c.rank}
        </div>
        <div className="opacity-40">{getSuitChar(c.suit)}</div>
      </div>
    );
  }
  return (
    <div className={classNames(color(c.suit), "animate-deal-in")}>
      <div
        className={
          "flex w-full items-start justify-start text-xl font-semibold sm:text-3xl"
        }
      >
        {c.rank}
      </div>
      <div>{getSuitChar(c.suit)}</div>
    </div>
  );
}
