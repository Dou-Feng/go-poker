import { Ref, useContext } from "react";
import { FiCheck, FiEye, FiLock, FiUnlock } from "react-icons/fi";
import { AppContext } from "../providers/AppStore";
import { useTranslation } from "../hooks/useTranslation";
import { useSocket } from "../hooks/useSocket";
import { takeSeat } from "../actions/actions";
import { spectatorSeatState } from "../lib/spectatorSeat";
import Avatar from "./Avatar";
import ChatLog from "./ChatLog";
import RoomMenu from "./RoomMenu";
import SpectatorList from "./SpectatorList";
import RoomStats from "./RoomStats";

type RoomDockProps = { dockRef: Ref<HTMLDivElement> };

export default function RoomDock({ dockRef }: RoomDockProps) {
  const { appState } = useContext(AppContext);
  const { t } = useTranslation();
  const socket = useSocket();

  const game = appState.game;
  if (!game) return null;

  const me = game.players.find((p) => p.uuid === appState.clientID);

  const { reservation, seatID, blocked } = spectatorSeatState(
    game,
    appState.uuid,
    appState.chips
  );

  const spectators = game.spectators ?? [];

  const join = (id: number) => {
    if (socket && appState.username && id) {
      takeSeat(socket, appState.username, id, game.config.buyIn);
    }
  };

  const status = reservation
    ? "seatReservedStatus"
    : blocked ?? (game.running ? "reserveNextHandHint" : "pickSeat");

  return (
    <div className="room-dock" ref={dockRef}>
      {!me && game.running && (
        <section className="spectator-card" aria-label={t("spectatorPanel")}>
          <div className="spectator-identity">
            <header className="spectator-heading">
              <FiEye aria-hidden="true" />
              <div>
                <h2>{t("spectatorPanel")}</h2>
                <span>SPECTATOR</span>
              </div>
            </header>

            <div className="spectator-person">
              <span className="spectator-avatar">
                <Avatar
                  username={appState.username ?? ""}
                  uuid={appState.uuid ?? undefined}
                  emoji={appState.avatar ?? "🙂"}
                  hasImage={appState.avatarImage}
                  version={appState.avatarVersion}
                  size={48}
                />
              </span>

              <div className="spectator-copy">
                <strong title={appState.username ?? ""}>
                  {appState.username}
                </strong>

                <p className={reservation ? "is-reserved" : ""}>{t(status)}</p>

                <small
                  className={`spectator-reservation-hint ${
                    reservation ? "is-visible" : "is-hidden"
                  }`}
                  aria-hidden={!reservation}
                >
                  {t("autoSeatNextHand")}
                </small>
              </div>
            </div>

            <div className="spectator-buttons">
              <button
                className="spectator-primary"
                disabled={
                  !!reservation || !!blocked || !socket || !appState.username
                }
                onClick={() => join(seatID)}
              >
                <span
                  className={`spectator-primary-icon ${
                    reservation ? "is-visible" : "is-hidden"
                  }`}
                  aria-hidden="true"
                >
                  <FiCheck />
                </span>

                <span>
                  {t(
                    reservation
                      ? "seatReservedShort"
                      : game.running
                      ? "reserveSeat"
                      : "takeSeatNow"
                  )}
                </span>
              </button>

              <button
                className={`spectator-cancel ${
                  reservation ? "is-visible" : "is-hidden"
                }`}
                onClick={() => {
                  if (reservation) {
                    join(reservation.seatID);
                  }
                }}
                disabled={!reservation || !socket}
                aria-hidden={!reservation}
                tabIndex={reservation ? 0 : -1}
              >
                {t("cancelReservation")}
              </button>
            </div>
          </div>

          <aside className="spectator-room-info">
            <h3>
              {game.locked ? (
                <FiLock aria-hidden="true" />
              ) : (
                <FiUnlock aria-hidden="true" />
              )}
              {t("roomInfo")}
            </h3>

            <dl>
              <div>
                <dt>{t("blinds")}</dt>
                <dd>
                  {game.config.sb} / {game.config.bb}
                </dd>
              </div>

              <div>
                <dt>{t("buyIn")}</dt>
                <dd>{game.config.buyIn}</dd>
              </div>

              <div>
                <dt>{t("players")}</dt>
                <dd>
                  {game.players.filter((p) => !p.left).length} /{" "}
                  {game.config.maxPlayers}
                </dd>
              </div>

              <div>
                <dt>{t("spectate")}</dt>
                <dd>{spectators.length}</dd>
              </div>
            </dl>
          </aside>
        </section>
      )}

      <div className="room-dock-footer">
        <ChatLog dock />

        {me ? (
          <RoomStats dock className="room-dock-stats" />
        ) : (
          <SpectatorList />
        )}

        <RoomMenu docked />
      </div>
    </div>
  );
}
