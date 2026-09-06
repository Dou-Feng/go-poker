import { useContext, useEffect, useRef, useState } from "react";
import { Game as GameType } from "../interfaces";
import { AppContext } from "../providers/AppStore";
import { diffTableActions } from "../lib/tableFx";
import { subscribeFx } from "../lib/fxBus";
import { getSfxDurationMs, playSfx } from "../lib/sfx";
import Chip, { ChipTone, chipToneFor } from "./Chip";

import { TableLayout, tableSeatPoint } from "../lib/tableLayout";

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

let fxSeq = 1;

// One flying chip: mounts at the start point, then transitions to the end.
function FlyChip({
  chip,
  size,
  onDone,
}: {
  chip: FlySpec;
  size: number;
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

  // The flying piece is the game's chip, coloured by the amount in play
  // (`chip.color` carries the denomination tone), spinning slightly as it
  // travels; alternate chips spin the other way.
  const spin = chip.id % 2 ? 160 : -160;
  return (
    <div
      className="poker-flying-chip absolute drop-shadow-md"
      style={{
        width: size,
        height: size,
        left: `${phase === "start" ? chip.x1 : chip.x2}%`,
        top: `${phase === "start" ? chip.y1 : chip.y2}%`,
        transform: `translate(-50%, -50%) rotate(${
          phase === "end" ? spin : 0
        }deg)`,
        transition: `left ${chip.ms}ms ease-in, top ${chip.ms}ms ease-in, transform ${chip.ms}ms linear`,
        opacity: phase === "end" ? 0.95 : 0.2,
      }}
    >
      <Chip className="h-full w-full" tone={chip.color as ChipTone} />
    </div>
  );
}

type props = {
  game: GameType;
  maxPlayers: number;
  layout: TableLayout;
};

export default function TableFx({ game, maxPlayers, layout }: props) {
  const { appState } = useContext(AppContext);
  const me = game?.players.find((p) => p.uuid === appState.clientID);
  const rotation = game.running && me ? me.seatID - 1 : 0;
  // The seat uuid of the viewer ("" for a spectator): opponent sounds are
  // skipped on their own actions, since the acting player already hears
  // them from the action bar.
  const heroUuidRef = useRef(appState.clientID);
  heroUuidRef.current = appState.clientID;

  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const [flies, setFlies] = useState<FlySpec[]>([]);
  // A rotation/resize changes the anchors: discard chips already in flight.
  useEffect(() => setFlies([]), [layout.width, layout.height, rotation]);
  // The rotation can settle after the seat is known; read the live value from
  // a ref inside the socket-driven callback instead of a stale closure.
  const rotationRef = useRef(rotation);
  rotationRef.current = rotation;
  const maxPlayersRef = useRef(maxPlayers);
  maxPlayersRef.current = maxPlayers;

  const dropChip = (id: number) =>
    setFlies((f) => f.filter((c) => c.id !== id));

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
        const seat = tableSeatPoint(
          layoutRef.current,
          slot,
          maxPlayersRef.current
        );
        // A few chips stream from the pot to each winner, coloured by the
        // size of the pot they carry.
        const tone = chipToneFor(pot.amount);
        for (let i = 0; i < 4; i++) {
          flyBetween(
            layoutRef.current.pot.x +
              (((Math.random() - 0.5) * 24) / layoutRef.current.width) * 100,
            layoutRef.current.pot.y +
              (((Math.random() - 0.5) * 12) / layoutRef.current.height) * 100,
            seat.x,
            seat.y,
            tone,
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
    // The snapshot that mounted the table was emitted before this effect
    // subscribed. Seed it here so the very first subsequent bet animates.
    let last: GameType | null = game;
    let collectTimer: number | undefined;
    let disposed = false;
    const unsubscribe = subscribeFx((snap) => {
      const prev = last;
      last = snap;
      const events = diffTableActions(prev, snap);

      // Opponent-action sounds: everyone except the acting player hears a
      // call/raise (otherBet), an all-in (allin) or a fold (card drop) here,
      // from the same snapshot diff that drives the chip animations. The
      // acting player already heard their own key from the action bar, so
      // their seat is skipped. Sound is not gated by prefers-reduced-motion:
      // that setting only suppresses the animations below.
      const heroPos = snap.players.find(
        (p) => p.uuid === heroUuidRef.current
      )?.position;
      for (const ev of events) {
        if (ev.position === heroPos) {
          continue; // own action: already heard from the action bar
        }
        if (ev.kind === "check") {
          playSfx("check");
          continue;
        }
        if (ev.kind === "fold") {
          playSfx("fold");
          continue;
        }
        const actor = snap.players.find((p) => p.position === ev.position);
        const allIn = !!actor && actor.in && actor.stack === 0;
        playSfx(allIn ? "allin" : "otherBet");
      }

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      // Bet feedback within a live betting street (PreFlop..River).
      let betAnimated = false;
      for (const ev of events) {
        const slot = seatSlot(snap.players, ev.position);
        if (slot === null) continue;
        const seat = tableSeatPoint(
          layoutRef.current,
          slot,
          maxPlayersRef.current
        );
        if (ev.kind === "bet") {
          // A short stream of chips flies from the bettor's seat to the pot.
          // No "+amount" tag: the seat's own bet pill already shows the
          // number, so the tag was just noise over the cards.
          betAnimated = true;
          const tone = chipToneFor(ev.amount);
          flyBetween(
            seat.x,
            seat.y,
            layoutRef.current.pot.x,
            layoutRef.current.pot.y,
            tone,
            0,
            550
          );
          flyBetween(
            seat.x,
            seat.y,
            layoutRef.current.pot.x,
            layoutRef.current.pot.y,
            tone,
            140,
            550
          );
          flyBetween(
            seat.x,
            seat.y,
            layoutRef.current.pot.x,
            layoutRef.current.pot.y,
            tone,
            280,
            550
          );
        }
      }

      // Pot collect when the Showdown window first opens with decided pots.
      // If the showdown flips revealed hands open, the reveal sound plays
      // first: wait for it to finish, then stream the pot to the winners in
      // sync with the win chime (Table.tsx schedules that sound on the same
      // timing). Without a reveal the collect starts at once - or 700 ms
      // later when a call that closed the river landed in the same snapshot,
      // so its chips can reach the pot before it streams back out.
      if (snap.stage === 6 && (!prev || prev.stage !== 6)) {
        const pots = snap.pots ?? [];
        const players = snap.players ?? [];
        const willReveal = pots.some(
          (pot) => (pot.eligiblePlayerNums?.length ?? 0) > 1
        );
        if (willReveal) {
          void getSfxDurationMs("showcardAll").then((ms) => {
            if (disposed) {
              return;
            }
            // Wait out the reveal sound before streaming the pot to the
            // winners (same floor as the win chime in Table.tsx, so the two
            // start together only after the reveal has finished).
            collectTimer = window.setTimeout(
              () => scheduleCollect(pots, players),
              Math.max(ms, 700)
            );
          });
        } else if (betAnimated) {
          collectTimer = window.setTimeout(
            () => scheduleCollect(pots, players),
            700
          );
        } else {
          scheduleCollect(pots, players);
        }
      }
    });
    return () => {
      unsubscribe();
      disposed = true;
      window.clearTimeout(collectTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!game) return null;

  return (
    <div className="poker-table-effects pointer-events-none absolute inset-0 z-30 overflow-visible">
      {flies.map((c) => (
        <FlyChip
          key={c.id}
          chip={c}
          size={Math.max(
            10,
            Math.min(22, layout.scale * (layout.large ? 24 : 20))
          )}
          onDone={dropChip}
        />
      ))}
    </div>
  );
}
