import { useContext } from "react";
import { AppContext } from "../providers/AppStore";
import { HistoryRecord } from "../interfaces";
import { useTranslation } from "../hooks/useTranslation";
import { useSocket } from "../hooks/useSocket";
import { getSession } from "../actions/actions";
import Avatar from "./Avatar";
import { FiChevronRight, FiClock, FiX } from "react-icons/fi";
import historyStyles from "../styles/History.module.css";
import ui from "../styles/Dialog.module.css";

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleString();
}

type HistoryProps = {
  onClose: () => void;
};

export default function History({ onClose }: HistoryProps) {
  const { appState, dispatch } = useContext(AppContext);
  const { t } = useTranslation();
  const socket = useSocket();
  const records = appState.history ?? [];

  // Entries written since session records exist open the whole room's
  // scoreboard (SessionBoard); older ones fall back to the player's own
  // session stats.
  const viewSession = (rec: HistoryRecord) => {
    if (rec.sessionId && socket) {
      getSession(socket, rec.sessionId);
      return;
    }
    dispatch({
      type: "setProfile",
      payload: {
        uuid: rec.uuid,
        username: rec.username,
        avatar: rec.avatar || "🙂",
        avatarImage: rec.avatarImage,
        chips: 0,
        friends: [],
        stats: rec.stats,
        buyIn: rec.buyIn,
        net: rec.net,
      },
    });
  };

  return (
    <div className={ui.overlay}>
      <section
        className={`${ui.dialog} ${historyStyles.historyDialog}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-title"
      >
        <header className={ui.dialogHeader}>
          <h2 id="history-title">{t("history")}</h2>
          <button
            onClick={onClose}
            className={ui.iconButton}
            aria-label={t("close")}
          >
            <FiX />
          </button>
        </header>
        <p className={historyStyles.historyHint}>{t("historyDetailsHint")}</p>
        <div className={historyStyles.historyList}>
          {records.length === 0 && (
            <div className={historyStyles.historyEmpty}>
              <FiClock aria-hidden="true" />
              <p>{t("noHistory")}</p>
            </div>
          )}
          {records.map((rec, i) => (
            <button
              key={i}
              onClick={() => viewSession(rec)}
              className={historyStyles.historyRow}
            >
              <Avatar
                username={rec.username}
                uuid={rec.uuid}
                emoji={rec.avatar || "🙂"}
                hasImage={rec.avatarImage}
                size={36}
              />
              <div className={historyStyles.historyText}>
                <p>{rec.username}</p>
                <span>{rec.room}</span>
                <time dateTime={rec.time}>{formatTime(rec.time)}</time>
              </div>
              <div className={historyStyles.historyResult}>
                <p
                  className={
                    rec.net >= 0
                      ? historyStyles.positive
                      : historyStyles.negative
                  }
                >
                  {rec.net >= 0 ? "+" : ""}
                  {rec.net}
                </p>
                <span>
                  {t("handsPlayed")}: {rec.stats.handsPlayed}
                </span>
              </div>
              <FiChevronRight
                aria-hidden="true"
                className={historyStyles.chevron}
              />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
