import { Ref, useContext, useState } from "react";
import {
  FiCheck,
  FiChevronRight,
  FiEye,
  FiLock,
  FiShield,
  FiUnlock,
  FiUser,
  FiUsers,
  FiX,
} from "react-icons/fi";
import { AppContext } from "../providers/AppStore";
import { useTranslation } from "../hooks/useTranslation";
import { useSocket } from "../hooks/useSocket";
import { getUser, takeSeat } from "../actions/actions";
import { spectatorSeatState } from "../lib/spectatorSeat";
import Avatar from "./Avatar";
import ChatLog from "./ChatLog";
import RoomMenu from "./RoomMenu";
import Portal from "./Portal";
import ui from "../styles/Dialog.module.css";

type RoomDockProps = { dockRef: Ref<HTMLDivElement> };

export default function RoomDock({ dockRef }: RoomDockProps) {
  const { appState } = useContext(AppContext);
  const { t } = useTranslation();
  const socket = useSocket();
  const [showSpectators, setShowSpectators] = useState(false);

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
      {!me && (
        <section className="spectator-card" aria-label={t("spectatorPanel")}>
          <div className="spectator-identity">
            <header className="spectator-heading">
              {game.running ? (
                <FiEye aria-hidden="true" />
              ) : (
                <FiShield aria-hidden="true" />
              )}
              <div>
                <h2>{game.running ? t("spectatorPanel") : "备战中"}</h2>
                <span>{game.running ? "SPECTATOR" : "READY ROOM"}</span>
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

                <p className={reservation ? "is-reserved" : ""}>
                  {t(status)}
                </p>

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

        <button
          className="room-spectators-trigger"
          onClick={() => setShowSpectators(true)}
          aria-label={`${t("spectatorList")} (${spectators.length})`}
        >
          <FiUsers aria-hidden="true" />
          <span>
            {t("spectatorList")} <b>({spectators.length})</b>
          </span>
          <FiChevronRight className="spectator-chevron" aria-hidden="true" />
        </button>

        <RoomMenu docked />
      </div>

      {showSpectators && (
        <Portal>
          <div className={ui.overlay} onClick={() => setShowSpectators(false)}>
            <section
              className={`${ui.dialog} room-spectators-dialog`}
              role="dialog"
              aria-modal="true"
              aria-label={t("spectatorList")}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={ui.dialogHeader}>
                <h2>
                  {t("spectatorList")} ({spectators.length})
                </h2>

                <button
                  className={ui.iconButton}
                  onClick={() => setShowSpectators(false)}
                  aria-label={t("close")}
                >
                  <FiX />
                </button>
              </div>

              {spectators.length === 0 ? (
                <p className="text-muted">{t("noSpectators")}</p>
              ) : (
                <ul>
                  {spectators.map((person, i) => (
                    <li key={person.accountUuid || `guest-${i}`}>
                      <button
                        disabled={!person.accountUuid || !socket}
                        onClick={() => {
                          if (socket) {
                            getUser(socket, person.accountUuid);
                            setShowSpectators(false);
                          }
                        }}
                      >
                        <span className="spectator-list-avatar">
                          <FiUser aria-hidden="true" />
                        </span>

                        <span>{person.username || t("guestSpectator")}</span>

                        {person.accountUuid === appState.uuid && (
                          <small>{t("you")}</small>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </Portal>
      )}
    </div>
  );
}
