import { useContext, useEffect, useRef, useState } from "react";
import RoomDock from "./RoomDock";
import GameInfo from "./GameInfo";
import Input from "./Input";
import Table from "./Table";
import Wallet from "./Wallet";
import Stack from "./Stack";
import Settlement from "./Settlement";
import Settings from "./Settings";
import RoomInfo from "./RoomInfo";
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
  const roomRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const [showRoomInfo, setShowRoomInfo] = useState(false);

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

  useEffect(() => {
    if (!assets.ready || !dockRef.current) return;
    const measure = () =>
      roomRef.current?.style.setProperty(
        "--room-dock-height",
        `${Math.ceil(dockRef.current?.getBoundingClientRect().height ?? 0)}px`
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(dockRef.current);
    return () => observer.disconnect();
  }, [assets.ready, !!game, !!me]);

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
      className="app-screen room-wallpaper room-with-dock relative w-screen overflow-hidden bg-floor"
      ref={roomRef}
      data-spectator={game && !me ? "true" : "false"}
      // No long-press / right-click context menu anywhere in the room: the
      // hold gesture is a game control here.
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="room-table-layer flex h-full w-full items-start justify-center">
        <Table />
      </div>
      {game && (
        <button
          type="button"
          onClick={() => setShowRoomInfo((o) => !o)}
          data-sfx="pong"
          aria-expanded={showRoomInfo}
          aria-label={t("roomInfo")}
          className="absolute left-1/2 top-0 z-50 flex -translate-x-1/2 cursor-pointer flex-row items-center gap-2 rounded-b-lg bg-tablehi/90 px-3 py-1.5 transition-colors hover:bg-cardhi/90 sm:px-4"
        >
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
        </button>
      )}
      {showRoomInfo && game && (
        <RoomInfo onClose={() => setShowRoomInfo(false)} />
      )}
      <RoomDock dockRef={dockRef} />
      <div className="room-action-layer pointer-events-none absolute inset-x-0 bottom-0 z-50">
        <Input />
      </div>
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
        <div className="room-desktop-info">
          <GameInfo />
        </div>
        <Wallet />
        <Stack />
      </div>
      <Settlement onLeaveRoom={handleLeave} />
    </div>
  );
}
