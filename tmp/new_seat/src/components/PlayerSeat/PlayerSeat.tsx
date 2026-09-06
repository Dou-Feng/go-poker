import React from "react";
import "./PlayerSeat.css";
import type { PlayerSeatProps, PokerCard } from "./PlayerSeat.types";

function FaceCard({ card }: { card: PokerCard }) {
  const red = card.suit === "♥" || card.suit === "♦";
  return (
    <div className="gps-card gps-card--face">
      <b>{card.rank}</b>
      <span className={red ? "gps-card__red" : ""}>{card.suit}</span>
    </div>
  );
}

export function PlayerSeat({
  name,
  avatar,
  stack,
  bet = 0,
  cards = [],
  revealCards = false,
  isHero = false,
  state = "normal",
  position = null,
  timerPercent = 100,
  className = "",
  chipAssetPath = "/assets/ui/seat/gold_chip.svg",
  cardBackAssetPath = "/assets/ui/seat/card_back.svg",
}: PlayerSeatProps) {
  const shownCards = cards.slice(0, 2);
  const positionLabel =
    position === "dealer" ? "D" : position === "sb" ? "SB" : position === "bb" ? "BB" : null;

  return (
    <div className={[
      "gps-seat",
      `gps-seat--${state}`,
      isHero ? "gps-seat--hero" : "",
      className
    ].filter(Boolean).join(" ")}>
      {bet > 0 && (
        <div className="gps-seat__bet">
          <img src={chipAssetPath} alt="" />
          <strong>{bet.toLocaleString()}</strong>
        </div>
      )}

      <div className="gps-seat__avatar">
        <span>{avatar}</span>
        {positionLabel && (
          <span className={`gps-seat__position gps-seat__position--${position}`}>
            {positionLabel}
          </span>
        )}
      </div>

      <div className="gps-seat__cards">
        {[0, 1].map(index => {
          const card = shownCards[index];
          if ((revealCards || isHero) && card) {
            return <FaceCard card={card} key={index} />;
          }
          return (
            <div className="gps-card gps-card--back" key={index}>
              <img src={cardBackAssetPath} alt="" />
            </div>
          );
        })}
      </div>

      <div className="gps-seat__panel">
        <span className="gps-seat__status">
          {state === "active" ? "TURN" : state === "folded" ? "FOLDED" : state === "allin" ? "ALL-IN" : isHero ? "YOU" : ""}
        </span>
        <strong className="gps-seat__name">{name}</strong>
        <div className="gps-seat__stack">
          <img src={chipAssetPath} alt="" />
          <strong>{stack.toLocaleString()}</strong>
        </div>
      </div>

      {state === "active" && (
        <div className="gps-seat__timer">
          <span style={{ width: `${Math.max(0, Math.min(100, timerPercent))}%` }} />
        </div>
      )}
    </div>
  );
}

export default PlayerSeat;
