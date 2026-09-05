import { useContext, useEffect, useState } from "react";
import { FiMoreHorizontal, FiX } from "react-icons/fi";
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
  const { appState } = useContext(AppContext);
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
