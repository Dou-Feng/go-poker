import { useTranslation } from "../hooks/useTranslation";
import Chip from "./Chip";
import Avatar from "./Avatar";
import {
  SETTLEMENT_LAUREL_IMAGE,
  SETTLEMENT_FLOW_ARROW_IMAGE,
} from "../lib/preload";

export type SettlementPlayer = {
  id: string;
  name: string;
  avatar: string;
  /** Uploaded picture avatar — render it instead of the emoji fallback. */
  avatarImage?: boolean;
  avatarUuid?: string;
  avatarVersion?: number;
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

  // Settlement faces must reflect uploaded pictures too, not just emoji: show
  // the real <img> avatar when the account has one, else the emoji in the
  // circle (which keeps its existing font sizing from the parent rules).
  const avatarFace = (
    p: SettlementPlayer,
    size: number,
    fallback = "🙂"
  ) =>
    p.avatarImage && p.avatarUuid ? (
      <Avatar
        username={p.name}
        uuid={p.avatarUuid}
        emoji={p.avatar}
        hasImage
        size={size}
        version={p.avatarVersion}
      />
    ) : (
      <span>{p.avatar || fallback}</span>
    );

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
              src={SETTLEMENT_LAUREL_IMAGE}
              alt=""
              aria-hidden="true"
              draggable={false}
            />
            <div className="winner-left">
              <div className="trophy-placeholder" aria-hidden="true">
                🏆
              </div>
              <div className="winner-avatar">
                {avatarFace(winner, 78)}
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
                    {avatarFace(player, 48)}
                  </div>
                  <strong>{player.name}</strong>
                </div>

                <div className="chip-flow">
                  <span>{player.buyIn}</span>
                  <img
                    className="flow-arrow-svg"
                    src={SETTLEMENT_FLOW_ARROW_IMAGE}
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
                  {avatarFace(biggestPotPlayer, 40, "🪙")}
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
