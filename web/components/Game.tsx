import { useContext, useEffect } from "react";
import ChatLog from "./ChatLog";
import Chip from "./Chip";
import GameInfo from "./GameInfo";
import Input from "./Input";
import Table from "./Table";
import Wallet from "./Wallet";
import Settlement from "./Settlement";
import Settings from "./Settings";
import RoomMenu from "./RoomMenu";
import VoiceControls from "./VoiceControls";
import { AppContext } from "../providers/AppStore";
import { useSocket } from "../hooks/useSocket";
import { useTranslation } from "../hooks/useTranslation";
import { leaveTable, voteSettle } from "../actions/actions";
import { clearSession } from "../lib/session";
import { voice } from "../lib/voice";
import { FiCheckCircle, FiCircle } from "react-icons/fi";

export default function Game() {
  const { appState, dispatch } = useContext(AppContext);
  const socket = useSocket();
  const { t } = useTranslation();

  // Voice chat is scoped to the room: bind the mesh to this room under our
  // account id, and switch it off when the screen goes away (leave button,
  // session expired, settlement back to lobby).
  const roomName = appState.table;
  const accountUuid = appState.uuid;
  useEffect(() => {
    if (roomName && accountUuid) {
      voice.enterRoom(roomName, accountUuid);
    }
  }, [roomName, accountUuid]);
  useEffect(() => {
    return () => voice.leaveRoom();
  }, []);

  const handleLeave = () => {
    voice.leaveRoom();
    clearSession();
    if (socket && appState.table) {
      leaveTable(socket, appState.table);
    }
    dispatch({ type: "leaveRoom" });
  };

  const game = appState.game;
  const me = game?.players.find((p) => p.uuid === appState.clientID);

  // Bot placement mode is a between-hands affair: leave it when a hand
  // starts or when this client stops being the host.
  const running = !!game?.running;
  const isHost = !!game && !!appState.uuid && game.host === appState.uuid;
  useEffect(() => {
    if (appState.botMode && (running || !isHost)) {
      dispatch({ type: "setBotMode", payload: false });
    }
  }, [appState.botMode, running, isHost, dispatch]);

  // A session is active once it has started running or finished a hand.
  const showVotes = !!game && (game.running || game.handsPlayed > 0);
  const myVoted = !!game && game.settleVotes.includes(appState.username ?? "");

  return (
    <div
      className="app-screen room-wallpaper relative w-screen overflow-hidden bg-floor"
      // No long-press / right-click context menu anywhere in the room: the
      // hold gesture is a game control here.
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="flex h-full w-full items-start justify-center">
        <Table />
      </div>
      {game && (
        <div className="absolute left-1/2 top-0 z-50 flex -translate-x-1/2 flex-row items-center gap-2 rounded-b-lg bg-tablehi/90 px-3 py-1.5 sm:px-4">
          {showVotes && (
            <>
              {/* One circle per player on wide screens; a compact "voted /
                  seated" count on phones so the pill stays narrow enough
                  not to reach the toolbars on either side. */}
              <div className="hidden flex-row items-center gap-1.5 sm:flex">
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
              <span className="flex flex-row items-center gap-1 text-xs text-muted sm:hidden">
                <FiCheckCircle className="text-emerald-400" />
                {game.settleVotes.length}/{game.players.length}
              </span>
            </>
          )}
          <span className="whitespace-nowrap text-xs font-medium text-ink sm:text-sm">
            {t("hands")}{" "}
            {game.config.handsLimit > 0
              ? Math.min(game.handsPlayed + 1, game.config.handsLimit)
              : game.handsPlayed + 1}
            /{game.config.handsLimit > 0 ? game.config.handsLimit : "∞"}
          </span>
        </div>
      )}
      {/* Secondary controls (rebuy / spectate / stats) live behind the "..."
          button; the room name sits in the chat tab row. */}
      <RoomMenu />
      <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col sm:block">
        <div className="w-full sm:pointer-events-none sm:absolute sm:inset-x-0 sm:bottom-0 sm:z-20">
          <Input />
        </div>
        <div className="w-full sm:absolute sm:bottom-0 sm:left-0 sm:right-auto sm:z-10">
          <ChatLog />
        </div>
      </div>
      {/* Leave / surrender buttons, anchored at the very top-left. On phones
          the surrender button stacks under the leave button (both flush
          left); the narrow column stays clear of the centred hands pill,
          which hangs from the top edge. */}
      <div className="absolute left-0 top-0 z-10 flex flex-col items-start sm:flex-row sm:items-center">
        <button onClick={handleLeave} className="btn btn-danger m-2">
          {t("leave")}
        </button>
        {me && showVotes && (
          <button
            onClick={() => socket && voteSettle(socket)}
            className={`btn mx-2 mb-2 sm:ml-0 sm:mt-2 ${
              myVoted ? "btn-secondary border-muted/40" : "btn-danger"
            }`}
          >
            {t("voteSettle")}
          </button>
        )}
      </div>
      {/* Top-right toolbar: the mic / speaker / settings row sits at the very
          top of the room, above the wallet and stack. */}
      <div className="absolute top-0 right-0 z-10 flex flex-col items-end gap-1 p-2 sm:hidden">
        <div className="flex flex-row items-center gap-1">
          <VoiceControls />
          <Settings />
        </div>
        <Wallet />
        {me && game && (
          <div className="inline-flex w-20 flex-row items-center justify-between rounded-md bg-card/90 px-2.5 py-1 text-sm text-amber-300">
            <Chip className="h-4 w-4" />
            <span className="type-num leading-none">{me.stack}</span>
          </div>
        )}
      </div>
      <div className="absolute top-0 right-0 z-10 hidden flex-col items-end gap-2 p-2 sm:flex">
        <div className="flex flex-row items-center gap-1">
          <VoiceControls />
          <Settings />
        </div>
        <GameInfo />
        <Wallet />
        {me && game && (
          <div className="inline-flex w-20 flex-row items-center justify-between rounded-md bg-card/90 px-2.5 py-1 text-sm text-amber-300 shadow">
            <Chip className="h-4 w-4" />
            <span className="type-num leading-none">{me.stack}</span>
          </div>
        )}
      </div>
      <Settlement />
    </div>
  );
}
