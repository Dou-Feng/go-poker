import { useContext, useEffect, useState } from "react";
import { FiCheck, FiMoreHorizontal, FiX } from "react-icons/fi";
import classNames from "classnames";
import { AppContext } from "../providers/AppStore";
import { useSocket } from "../hooks/useSocket";
import { useTranslation } from "../hooks/useTranslation";
import { spectate } from "../actions/actions";
import EyeIcon from "./EyeIcon";
import RoomStats from "./RoomStats";

// The shared dock keeps room tools in a small menu beside chat. The standalone
// variant retains its open row; bot management is always host-only.
export default function RoomMenu({ docked = false }: { docked?: boolean }) {
  const { appState, dispatch } = useContext(AppContext);
  const socket = useSocket();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [reservedSpectate, setReservedSpectate] = useState(false);

  const game = appState.game;
  const me = game?.players.find((p) => p.uuid === appState.clientID);
  useEffect(() => {
    if (!me) {
      setReservedSpectate(false);
    }
  }, [me]);

  if (!game) {
    return null;
  }

  const isHost = !!appState.uuid && game.host === appState.uuid;
  const botMode = appState.botMode;
  const botCount = game.players.filter((p) => p.bot).length;
  const hostReady = !!me?.ready;

  return (
    <div
      className={
        docked
          ? "room-dock-menu"
          : "room-menu-controls absolute bottom-6 right-2 z-40 flex flex-col items-end gap-1 sm:bottom-8"
      }
    >
      {(!docked || open) && (
        <div className={docked ? "room-dock-menu-popup" : "contents"}>
          <RoomStats className="min-w-[4.5rem]" />
          {me && (
            <button
              onClick={() => {
                if (!socket) {
                  return;
                }
                setReservedSpectate(!reservedSpectate);
                spectate(socket);
              }}
              data-sfx="pong"
              aria-pressed={reservedSpectate}
              className={classNames(
                "btn btn-room-control min-w-[4.5rem]",
                reservedSpectate && "is-active"
              )}
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
          {open && isHost && (
            <button
              onClick={() =>
                dispatch({ type: "setBotMode", payload: !botMode })
              }
              data-sfx="pong"
              disabled={game.running || hostReady}
              title={
                game.running
                  ? t("gameAlreadyRunning")
                  : hostReady
                  ? t("cannotAddBotReady")
                  : botMode
                  ? t("botModeDone")
                  : t("botModeHint")
              }
              aria-pressed={botMode}
              className={classNames(
                "btn btn-room-control relative min-w-[4.5rem]",
                botMode && "is-active"
              )}
            >
              {botMode ? (
                <FiCheck size="1rem" />
              ) : (
                <img
                  src="/icons/robot.svg"
                  alt=""
                  aria-hidden
                  className="h-4 w-4"
                />
              )}
              {botMode ? t("botModeDone") : t("addBot")}
              {botCount > 0 && !botMode && (
                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-semibold leading-none text-ink">
                  {botCount}
                </span>
              )}
            </button>
          )}
        </div>
      )}
      {(isHost || docked) && (
        <button
          onClick={() => setOpen(!open)}
          data-sfx="pong"
          aria-expanded={open}
          aria-label={open ? t("close") : t("more")}
          title={open ? t("close") : t("more")}
          className={
            docked ? "room-dock-more" : "btn btn-room-control min-w-[4.5rem]"
          }
        >
          {open ? <FiX size="1rem" /> : <FiMoreHorizontal size="1rem" />}
        </button>
      )}
    </div>
  );
}
