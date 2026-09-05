import { useContext } from "react";
import { AppContext } from "../providers/AppStore";
import { useTranslation } from "../hooks/useTranslation";
import Avatar from "./Avatar";

// Crown for the top two finishers: gold for first, silver for second.
function Crown({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={className ?? "h-5 w-5"}
    >
      <path d="M3 8.5 7.2 12l4.8-7 4.8 7L21 8.5 19.4 18H4.6L3 8.5zm1.6 11h14.8v1.8H4.6V19.5z" />
    </svg>
  );
}

export default function Settlement() {
  const { appState, dispatch } = useContext(AppContext);
  const { t } = useTranslation();
  const settlement = appState.settlement;

  if (!settlement) {
    return null;
  }

  const close = () => {
    dispatch({ type: "setSettlement", payload: null });
  };

  // Ranked by net result; ties share the same rank (1, 1, 3 …).
  const ranked = [...settlement.players].sort((a, b) => b.net - a.net);
  const rankOf = (i: number) => {
    let r = i;
    while (r > 0 && ranked[r - 1].net === ranked[i].net) {
      r--;
    }
    return r + 1;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-lg bg-card p-6 shadow-2xl">
        <div className="mb-4 flex flex-row items-center justify-between">
          <p className="text-xl font-semibold text-ink">{t("settlement")}</p>
          <button onClick={close} className="btn btn-text">
            ✕
          </button>
        </div>

        {settlement.biggestPotAmount > 0 && (
          <p className="mb-4 rounded-md bg-floor px-3 py-2 text-sm text-amber-300">
            {t("biggestPot")}: {settlement.biggestPotWinner} +
            {settlement.biggestPotAmount}
          </p>
        )}

        <div className="flex flex-col gap-2">
          {ranked.map((p, i) => {
            const rank = rankOf(i);
            return (
              <div
                key={(p.uuid || p.username) + "-" + i}
                className="flex flex-row items-center justify-between rounded-md bg-floor px-3 py-2"
              >
                <div className="flex min-w-0 flex-row items-center gap-2">
                  <span
                    className="flex w-7 shrink-0 items-center justify-center"
                    title={t("rank") + " " + rank}
                  >
                    {rank === 1 ? (
                      <Crown className="h-5 w-5 text-yellow-400 drop-shadow-[0_0_4px_rgba(250,204,21,0.6)]" />
                    ) : rank === 2 ? (
                      <Crown className="h-5 w-5 text-slate-300" />
                    ) : (
                      <span className="type-num text-sm text-muted">
                        {rank}
                      </span>
                    )}
                  </span>
                  <Avatar
                    username={p.username}
                    uuid={p.uuid}
                    emoji={p.avatar || "🙂"}
                    hasImage={p.avatarImage}
                    size={28}
                  />
                  <span className="truncate text-ink">{p.username}</span>
                </div>
                <div className="flex shrink-0 flex-row items-center gap-3">
                  <span className="type-caption font-mono">
                    {t("buyInLabel")} {p.buyIn}
                  </span>
                  <span
                    className={`font-mono text-base font-semibold ${
                      p.net >= 0 ? "text-emerald-400" : "text-rose-400"
                    }`}
                  >
                    {p.net >= 0 ? "+" : ""}
                    {p.net}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
