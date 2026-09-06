export type SeatState = "normal" | "active" | "folded" | "allin";
export type SeatPosition = "dealer" | "sb" | "bb" | null;
export type Suit = "♠" | "♥" | "♦" | "♣";

export interface PokerCard {
  rank: string;
  suit: Suit;
}

export interface PlayerSeatProps {
  name: string;
  avatar: string;
  stack: number;
  bet?: number;
  cards?: PokerCard[];
  revealCards?: boolean;
  isHero?: boolean;
  state?: SeatState;
  position?: SeatPosition;
  timerPercent?: number;
  className?: string;
  chipAssetPath?: string;
  cardBackAssetPath?: string;
}
