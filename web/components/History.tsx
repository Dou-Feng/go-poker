import { useContext } from "react";
import { AppContext } from "../providers/AppStore";
import { HistoryRecord } from "../interfaces";
import { useTranslation } from "../hooks/useTranslation";
import Avatar from "./Avatar";

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleString();
}

type HistoryProps = {
  onClose: () => void;
};

export default function History({ onClose }: HistoryProps) {
  const { appState, dispatch } = useContext(AppContext);
  const { t } = useTranslation();
  const records = appState.history ?? [];

  const viewSession = (rec: HistoryRecord) => {
    dispatch({
      type: "setProfile",
      payload: {
        uuid: rec.uuid,
        username: rec.username,
        avatar: rec.avatar || "🙂",
        avatarImage: rec.avatarImage,
        chips: 0,
        friends: [],
        stats: rec.stats,
        buyIn: rec.buyIn,
        net: rec.net,
      },
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-full max-h-[80vh] w-full max-w-md flex-col rounded-lg bg-zinc-800 shadow-2xl">
        <div className="flex flex-row items-center justify-between border-b border-zinc-700 px-4 py-3">
          <p className="text-sm font-semibold text-white">{t("history")}</p>
          <button
            onClick={onClose}
            className="rounded-sm px-2 py-1 text-neutral-400 hover:bg-zinc-700 hover:text-white"
          >
            ✕
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
          {records.length === 0 && (
            <p className="text-sm text-neutral-600">{t("noHistory")}</p>
          )}
          {records.map((rec, i) => (
            <button
              key={i}
              onClick={() => viewSession(rec)}
              className="flex flex-row items-center justify-between rounded-sm bg-neutral-800 px-4 py-2 text-left hover:bg-neutral-700"
            >
              <div className="flex flex-row items-center gap-3">
                <Avatar
                  username={rec.username}
                  uuid={rec.uuid}
                  emoji={rec.avatar || "🙂"}
                  hasImage={rec.avatarImage}
                  size={28}
                />
                <div className="flex flex-col">
                  <p className="text-white">{rec.username}</p>
                  <p className="text-xs text-neutral-500">
                    {rec.room} · {formatTime(rec.time)}
                  </p>
                </div>
              </div>
              <div className="flex flex-col items-end">
                <p
                  className={`text-sm font-semibold ${
                    rec.net >= 0 ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {rec.net >= 0 ? "+" : ""}
                  {rec.net}
                </p>
                <p className="text-xs text-neutral-500">
                  {t("handsPlayed")}: {rec.stats.handsPlayed}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
