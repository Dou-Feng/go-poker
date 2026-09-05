import { useContext, useState, useEffect } from "react";
import ChatLog from "./ChatLog";
import Chip from "./Chip";
import EyeIcon from "./EyeIcon";
import GameInfo from "./GameInfo";
import Input from "./Input";
import Table from "./Table";
import Wallet from "./Wallet";
import Settlement from "./Settlement";
import Settings from "./Settings";
import RoomStats from "./RoomStats";
import Rebuy from "./Rebuy";
import { AppContext } from "../providers/AppStore";
import { useSocket } from "../hooks/useSocket";
import { useTranslation } from "../hooks/useTranslation";
import { leaveTable, voteSettle, spectate } from "../actions/actions";
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

  // A session is active once it has started running or finished a hand.
  const showVotes = !!game && (game.running || game.handsPlayed > 0);
  const myVoted = !!game && game.settleVotes.includes(appState.username ?? "");

  // Whether the player has reserved to spectate once the current hand ends.
  const [reservedSpectate, setReservedSpectate] = useState(false);
  useEffect(() => {
    if (!me) {
      setReservedSpectate(false);
    }
  }, [me]);

  return (
    <div className="app-screen room-wallpaper relative w-screen overflow-hidden bg-floor">
      <div className="flex h-full w-full items-start justify-center">
        <Table />
      </div>
      {game && (
        <div className="absolute left-1/2 top-0 z-50 flex -translate-x-1/2 flex-row items-center gap-2 rounded-b-lg bg-tablehi/90 px-4 py-1.5">
          {showVotes && (
            <div className="flex flex-row items-center gap-1.5">
              {game.players.map((p) => (
                <span key={p.position} className="text-lg leading-none">
                  {game.settleVotes.includes(p.username) ? (
                    <FiCheckCircle className="text-emerald-400" />
                  ) : (
                    <FiCircle className="text-muted" />
                  )}
                </span>
              ))}
            </div>
          )}
          <span className="whitespace-nowrap text-sm font-medium text-ink">
            {t("hands")}{" "}
            {game.config.handsLimit > 0
              ? Math.min(game.handsPlayed + 1, game.config.handsLimit)
              : game.handsPlayed + 1}
            /{game.config.handsLimit > 0 ? game.config.handsLimit : "∞"}
          </span>
        </div>
      )}
      {appState.table && (
        <div className="pointer-events-none absolute bottom-44 left-0 z-10 px-2 sm:bottom-48">
          <p className="text-sm font-medium text-muted">{appState.table}</p>
        </div>
      )}
      <Rebuy />
      {me && game && (
        <button
          onClick={() => {
            if (!socket) {
              return;
            }
            setReservedSpectate(!reservedSpectate);
            spectate(socket);
          }}
          className={`btn absolute bottom-52 right-2 z-30 sm:bottom-56 ${
            reservedSpectate
              ? "btn-accent border border-amber-500"
              : "btn-ghost"
          }`}
        >
          {reservedSpectate ? (
            <span className="flex h-4 w-4 items-center justify-center leading-none">
              ✓
            </span>
          ) : (
            <EyeIcon className="h-4 w-4" />
          )}
          {t("spectate")}
        </button>
      )}
      <div className="absolute bottom-40 right-2 z-30 sm:bottom-44">
        <RoomStats />
      </div>
      <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col sm:block">
        <div className="w-full sm:pointer-events-none sm:absolute sm:inset-x-0 sm:bottom-0 sm:z-20">
          <Input />
        </div>
        <div className="w-full sm:absolute sm:bottom-0 sm:left-0 sm:right-auto sm:z-10">
          <ChatLog />
        </div>
      </div>
      <div className="absolute left-0 top-0 z-10 flex flex-row items-center">
        <button onClick={handleLeave} className="btn btn-danger m-2">
          {t("leave")}
        </button>
        {me && showVotes && (
          <button
            onClick={() => socket && voteSettle(socket)}
            className={`btn my-2 mr-2 ${
              myVoted ? "btn-secondary border-muted/40" : "btn-danger"
            }`}
          >
            {t("voteSettle")}
          </button>
        )}
      </div>
      <div className="absolute top-0 right-0 z-10 flex flex-col items-end gap-1 p-2 sm:hidden">
        <Wallet />
        {me && game && (
          <div className="inline-flex w-20 flex-row items-center justify-between rounded-md bg-card/90 px-2.5 py-1 text-sm text-amber-300">
            <Chip className="h-4 w-4" />
            <span className="type-num leading-none">{me.stack}</span>
          </div>
        )}
        <Settings />
      </div>
      <div className="absolute top-0 right-0 z-10 hidden flex-col items-end gap-2 p-2 sm:flex">
        <GameInfo />
        <Wallet />
        {me && game && (
          <div className="inline-flex w-20 flex-row items-center justify-between rounded-md bg-card/90 px-2.5 py-1 text-sm text-amber-300 shadow">
            <Chip className="h-4 w-4" />
            <span className="type-num leading-none">{me.stack}</span>
          </div>
        )}
        <Settings />
      </div>
      <Settlement />
    </div>
  );
}
