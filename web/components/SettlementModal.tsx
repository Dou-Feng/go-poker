import { useTranslation } from "../hooks/useTranslation";
import Chip from "./Chip";

export type SettlementPlayer = {
  id: string;
  name: string;
  avatar: string;
  buyIn: number;
  endingChips: number;
};

type settlementModalProps = {
  players: SettlementPlayer[];
  winnerId: string;
  biggestPotPlayerId: string;
  biggestPot: number;
  onLeaveRoom: () => void;
  onNextHand: () => void;
};

// End-of-session result takeover (installed from tmp/new_settlement): a
// champion hero for the winner, per-player chip-flow rows (buy-in → end
// chips, net), the biggest pot, then leave/next actions.
export default function SettlementModal({
  players,
  winnerId,
  biggestPotPlayerId,
  biggestPot,
  onLeaveRoom,
  onNextHand,
}: settlementModalProps) {
  const { t } = useTranslation();
  const winner = players.find((p) => p.id === winnerId) ?? players[0];
  const biggestPotPlayer =
    players.find((p) => p.id === biggestPotPlayerId) ?? players[0];

  const profit = (p: SettlementPlayer) => p.endingChips - p.buyIn;
  const fmtProfit = (v: number) => `${v >= 0 ? "+" : ""}${v}`;

  return (
    <div className="settlement-root">
      <section
        className="settlement-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("settlement")}
      >
        <h1 className="settlement-title">{t("settlement")}</h1>

        {winner && (
          <section className="winner-hero">
            <img
              className="winner-laurel-bg"
              src="/assets/ui/settlement/champion-laurel.png"
              alt=""
              aria-hidden="true"
              draggable={false}
            />
            <div className="winner-left">
              <div className="trophy-placeholder" aria-hidden="true">
                🏆
              </div>
              <div className="winner-avatar">
                <span>{winner.avatar || "🙂"}</span>
                <span className="winner-crown" aria-hidden="true">
                  ♛
                </span>
                <span className="winner-pill">WIN</span>
              </div>
              <div className="winner-copy">
                <h2>{winner.name}</h2>
                <p>{t("winnerLabel")}</p>
              </div>
            </div>
            <div className="winner-profit">
              <span>{t("totalNet")}</span>
              <strong>{fmtProfit(profit(winner))}</strong>
            </div>
          </section>
        )}

        <div className="player-table-head">
          <strong>{t("settlementPlayers")}</strong>
          <span className="flow-head">
            <span>{t("buyInLabel")}</span>
            <span>{t("endChips")}</span>
          </span>
          <span>{t("net")}</span>
        </div>

        <div className="settlement-player-list">
          {players.map((player) => {
            const delta = profit(player);
            return (
              <div className="settlement-player-row" key={player.id}>
                <div className="settlement-player">
                  <div className="settlement-avatar">
                    <span>{player.avatar || "🙂"}</span>
                  </div>
                  <strong>{player.name}</strong>
                </div>

                <div className="chip-flow">
                  <span>{player.buyIn}</span>
                  <img
                    className="flow-arrow-svg"
                    src="/assets/ui/settlement/chip-flow-arrow.svg"
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                  />
                  <b>{player.endingChips}</b>
                </div>

                <strong
                  className={delta >= 0 ? "profit positive" : "profit negative"}
                >
                  {fmtProfit(delta)}
                </strong>
              </div>
            );
          })}
        </div>

        {biggestPot > 0 && biggestPotPlayer && (
          <>
            <h3 className="pot-heading">{t("biggestPot")}</h3>
            <div className="biggest-pot">
              <div className="pot-player">
                <div className="pot-avatar">
                  {biggestPotPlayer.avatar || "🪙"}
                </div>
                <strong>{biggestPotPlayer.name}</strong>
              </div>
              <div className="pot-amount">
                <span className="pot-chips" aria-hidden="true">
                  <Chip className="pot-chip pot-chip--back" tone="gold" />
                  <Chip className="pot-chip pot-chip--front" tone="gold" />
                </span>
                <strong>{biggestPot}</strong>
              </div>
            </div>
          </>
        )}

        <div className="settlement-actions">
          <button className="settlement-secondary" onClick={onLeaveRoom}>
            {t("settlementBack")}
          </button>
          <button className="settlement-primary" onClick={onNextHand}>
            <span className="play-triangle" aria-hidden="true">
              ▶
            </span>
            {t("settlementNext")}
          </button>
        </div>
      </section>
    </div>
  );
}
