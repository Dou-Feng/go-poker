import { useContext, useEffect, useRef, useState } from "react";
import { FiChevronUp, FiUsers } from "react-icons/fi";
import { AppContext } from "../providers/AppStore";
import { useSocket } from "../hooks/useSocket";
import { useTranslation } from "../hooks/useTranslation";
import { getUser } from "../actions/actions";
import Avatar from "./Avatar";

// The trigger stays in place while its surface grows upward over the table.
export default function SpectatorList() {
  const { appState } = useContext(AppContext);
  const socket = useSocket();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [availableHeight, setAvailableHeight] = useState(240);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = "room-spectator-list";
  const spectators = appState.game?.spectators ?? [];
  const label = `${t("spectatorList")} (${spectators.length})`;

  useEffect(() => {
    if (!open) return;
    const measure = () =>
      setAvailableHeight(
        Math.max(0, (root.current?.getBoundingClientRect().top ?? 256) - 16)
      );
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    measure();
    window.addEventListener("resize", measure);
    document.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("resize", measure);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open]);

  const content = (
    <>
      <FiUsers aria-hidden="true" />
      <span>
        {t("spectatorList")} <b>({spectators.length})</b>
      </span>
      <FiChevronUp className="spectator-chevron" aria-hidden="true" />
    </>
  );

  return (
    <div
      ref={root}
      className={`spectator-list ${open ? "is-open" : ""}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <span
        className="room-spectators-trigger spectator-list-sizing"
        aria-hidden="true"
      >
        {content}
      </span>
      <div className="spectator-list-surface">
        <div className="spectator-list-reveal" aria-hidden={!open}>
          <div
            className="spectator-list-scroll"
            style={{ maxHeight: Math.min(280, availableHeight) }}
            id={id}
            role="region"
            aria-label={t("spectatorList")}
          >
            {spectators.length === 0 ? (
              <p>{t("noSpectators")}</p>
            ) : (
              <ul>
                {spectators.map((person, index) => (
                  <li key={person.accountUuid || `guest-${index}`}>
                    <button
                      type="button"
                      tabIndex={open ? 0 : -1}
                      disabled={!socket || !person.accountUuid}
                      onClick={() => {
                        if (socket && person.accountUuid) {
                          getUser(socket, person.accountUuid);
                          setOpen(false);
                        }
                      }}
                    >
                      <span className="spectator-list-avatar">
                        <Avatar
                          username={person.username}
                          uuid={person.accountUuid}
                          emoji={person.avatar ?? "🙂"}
                          hasImage={person.avatarImage ?? false}
                          size={32}
                        />
                      </span>
                      <span
                        className="spectator-list-name"
                        title={person.username}
                      >
                        {person.username || t("guestSpectator")}
                      </span>
                      {person.accountUuid === appState.uuid && (
                        <small>{t("you")}</small>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <button
          ref={trigger}
          type="button"
          className="room-spectators-trigger"
          aria-expanded={open}
          aria-controls={id}
          aria-label={label}
          onClick={() => setOpen(!open)}
        >
          {content}
        </button>
      </div>
    </div>
  );
}
