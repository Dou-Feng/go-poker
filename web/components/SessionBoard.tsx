import { useContext } from "react";
import { AppContext } from "../providers/AppStore";
import { useTranslation } from "../hooks/useTranslation";
import Scoreboard, { ScoreRow } from "./Scoreboard";

function formatTime(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}

// A past room session opened from the history: the same scoreboard as the
// live "战绩" / settlement view, with every participant, ranked. Tapping a
// player opens their stats for that session in the profile popup.
export default function SessionBoard() {
  const { appState, dispatch } = useContext(AppContext);
  const { t } = useTranslation();
  const session = appState.sessionView;
  if (!session) {
    return null;
  }

  const rows: ScoreRow[] = session.players.map((p) => ({
    key: p.uuid || p.username,
    username: p.username,
    uuid: p.uuid,
    avatar: p.avatar,
    avatarImage: p.avatarImage,
    buyIn: p.buyIn,
    stack: p.buyIn + p.net,
  }));

  const select = (key: string) => {
    const p = session.players.find((q) => (q.uuid || q.username) === key);
    if (!p) {
      return;
    }
    dispatch({
      type: "setProfile",
      payload: {
        uuid: p.uuid,
        username: p.username,
        avatar: p.avatar || "🙂",
        avatarImage: p.avatarImage,
        chips: 0,
        friends: [],
        stats: p.stats,
        buyIn: p.buyIn,
        net: p.net,
      },
    });
  };

  return (
    <Scoreboard
      title={session.room}
      subtitle={`${formatTime(session.time)} · ${
        session.settled ? t("sessionSettled") : t("sessionOpen")
      }`}
      rows={rows}
      onSelect={select}
      selectHint={t("tapPlayerForStats")}
      onClose={() => dispatch({ type: "setSessionView", payload: null })}
    />
  );
}
