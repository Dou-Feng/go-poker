import { useContext, useEffect, useRef, useState } from "react";
import { Game as GameType } from "../interfaces";
import { AppContext } from "../providers/AppStore";
import { diffTableActions } from "../lib/tableFx";
import { subscribeFx } from "../lib/fxBus";
import classNames from "classnames";

// Geometry mirroring Table.tsx's seat layout (percent within the table
// container). Pot centre sits a little above the very centre.
const RX = 34;
const RY = 37;
const POT_X = 50;
const POT_Y = 44;

function seatXY(index: number, total: number): { x: number; y: number } {
  const angle = Math.PI / 2 + index * ((2 * Math.PI) / total);
  return { x: 50 + RX * Math.cos(angle), y: 50 + RY * Math.sin(angle) };
}

type FlySpec = {
  id: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  ms: number;
  delay: number;
};

type TagSpec = {
  id: number;
  x: number;
  y: number;
  text: string;
  tone: "action" | "fold" | "check";
};

let fxSeq = 1;

// One flying chip: mounts at the start point, then transitions to the end.
function FlyChip({
  chip,
  onDone,
}: {
  chip: FlySpec;
  onDone: (id: number) => void;
}) {
  const [phase, setPhase] = useState<"start" | "end">("start");
  useEffect(() => {
    const id = window.setTimeout(() => setPhase("end"), 20 + chip.delay);
    const done = window.setTimeout(
      () => onDone(chip.id),
      120 + chip.delay + chip.ms
    );
    return () => {
      window.clearTimeout(id);
      window.clearTimeout(done);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chip.id]);

  return (
    <div
      className={classNames(
        "absolute h-4 w-4 rounded-full shadow-md ring-1 ring-black/40 sm:h-6 sm:w-6",
        chip.color
      )}
      style={{
        left: `${phase === "start" ? chip.x1 : chip.x2}%`,
        top: `${phase === "start" ? chip.y1 : chip.y2}%`,
        transform: "translate(-50%, -50%)",
        transition: `left ${chip.ms}ms ease-in, top ${chip.ms}ms ease-in`,
        opacity: phase === "end" ? 0.85 : 0.2,
      }}
    />
  );
}

type props = {
  game: GameType;
  maxPlayers: number;
};

export default function TableFx({ game, maxPlayers }: props) {
  const { appState } = useContext(AppContext);
  const me = game?.players.find((p) => p.uuid === appState.clientID);
  const rotation = me ? me.seatID - 1 : 0;

  const [flies, setFlies] = useState<FlySpec[]>([]);
  const [tags, setTags] = useState<TagSpec[]>([]);
  // The rotation can settle after the seat is known; read the live value from
  // a ref inside the socket-driven callback instead of a stale closure.
  const rotationRef = useRef(rotation);
  rotationRef.current = rotation;
  const maxPlayersRef = useRef(maxPlayers);
  maxPlayersRef.current = maxPlayers;

  const dropChip = (id: number) =>
    setFlies((f) => f.filter((c) => c.id !== id));
  const dropTag = (id: number) => setTags((t) => t.filter((x) => x.id !== id));

  function flyBetween(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    color: string,
    delay = 0,
    ms = 550
  ) {
    setFlies((f) => [
      ...f,
      { id: fxSeq++, x1: fromX, y1: fromY, x2: toX, y2: toY, color, ms, delay },
    ]);
  }

  // Convert a game position (betting order number) to its on-screen seat slot,
  // mirroring Table.tsx exactly: seats are laid out by seatID, rotated so the
  // viewer's own seatID sits in slot 0. position and seatID-1 are NOT the same
  // thing, so we must resolve the acting player's seatID first.
  function seatSlot(
    players: GameType["players"],
    position: number
  ): number | null {
    const pl = players.find((p) => p.position === position);
    if (!pl) return null;
    return (
      (pl.seatID - 1 - rotationRef.current + maxPlayersRef.current) %
      maxPlayersRef.current
    );
  }

  function scheduleCollect(
    pots: GameType["pots"],
    players: GameType["players"]
  ) {
    pots.forEach((pot) => {
      if ((pot.amount ?? 0) <= 0) return;
      for (const num of pot.winningPlayerNums ?? []) {
        const slot = seatSlot(players, num);
        if (slot === null) continue;
        const seat = seatXY(slot, maxPlayersRef.current);
        // A few chips stream from the pot to each winner.
        for (let i = 0; i < 4; i++) {
          flyBetween(
            POT_X + (Math.random() - 0.5) * 10,
            POT_Y + (Math.random() - 0.5) * 10,
            seat.x,
            seat.y,
            i % 2 ? "bg-amber-300" : "bg-amber-500",
            i * 90
          );
        }
      }
    });
  }

  // Diff every socket snapshot in its own tick. Doing this in a render effect
  // loses events: two rapid broadcasts (our bet, the opponent's instant call)
  // are batched into a single render, so the intermediate bet frame vanishes.
  useEffect(() => {
    let last: GameType | null = null;
    return subscribeFx((snap) => {
      const prev = last;
      last = snap;

      // Bet / fold feedback within a live betting street (PreFlop..River).
      for (const ev of diffTableActions(prev, snap)) {
        const slot = seatSlot(snap.players, ev.position);
        if (slot === null) continue;
        const seat = seatXY(slot, maxPlayersRef.current);
        if (ev.kind === "bet") {
          // A short stream of chips flies from the bettor's seat to the pot,
          // with a "+amount" label popping above the seat.
          flyBetween(seat.x, seat.y, POT_X, POT_Y, "bg-amber-400", 0, 550);
          flyBetween(seat.x, seat.y, POT_X, POT_Y, "bg-amber-500", 140, 550);
          flyBetween(seat.x, seat.y, POT_X, POT_Y, "bg-amber-300", 280, 550);
          const id = fxSeq++;
          const done = window.setTimeout(() => dropTag(id), 900);
          setTags((t) => [
            ...t,
            { id, x: seat.x, y: seat.y, text: `+${ev.amount}`, tone: "action" },
          ]);
          window.setTimeout(() => window.clearTimeout(done), 1000);
        } else if (ev.kind === "fold") {
          const id = fxSeq++;
          const done = window.setTimeout(() => dropTag(id), 800);
          setTags((t) => [
            ...t,
            { id, x: seat.x, y: seat.y, text: "fold", tone: "fold" },
          ]);
          window.setTimeout(() => window.clearTimeout(done), 1000);
        }
      }

      // Pot collect when the Showdown window first opens with decided pots.
      if (snap.stage === 6 && (!prev || prev.stage !== 6)) {
        scheduleCollect(snap.pots ?? [], snap.players ?? []);
      }

      // Drop transient labels when a fresh hand starts.
      if (!snap.running && prev && prev.running) {
        setTags([]);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!game) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-visible">
      {flies.map((c) => (
        <FlyChip key={c.id} chip={c} onDone={dropChip} />
      ))}
      {tags.map((t) => (
        <div
          key={t.id}
          className={classNames(
            "animate-fx-tag absolute z-40 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-bold sm:text-sm",
            t.tone === "fold" && "bg-red-600 text-white",
            t.tone === "action" && "bg-amber-500 text-zinc-900",
            t.tone === "check" && "bg-zinc-600 text-neutral-200"
          )}
          style={{ left: `${t.x}%`, top: `${t.y - 14}%` }}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
