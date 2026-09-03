import { useContext } from "react";
import { AppContext } from "../providers/AppStore";
import { useTranslation } from "../hooks/useTranslation";
import Avatar from "./Avatar";

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-lg bg-zinc-800 p-6 shadow-2xl">
        <div className="mb-4 flex flex-row items-center justify-between">
          <p className="text-xl font-semibold text-white">{t("settlement")}</p>
          <button
            onClick={close}
            className="rounded-sm px-2 py-1 text-neutral-400 hover:bg-zinc-700 hover:text-white"
          >
            ✕
          </button>
        </div>

        {settlement.biggestPotAmount > 0 && (
          <p className="mb-4 rounded-md bg-zinc-700 px-3 py-2 text-sm text-amber-300">
            {t("biggestPot")}: {settlement.biggestPotWinner} +
            {settlement.biggestPotAmount}
          </p>
        )}

        <div className="flex flex-col gap-2">
          {settlement.players.map((p) => (
            <div
              key={p.username}
              className="flex flex-row items-center justify-between rounded-md bg-neutral-700 px-3 py-2"
            >
              <div className="flex flex-row items-center gap-2">
                <Avatar
                  username={p.username}
                  uuid={p.uuid}
                  emoji={p.avatar || "🙂"}
                  hasImage={p.avatarImage}
                  size={28}
                />
                <span className="text-white">{p.username}</span>
              </div>
              <span
                className={`font-mono text-base font-semibold ${
                  p.net >= 0 ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {p.net >= 0 ? "+" : ""}
                {p.net}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
