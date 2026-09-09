import { useContext, useEffect, useRef, useState } from "react";
import { FiBarChart2 } from "react-icons/fi";
import classNames from "classnames";
import { AppContext } from "../providers/AppStore";
import { Player } from "../interfaces";
import { useTranslation } from "../hooks/useTranslation";
import Scoreboard, { ScoreRow } from "./Scoreboard";

type roomStatsProps = {
  /** Extra classes for the trigger button. */
  className?: string;
  /** Use the room dock's upward-growing surface. */
  dock?: boolean;
};

// Live room scoreboard ("战绩"): the same table the settlement screen shows,
// computed from the current game view.
export default function RoomStats({ className, dock = false }: roomStatsProps) {
  const { appState } = useContext(AppContext);
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!dock || !show) return;
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setShow(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [dock, show]);

  // One row per account: a player who left and sat down again has a departed
  // snapshot and a live seat, so buy-ins and stacks are summed per account.
  // Seated entries are live: their stack is on the table. Departed stints
  // were cashed out when the player left (spectate / leave / bust), so they
  // add to the buy-in total and the net, never to the chips on the table —
  // otherwise spectating and re-sitting would "grow" a player's chips by a
  // buy-in each time. Stints without a hand played changed nothing and are
  // skipped, as on the server.
  const merged: ScoreRow[] = [];
  const hands = new Map<string, number>();
  const index = new Map<string, number>();
  const add = (p: Player, seated: boolean) => {
    if (!seated && (p.totalBuyIn === 0 || p.stats.handsPlayed === 0)) {
      return;
    }
    const key = p.accountUuid || "seat:" + p.uuid;
    hands.set(key, (hands.get(key) ?? 0) + (p.stats.handsPlayed ?? 0));
    const net = p.stack - p.totalBuyIn;
    const stack = seated ? p.stack : 0;
    const i = index.get(key);
    if (i !== undefined) {
      merged[i].buyIn += p.totalBuyIn;
      merged[i].net += net;
      merged[i].stack += stack;
      return;
    }
    index.set(key, merged.length);
    merged.push({
      key,
      username: p.username,
      uuid: p.accountUuid,
      avatar: p.avatar,
      avatarImage: p.avatarImage,
      buyIn: p.totalBuyIn,
      stack,
      net,
    });
  };
  for (const p of appState.game?.players ?? []) {
    add(p, true);
  }
  for (const p of appState.game?.departedPlayers ?? []) {
    add(p, false);
  }
  // Nobody is on the board before they have played a hand (a player who just
  // sat down, a bot just added): no result yet, same rule as the server.
  const rows = merged.filter((r) => (hands.get(r.key) ?? 0) > 0);

  const triggerContent = (
    <>
      <FiBarChart2 size="1rem" />
      {t("roomStats")}
    </>
  );

  if (dock) {
    return (
      <div
        ref={rootRef}
        className={`dock-expander dock-stats-expander ${show ? "is-open" : ""}`}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node))
            setShow(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setShow(false);
            triggerRef.current?.focus();
          }
        }}
      >
        <span
          className={`btn btn-room-control ${
            className ?? ""
          } dock-expander-sizing`}
          aria-hidden="true"
        >
          {triggerContent}
        </span>
        <div className="dock-expander-surface">
          <div className="dock-expander-reveal" aria-hidden={!show}>
            <div className="dock-stats-panel">
              <Scoreboard
                embedded
                title={t("roomStats")}
                rows={rows}
                onClose={() => setShow(false)}
              />
            </div>
          </div>
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setShow((value) => !value)}
            data-sfx="pong"
            title={t("roomStats")}
            aria-expanded={show}
            className={classNames("btn btn-room-control", className)}
          >
            {triggerContent}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setShow(true)}
        data-sfx="pong"
        title={t("roomStats")}
        className={classNames("btn btn-room-control", className)}
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
