import { useTranslation } from "../hooks/useTranslation";
import Avatar from "./Avatar";
import Portal from "./Portal";
import RankBadge, { rankAt } from "./RankBadge";

// One row per account: total buy-in, current chips and net for this room
// session. Used live from the "战绩" button and, unchanged, as the final
// settlement screen when the session ends.
export type ScoreRow = {
  key: string;
  username: string;
  uuid: string;
  avatar: string;
  avatarImage: boolean;
  buyIn: number;
  stack: number;
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
};

export default function Scoreboard({
  title,
  subtitle,
  rows,
  biggestPot,
  onSelect,
  selectHint,
  onClose,
}: scoreboardProps) {
  const { t } = useTranslation();
  const netOf = (r: ScoreRow) => r.stack - r.buyIn;
  // Ranked by net; equal nets share a rank (1, 1, 3 …).
  const ranked = [...rows].sort((a, b) => netOf(b) - netOf(a));

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
        <div className="w-full max-w-md rounded-lg bg-card p-6 shadow-2xl">
          <div className="mb-4 flex flex-row items-center justify-between">
            <div className="min-w-0">
              <p className="type-heading">{title}</p>
              {subtitle && <p className="type-caption truncate">{subtitle}</p>}
            </div>
            <button onClick={onClose} className="btn btn-text">
              ✕
            </button>
          </div>

          {biggestPot && biggestPot.amount > 0 && (
            <p className="mb-4 rounded-md bg-floor px-3 py-2 text-sm text-amber-300">
              {t("biggestPot")}: {biggestPot.winner} +{biggestPot.amount}
            </p>
          )}

          {ranked.length === 0 && (
            <p className="type-label">{t("noPlayers")}</p>
          )}

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
                    <span className="w-12 text-right text-muted">
                      {p.buyIn}
                    </span>
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
      </div>
    </Portal>
  );
}
