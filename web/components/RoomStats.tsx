import { useContext, useState } from "react";
import { FiBarChart2 } from "react-icons/fi";
import classNames from "classnames";
import { AppContext } from "../providers/AppStore";
import { useTranslation } from "../hooks/useTranslation";
import Scoreboard, { ScoreRow } from "./Scoreboard";

type roomStatsProps = {
  /** Extra classes for the trigger button. */
  className?: string;
};

// Live room scoreboard ("战绩"): the same table the settlement screen shows,
// computed from the current game view.
export default function RoomStats({ className }: roomStatsProps) {
  const { appState } = useContext(AppContext);
  const { t } = useTranslation();
  const [show, setShow] = useState(false);

  // One row per account: a player who left and sat down again has a departed
  // snapshot and a live seat, so buy-ins and stacks are summed per account.
  const rows: ScoreRow[] = [];
  const index = new Map<string, number>();
  for (const p of [
    ...(appState.game?.players ?? []),
    ...(appState.game?.departedPlayers ?? []),
  ]) {
    const key = p.accountUuid || "seat:" + p.uuid;
    const i = index.get(key);
    if (i !== undefined) {
      rows[i].buyIn += p.totalBuyIn;
      rows[i].stack += p.stack;
      continue;
    }
    index.set(key, rows.length);
    rows.push({
      key,
      username: p.username,
      uuid: p.accountUuid,
      avatar: p.avatar,
      avatarImage: p.avatarImage,
      buyIn: p.totalBuyIn,
      stack: p.stack,
    });
  }

  return (
    <>
      <button
        onClick={() => setShow(true)}
        title={t("roomStats")}
        className={classNames("btn btn-ghost", className)}
      >
        <FiBarChart2 size="1rem" />
        {t("roomStats")}
      </button>

      {show && (
        <Scoreboard
          title={t("roomStats")}
          rows={rows}
          onClose={() => setShow(false)}
        />
      )}
    </>
  );
}
