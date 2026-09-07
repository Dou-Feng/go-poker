import { useContext, useEffect } from "react";
import ChatLog from "./ChatLog";
import GameInfo from "./GameInfo";
import Input from "./Input";
import Table from "./Table";
import Wallet from "./Wallet";
import Stack from "./Stack";
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
import { startBgm, stopBgm } from "../lib/sfx";
import { roomAssetUrls } from "../lib/preload";
import { useSceneAssets } from "../hooks/useSceneAssets";
import AssetLoading from "./AssetLoading";
import { FiCheckCircle, FiCircle, FiFlag, FiLogOut } from "react-icons/fi";

export default function Game() {
  const { appState, dispatch } = useContext(AppContext);
  const socket = useSocket();
  const { t } = useTranslation();
  const assets = useSceneAssets(roomAssetUrls);

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

  // Room background music while on the table (the lobby runs its own track).
  useEffect(() => {
    startBgm("room");
    return () => stopBgm();
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
  // starts, when this client stops being the host, or once the host readies.
  const running = !!game?.running;
  const isHost = !!game && !!appState.uuid && game.host === appState.uuid;
  const hostReady = !!me?.ready;
  useEffect(() => {
    if (appState.botMode && (running || !isHost || hostReady)) {
      dispatch({ type: "setBotMode", payload: false });
    }
  }, [appState.botMode, running, isHost, hostReady, dispatch]);

  // Socket state and room lifecycle keep running while paint assets load.
  // The bounded gate also covers direct session restores into a cold room.
  if (!assets.ready) {
    return (
      <div className="app-screen relative flex items-center justify-center bg-floor">
        <AssetLoading progress={assets.progress} />
        <button
          onClick={handleLeave}
          className="btn btn-room-control absolute left-2 top-2"
        >
          <FiLogOut size={16} aria-hidden="true" />
          {t("leave")}
        </button>
      </div>
    );
  }

  // A session is active once it has started running or finished a hand.
  const showVotes = !!game && (game.running || game.handsPlayed > 0);
  const myVoted = !!game && game.settleVotes.includes(appState.username ?? "");
  // Bots never vote: the surrender tally only counts real players.
  const humanPlayers = game ? game.players.filter((p) => !p.bot) : [];

  return (
    <div
      className="app-screen room-wallpaper relative w-screen overflow-hidden bg-floor"
      // No long-press / right-click context menu anywhere in the room: the
      // hold gesture is a game control here.
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="room-table-layer flex h-full w-full items-start justify-center">
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
                {humanPlayers.map((p) => (
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
                {game.settleVotes.length}/{humanPlayers.length}
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
      {/* Bottom-right controls: stats / rebuy / spectate sit in the open,
          with host-only bot management behind the "..." button. */}
      <RoomMenu />
      {/* Bottom of the room: on phones only the action keys live here (the
          bottom edge is for core actions and the system gesture area);
          chat/log move to the table's left edge. Desktop keeps the chat
          tabs bottom-left. */}
      <div className="room-action-layer pointer-events-none absolute inset-x-0 bottom-0 z-50 flex flex-col sm:block">
        <div className="pointer-events-none w-full sm:absolute sm:inset-x-0 sm:bottom-0 sm:z-20">
          <Input />
        </div>
        <div className="pointer-events-none hidden w-full sm:absolute sm:bottom-0 sm:left-0 sm:right-auto sm:z-10 sm:block">
          <ChatLog />
        </div>
      </div>
      <div className="absolute left-1 top-[46%] z-20 -translate-y-1/2 sm:hidden">
        <ChatLog compact />
      </div>
      {/* Phones: the room name sits in the very bottom-left corner of the
          screen, inside the safe area (desktop shows it in the chat tab row). */}
      {appState.table && (
        <div className="pointer-events-none absolute bottom-[max(0.5rem,env(safe-area-inset-bottom))] left-2 z-30 sm:hidden">
          <p className="text-xs font-medium text-muted">{appState.table}</p>
        </div>
      )}
      {/* Leave / surrender buttons, anchored at the very top-left. The column
          mirrors the top-right toolbar: Leave lines up with the settings
          gear row and Surrender with the wallet row, sharing the compact
          room-control sizing (see .room-top-controls). On wide screens they
          sit side by side instead. */}
      <div className="room-top-controls absolute left-0 top-0 z-10 flex flex-col items-start gap-1 p-2 sm:flex-row sm:items-center sm:gap-1.5">
        <button
          onClick={handleLeave}
          data-sfx="pong"
          className="btn btn-room-control"
        >
          <FiLogOut size={16} aria-hidden="true" className="shrink-0" />
          {t("leave")}
        </button>
        {me && showVotes && (
          <button
            onClick={() => socket && voteSettle(socket)}
            data-sfx="pong"
            aria-pressed={myVoted}
            className="btn btn-room-control btn-room-surrender"
          >
            <FiFlag size={16} aria-hidden="true" className="shrink-0" />
            {t("voteSettle")}
          </button>
        )}
      </div>
      {/* Top-right toolbar: the mic / speaker / settings row sits at the very
          top of the room, above the wallet and stack. */}
      <div className="absolute top-0 right-0 z-10 flex flex-col items-end gap-1 p-2 sm:hidden">
        <div className="flex flex-row items-center gap-1">
          <VoiceControls />
          <Settings buttonClassName="room-icon-btn" />
        </div>
        <Wallet />
        <Stack />
      </div>
      <div className="absolute top-0 right-0 z-10 hidden flex-col items-end gap-2 p-2 sm:flex">
        <div className="flex flex-row items-center gap-1">
          <VoiceControls />
          <Settings buttonClassName="room-icon-btn" />
        </div>
        <GameInfo />
        <Wallet />
        <Stack />
      </div>
      <Settlement />
    </div>
  );
}
