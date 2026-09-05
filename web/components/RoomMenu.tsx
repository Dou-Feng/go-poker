import { useContext, useEffect, useState } from "react";
import { FiCheck, FiCpu, FiMoreHorizontal, FiX } from "react-icons/fi";
import classNames from "classnames";
import { AppContext } from "../providers/AppStore";
import { useSocket } from "../hooks/useSocket";
import { useTranslation } from "../hooks/useTranslation";
import { spectate } from "../actions/actions";
import EyeIcon from "./EyeIcon";
import Rebuy from "./Rebuy";
import RoomStats from "./RoomStats";

// The "..." menu in the room's bottom-right corner. It gathers the
// secondary controls (rebuy, spectate, room stats) that used to sit as
// separate floating buttons. The menu is closed by default and stacks above
// the action bar, so a player taps "..." again to clear the way when it is
// their turn.
export default function RoomMenu() {
  const { appState, dispatch } = useContext(AppContext);
  const socket = useSocket();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // Whether the player has reserved to spectate once the current hand ends.
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

  // Bots are seats played by the server. Only the room's host manages them,
  // between hands, through a placement mode: while it is on, empty seats show
  // "+" (tap to seat a bot there) and seated bots can be tapped to remove.
  const isHost = !!appState.uuid && game.host === appState.uuid;
  const botMode = appState.botMode;
  const botCount = game.players.filter((p) => p.bot).length;

  return (
    <div className="absolute bottom-28 right-2 z-40 flex flex-col items-end gap-1 sm:bottom-32">
      {open && (
        <div className="flex flex-col items-stretch gap-1 rounded-lg border border-muted/30 bg-tablehi/95 p-1.5 shadow-lg">
          {me && <Rebuy className="w-full" />}
          {me && (
            <button
              onClick={() => {
                if (!socket) {
                  return;
                }
                setReservedSpectate(!reservedSpectate);
                spectate(socket);
              }}
              className={classNames(
                "btn w-full justify-start",
                reservedSpectate
                  ? "btn-accent border border-amber-500"
                  : "btn-ghost"
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
          <RoomStats className="w-full justify-start" />
          {isHost && (
            <button
              onClick={() =>
                dispatch({ type: "setBotMode", payload: !botMode })
              }
              disabled={game.running}
              title={
                game.running
                  ? t("gameAlreadyRunning")
                  : botMode
                  ? t("botModeDone")
                  : t("botModeHint")
              }
              aria-pressed={botMode}
              className={classNames(
                "btn w-full justify-start",
                botMode ? "btn-confirm" : "btn-ghost"
              )}
            >
              {botMode ? <FiCheck size="1rem" /> : <FiCpu size="1rem" />}
              {botMode ? t("botModeDone") : t("addBot")}
              {botCount > 0 && !botMode && (
                <span className="type-caption ml-auto">🤖 {botCount}</span>
              )}
            </button>
          )}
        </div>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={t("more")}
        className={classNames(
          "btn btn-ghost h-8 w-10 bg-tablehi/80 px-0",
          open && "bg-floor"
        )}
      >
        {open ? <FiX size="1rem" /> : <FiMoreHorizontal size="1rem" />}
      </button>
    </div>
  );
}
