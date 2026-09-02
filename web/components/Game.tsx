import { useContext } from "react";
import ChatLog from "./ChatLog";
import GameInfo from "./GameInfo";
import Start from "./Start";
import Input from "./Input";
import Table from "./Table";
import Wallet from "./Wallet";
import Settlement from "./Settlement";
import Settings from "./Settings";
import { AppContext } from "../providers/AppStore";
import { useSocket } from "../hooks/useSocket";
import { useTranslation } from "../hooks/useTranslation";
import { leaveTable, queueNext, voteSettle } from "../actions/actions";
import { clearSession } from "../lib/session";
import { FiCheckCircle, FiCircle } from "react-icons/fi";

export default function Game() {
  const { appState, dispatch } = useContext(AppContext);
  const socket = useSocket();
  const { t } = useTranslation();

  const handleLeave = () => {
    clearSession();
    if (socket && appState.table) {
      leaveTable(socket, appState.table);
    }
    dispatch({ type: "leaveRoom" });
  };

  const game = appState.game;
  const me = game?.players.find((p) => p.uuid === appState.clientID);
  const queued = !me && !!game?.waiting.includes(appState.username ?? "");
  const buyIn = game?.config.buyIn ?? 0;
  const maxBuyIns =
    buyIn > 0 ? Math.floor((game?.config.maxBuy ?? 0) / buyIn) : 0;
  const usedBuyIns = buyIn > 0 ? Math.floor((me?.totalBuyIn ?? 0) / buyIn) : 0;
  const remainingBuyIns = Math.max(0, maxBuyIns - usedBuyIns);

  // A session is active once it has started running or finished a hand.
  const showVotes = !!game && (game.running || game.handsPlayed > 0);
  const myVoted = !!game && game.settleVotes.includes(appState.username ?? "");
  const topOffset = game ? "top-10" : "top-0";

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <div className="flex h-screen w-screen items-start justify-center">
        <Table />
      </div>
      {game && (
        <div className="absolute left-1/2 top-0 z-50 flex -translate-x-1/2 flex-row items-center gap-2 rounded-b-lg bg-zinc-900/90 px-4 py-1.5">
          {showVotes && (
            <div className="flex flex-row items-center gap-1.5">
              {game.players.map((p) => (
                <span key={p.position} className="text-lg leading-none">
                  {game.settleVotes.includes(p.username) ? (
                    <FiCheckCircle className="text-emerald-400" />
                  ) : (
                    <FiCircle className="text-neutral-500" />
                  )}
                </span>
              ))}
            </div>
          )}
          <span className="whitespace-nowrap text-sm font-medium text-neutral-200">
            {t("hands")} {game.handsPlayed}/
            {game.config.handsLimit > 0 ? game.config.handsLimit : "∞"}
          </span>
        </div>
      )}
      {!appState.clientID && appState.game && (
        <div
          className={`absolute left-1/2 z-40 -translate-x-1/2 rounded-b-lg bg-zinc-900/80 px-4 py-1.5 text-sm font-medium text-neutral-200 ${topOffset}`}
        >
          {appState.game.running ? (
            <button
              onClick={() => socket && queueNext(socket)}
              className={queued ? "text-amber-300" : "hover:underline"}
            >
              {queued ? t("queuedNextHand") : t("joinNextHand")}
            </button>
          ) : (
            t("pickSeat")
          )}
        </div>
      )}
      {me && game && !game.running && !me.ready && (
        <div
          className={`absolute left-1/2 z-40 flex -translate-x-1/2 flex-col items-center rounded-b-lg bg-zinc-900/80 px-4 py-1.5 ${topOffset}`}
        >
          <p className="text-sm font-medium text-white">
            {t("clickAvatarToReady")}
          </p>
          {maxBuyIns > 0 && (
            <p className="text-xs text-neutral-400">
              {t("buyInsLeft")}: {remainingBuyIns}
            </p>
          )}
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col sm:block">
        <div className="w-full sm:pointer-events-none sm:absolute sm:inset-x-0 sm:bottom-0 sm:z-20">
          <Input />
        </div>
        <div className="w-full sm:absolute sm:bottom-0 sm:left-0 sm:right-auto sm:z-10">
          <ChatLog />
        </div>
      </div>
      <div className="absolute left-0 top-0 z-10 flex flex-row items-center gap-1">
        <button
          onClick={handleLeave}
          className="m-2 rounded-sm border border-rose-600 px-3 py-1.5 text-sm font-semibold text-rose-500 hover:bg-rose-600 hover:text-white"
        >
          {t("leave")}
        </button>
        {me && showVotes && (
          <button
            onClick={() => socket && voteSettle(socket)}
            className={`m-2 rounded-sm border px-3 py-1.5 text-sm font-semibold ${
              myVoted
                ? "border-neutral-500 bg-zinc-700 text-white hover:bg-zinc-600"
                : "border-rose-600 text-rose-500 hover:bg-rose-600 hover:text-white"
            }`}
          >
            {t("voteSettle")}
          </button>
        )}
      </div>
      <div className="absolute top-0 right-0 z-10 p-2 sm:hidden">
        <Wallet />
      </div>
      <div className="absolute top-0 right-0 z-10 hidden flex-col items-end gap-2 p-2 sm:flex">
        <GameInfo />
        <Wallet />
        <Settings />
      </div>
      <div className="absolute bottom-0 right-0 z-30">
        <Start />
      </div>
      <Settlement />
    </div>
  );
}
