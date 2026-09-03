import { useContext, useState } from "react";
import { FiBarChart2 } from "react-icons/fi";
import { AppContext } from "../providers/AppStore";
import { useTranslation } from "../hooks/useTranslation";
import Avatar from "./Avatar";

export default function RoomStats() {
  const { appState } = useContext(AppContext);
  const { t } = useTranslation();
  const [show, setShow] = useState(false);

  const players = [
    ...(appState.game?.players ?? []),
    ...(appState.game?.departedPlayers ?? []),
  ];

  return (
    <>
      <button
        onClick={() => setShow(true)}
        title={t("roomStats")}
        className="inline-flex flex-row items-center gap-1.5 rounded-sm border border-neutral-500 px-3 py-1.5 text-sm font-semibold text-neutral-300 hover:bg-neutral-700"
      >
        <FiBarChart2 size="1rem" />
        {t("roomStats")}
      </button>

      {show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-lg bg-zinc-800 p-6 shadow-2xl">
            <div className="mb-4 flex flex-row items-center justify-between">
              <p className="text-lg font-semibold text-white">
                {t("roomStats")}
              </p>
              <button
                onClick={() => setShow(false)}
                className="rounded-sm px-2 py-1 text-neutral-400 hover:bg-zinc-700 hover:text-white"
              >
                ✕
              </button>
            </div>

            {players.length === 0 && (
              <p className="text-sm text-neutral-500">{t("noPlayers")}</p>
            )}

            <div className="mb-2 flex flex-row items-center justify-between px-3 font-mono text-xs text-neutral-500">
              <span>{t("player")}</span>
              <div className="flex flex-row items-center gap-2">
                <span className="w-12 text-right">{t("buyInLabel")}</span>
                <span className="w-12 text-right">{t("chips")}</span>
                <span className="w-14 text-right">{t("net")}</span>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              {players.map((p) => {
                const net = p.stack - p.totalBuyIn;
                return (
                  <div
                    key={p.uuid}
                    className="flex flex-row items-center justify-between rounded-md bg-neutral-700 px-3 py-2"
                  >
                    <div className="flex min-w-0 flex-row items-center gap-2">
                      <Avatar
                        username={p.username}
                        uuid={p.accountUuid}
                        emoji={p.avatar || "🙂"}
                        hasImage={p.avatarImage}
                        size={28}
                      />
                      <span className="truncate text-white">{p.username}</span>
                    </div>
                    <div className="flex flex-row items-center gap-2 font-mono text-sm">
                      <span className="w-12 text-right text-neutral-400">
                        {p.totalBuyIn}
                      </span>
                      <span className="w-12 text-right text-neutral-200">
                        {p.stack}
                      </span>
                      <span
                        className={`w-14 text-right font-semibold ${
                          net >= 0 ? "text-emerald-400" : "text-rose-400"
                        }`}
                      >
                        {net >= 0 ? "+" : ""}
                        {net}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
