import { useTranslation } from "../hooks/useTranslation";
import Avatar from "./Avatar";
import Portal from "./Portal";
import RankBadge, { rankAt } from "./RankBadge";
import { FiX } from "react-icons/fi";
import ui from "../styles/Dialog.module.css";

// One row per account: total buy-in, current chips and net for this room
// session. Used live from the "战绩" button and, unchanged, as the final
// settlement screen when the session ends.
export type ScoreRow = {
  key: string;
  username: string;
  uuid: string;
  avatar: string;
  avatarImage: boolean;
  /** Total bought in over the session (every stint). */
  buyIn: number;
  /**
   * Chips on the table right now (0 for a player who has left). A departed
   * stint's stack was cashed out to the wallet, so it must never be added
   * here — it only contributes to `net`.
   */
  stack: number;
  /** Session result: sum over stints of (stack − buy-in). */
  net: number;
};

type scoreboardProps = {
  title: string;
  /** Small line under the title (room, time, status). */
  subtitle?: string;
  rows: ScoreRow[];
  /** Shown above the table when the session has settled. */
  biggestPot?: { winner: string; amount: number } | null;
  /** When set, rows are buttons and this receives the tapped row's key. */
  onSelect?: (key: string) => void;
  /** Hint shown under the table when rows are selectable. */
  selectHint?: string;
  onClose: () => void;
  /** Render inside an anchored room-dock surface instead of a modal portal. */
  embedded?: boolean;
};

export default function Scoreboard({
  title,
  subtitle,
  rows,
  biggestPot,
  onSelect,
  selectHint,
  onClose,
  embedded = false,
}: scoreboardProps) {
  const { t } = useTranslation();
  const netOf = (r: ScoreRow) => r.net;
  // Ranked by net; equal nets share a rank (1, 1, 3 …).
  const ranked = [...rows].sort((a, b) => netOf(b) - netOf(a));

  const content = (
    <div className={embedded ? "room-scoreboard-inline" : ui.dialog}>
      <div className={ui.dialogHeader}>
        <div className="min-w-0">
          <h2>{title}</h2>
          {subtitle && <p className="type-caption truncate">{subtitle}</p>}
        </div>
        <button
          onClick={onClose}
          data-sfx="back"
          aria-label={t("close")}
          className={ui.iconButton}
        >
          <FiX />
        </button>
      </div>

      {biggestPot && biggestPot.amount > 0 && (
        <p className="mb-4 rounded-md bg-floor px-3 py-2 text-sm text-amber-300">
          {t("biggestPot")}: {biggestPot.winner} +{biggestPot.amount}
        </p>
      )}

      {ranked.length === 0 && <p className="type-label">{t("noPlayers")}</p>}

      {ranked.length > 0 && (
        <div className="type-caption mb-2 flex flex-row items-center justify-between px-3 font-mono">
          <span className="pl-9">{t("player")}</span>
          <div className="flex flex-row items-center gap-2">
            <span className="w-12 text-right">{t("buyInLabel")}</span>
            <span className="w-12 text-right">{t("chips")}</span>
            <span className="w-14 text-right">{t("net")}</span>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {ranked.map((p, i) => {
          const net = netOf(p);
          const rank = rankAt(ranked, i, netOf);
          const Row = onSelect ? "button" : "div";
          return (
            <Row
              key={p.key}
              onClick={onSelect ? () => onSelect(p.key) : undefined}
              className={`flex w-full flex-row items-center justify-between rounded-md bg-floor px-3 py-2 text-left ${
                onSelect ? "hover:bg-cardhi" : ""
              }`}
            >
              <div className="flex min-w-0 flex-row items-center gap-2">
                <RankBadge rank={rank} title={t("rank") + " " + rank} />
                <Avatar
                  username={p.username}
                  uuid={p.uuid}
                  emoji={p.avatar || "🙂"}
                  hasImage={p.avatarImage}
                  size={28}
                />
                <span className="truncate text-ink">{p.username}</span>
              </div>
              <div className="flex shrink-0 flex-row items-center gap-2 font-mono text-sm">
                <span className="w-12 text-right text-muted">{p.buyIn}</span>
                <span className="w-12 text-right text-ink">{p.stack}</span>
                <span
                  className={`w-14 text-right font-semibold ${
                    net >= 0 ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {net >= 0 ? "+" : ""}
                  {net}
                </span>
              </div>
            </Row>
          );
        })}
      </div>
      {onSelect && selectHint && ranked.length > 0 && (
        <p className="type-caption mt-3 text-center">{selectHint}</p>
      )}
    </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <Portal>
      <div className={ui.overlay}>{content}</div>
    </Portal>
  );
}
