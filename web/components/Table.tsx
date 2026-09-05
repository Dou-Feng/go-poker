import Seat, { useHandLabel } from "./Seat";
import Felt from "./Felt";
import Card from "./Card";
import TableFx from "./TableFx";
import classNames from "classnames";
import { Game as GameType, Player } from "../interfaces";
import { AppContext } from "../providers/AppStore";
import { sendLog, dealGame, queueNext } from "../actions/actions";
import { useSocket } from "../hooks/useSocket";
import { useTranslation } from "../hooks/useTranslation";
import { playSfx } from "../lib/sfx";
import { bestHandName } from "../lib/handEval";
import { useContext, useState, useEffect, useRef } from "react";

// The backend's GameStage enum values. 1..5 are NotReady, PreFlop..River;
// 6 is the Showdown window where the settled hand (winner/forfeit) is shown.
const Stage = {
  NotReady: 1,
  PreFlop: 2,
  Flop: 3,
  Turn: 4,
  River: 5,
  Showdown: 6,
  Terminal: 7,
} as const;

type WinnerResult = { player: Player; amount: number };

function seatPosition(
  index: number,
  total: number
): { left: string; top: string } {
  const angle = Math.PI / 2 + index * ((2 * Math.PI) / total);
  const rx = 34;
  const ry = 37;
  return {
    left: `${50 + rx * Math.cos(angle)}%`,
    top: `${50 + ry * Math.sin(angle)}%`,
  };
}

function getWinners(game: GameType): WinnerResult[] {
  // Aggregate each player's share across every pot that has been awarded,
  // including side pots with different winners.
  const results: WinnerResult[] = [];
  for (const pot of game.pots) {
    if (pot.amount === 0 || pot.winningPlayerNums.length === 0) {
      continue;
    }
    // Mirror the server's split: even shares, with any odd chips handed out
    // one each to the winners clockwise from the first seat after the button.
    const share = Math.floor(pot.amount / pot.winningPlayerNums.length);
    let remainder = pot.amount % pot.winningPlayerNums.length;
    const seats = game.players.length;
    const fromButton = (num: number) => (num - game.dealer - 1 + seats) % seats;
    const order = [...pot.winningPlayerNums].sort(
      (a, b) => fromButton(a) - fromButton(b)
    );
    for (const num of order) {
      let award = share;
      if (remainder > 0) {
        award++;
        remainder--;
      }
      const player = game.players.find((p) => p.position === num);
      if (!player) {
        continue;
      }
      const existing = results.find(
        (r) => r.player.position === player.position
      );
      if (existing) {
        existing.amount += award;
      } else {
        results.push({ player, amount: award });
      }
    }
  }
  return results;
}

function getForfeitPot(game: GameType) {
  // A settled pot with committed chips but no winners means the pot was
  // forfeited (a departing player with the best hand).
  for (const pot of game.pots) {
    if (pot.amount > 0 && pot.winningPlayerNums.length === 0) {
      return pot;
    }
  }
  return null;
}

function handleWinner(game: GameType | null, socket: WebSocket | null) {
  if (!game || !socket) {
    return;
  }
  if (game.stage === Stage.Showdown && game.pots.length !== 0) {
    for (const result of getWinners(game)) {
      sendLog(socket, result.player.username + " wins " + result.amount);
    }
  }
}

function getRevealedPlayers(game: GameType) {
  // Reveal every player eligible for any pot at showdown: side pots may have
  // different eligible players than the last pot.
  const eligible = new Set<number>();
  let contested = false;
  for (const pot of game.pots) {
    if (pot.eligiblePlayerNums.length > 1) {
      contested = true;
    }
    for (const num of pot.eligiblePlayerNums) {
      eligible.add(num);
    }
  }
  // If every pot was won uncontested (everyone else folded), do not reveal.
  if (!contested) {
    return [];
  }
  return game.players.filter((p) => eligible.has(p.position));
}

export default function Table() {
  const socket = useSocket();
  const { appState } = useContext(AppContext);
  const { t } = useTranslation();
  const game = appState.game;
  const me = game?.players.find((p) => p.uuid === appState.clientID);
  const queued = !me && !!game?.waiting.includes(appState.username ?? "");
  // Only one client drives the all-in runout (and the post-settlement deal).
  // Otherwise every seated/spectating client sends deal-game in the same
  // interval, flipping the turn + river + settlement almost at once and
  // making the river appear to be skipped.
  const runoutDriver = game?.players.find((p) => !p.left);
  const isRunoutDriver =
    !!me && !!runoutDriver && me.position === runoutDriver.position;
  const [revealedPositions, setRevealedPositions] = useState<number[]>([]);
  const [winners, setWinners] = useState<WinnerResult[]>([]);
  const [forfeited, setForfeited] = useState(false);
  const shownHandRef = useRef<string>("");
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const lastStageRef = useRef<number>(-1);

  // Board view popup: the felt is small on a phone and a neighbouring seat can
  // overlap the player's own hole cards, so the community cards (and the
  // player's hole cards when seated) can be shown enlarged in the centre.
  // Two ways to open it: hold a finger / the mouse button anywhere on the
  // table (shown while held; the delay keeps ordinary taps on seats and
  // buttons unaffected), or tap the felt itself to pin it open until the
  // next tap.
  const [peeking, setPeeking] = useState(false);
  const [pinned, setPinned] = useState(false);
  const peekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set when a hold produced the popup, so the click that follows the
  // release does not also toggle the pinned state.
  const heldRef = useRef(false);
  const myCards =
    !!game?.running && !!me && me.cards.length > 0 && me.cards[0] !== "?"
      ? me.cards
      : [];
  const canPeek = !!game?.running;
  // A hold that starts on an occupied seat enlarges that player's cards
  // instead of the board (face down until they are revealed, exactly as at
  // the table). The seat wrapper carries the player's position in a data
  // attribute so the pointer target can be resolved without extra handlers.
  const [peekSeat, setPeekSeat] = useState<number | null>(null);
  const startPeek = (e: React.PointerEvent<HTMLElement>) => {
    if (!canPeek || peekTimerRef.current) {
      return;
    }
    const target = e.target as HTMLElement | null;
    const seatEl = target?.closest?.(
      "[data-seat-position]"
    ) as HTMLElement | null;
    const seatPos = seatEl ? Number(seatEl.dataset.seatPosition) : NaN;
    heldRef.current = false;
    peekTimerRef.current = setTimeout(() => {
      peekTimerRef.current = null;
      heldRef.current = true;
      setPeekSeat(Number.isFinite(seatPos) ? seatPos : null);
      setPeeking(true);
    }, 220);
  };
  const peekPlayer =
    peeking && peekSeat !== null
      ? game?.players.find((p) => p.position === peekSeat) ?? null
      : null;
  const handLabel = useHandLabel();
  // Current best hand for the viewer's own cards, from whatever is visible
  // (2 hole cards preflop … 7 cards on the river). The server names hands
  // only at showdown; this fills the gap for the popup.
  const myBestHand =
    myCards.length > 0
      ? bestHandName([...myCards, ...(game?.communityCards ?? [])])
      : null;
  const endPeek = () => {
    if (peekTimerRef.current) {
      clearTimeout(peekTimerRef.current);
      peekTimerRef.current = null;
    }
    setPeeking(false);
    if (heldRef.current) {
      // The click event for this release (if the browser fires one) arrives
      // right after pointerup and is swallowed by the capture handler
      // below. Clear the flag shortly after so a hold that produced no
      // click cannot eat the next genuine tap.
      setTimeout(() => {
        heldRef.current = false;
      }, 300);
    }
  };
  // Capture-phase click filter: a click that ends a hold must not act as a
  // tap on whatever was under the finger (opening a seat's profile, pressing
  // ready, toggling the board view). Stopping it here, before it reaches the
  // target, covers every child without touching their handlers.
  const swallowClickAfterHold = (e: React.MouseEvent<HTMLElement>) => {
    if (heldRef.current) {
      heldRef.current = false;
      e.stopPropagation();
      e.preventDefault();
    }
  };
  const toggleBoardView = () => {
    if (heldRef.current) {
      heldRef.current = false;
      return;
    }
    if (canPeek) {
      setPinned((p) => !p);
    }
  };
  useEffect(() => {
    if (!canPeek) {
      endPeek();
      setPinned(false);
    }
  }, [canPeek]);
  const showBoardView = !!game && (peeking || pinned);

  const maxPlayers = game?.config.maxPlayers ?? 6;

  // Once the game is running, rotate the table so the current player's seat
  // sits at the bottom (map-style rotation), while preserving every other
  // player's relative position. Before the game starts, seats keep their
  // absolute positions for seat selection.
  const seatRotation =
    game?.running && me ? (me.seatID - 1 + maxPlayers) % maxPlayers : 0;

  // Number of revealed board cards: each flip changes this even though the
  // flop cards all share the same stage.
  const boardCount = game?.communityCards?.filter((c) => !!c).length ?? 0;

  // Map game players to their visual seats (seatID is 1-based).
  const seats: (Player | null)[] = new Array(maxPlayers).fill(null);
  for (const p of game?.players ?? []) {
    const idx = p.seatID - 1;
    if (idx >= 0 && idx < maxPlayers) {
      seats[idx] = p;
    }
  }

  useEffect(() => {
    // Reveal the board one card at a time during an all-in runout: betting is
    // off while the board is still incomplete. Each request reveals the next
    // street (flop → turn → river); the request after the river is complete
    // resolves the hand and enters the Showdown state (stage 6), at which
    // point `inRunout` becomes false and dealing stops automatically.
    if (!game || !socket || !isRunoutDriver) {
      return;
    }
    const inRunout =
      game.running && !game.betting && game.stage >= 2 && game.stage <= 5;
    if (!inRunout) {
      return;
    }
    const timer = setTimeout(() => {
      dealGame(socket);
    }, 900);
    return () => clearTimeout(timer);
  }, [
    game?.running,
    game?.betting,
    game?.stage,
    boardCount,
    isRunoutDriver,
    socket,
  ]);

  useEffect(() => {
    // this effect triggers when betting is over
    if (!game) {
      return;
    }
    if (game.pots.length === 0) {
      // The pots are only cleared when the next hand is dealt: from now on
      // the next hand is running. Reset the shown hand so it can be shown
      // again for the new hand's showdown.
      shownHandRef.current = "";
      return;
    }
    if (game.stage !== Stage.Showdown) {
      return;
    }
    const results = getWinners(game);
    const forfeitPot = results.length === 0 ? getForfeitPot(game) : null;
    if (results.length === 0 && !forfeitPot) {
      return;
    }
    const sig = forfeitPot
      ? "forfeit:" + forfeitPot.amount
      : results.map((r) => r.player.position + ":" + r.amount).join(",");
    if (shownHandRef.current === sig) {
      // Already showing this settled hand: leave the dismissal timer running.
      return;
    }
    shownHandRef.current = sig;
    setRevealedPositions(getRevealedPlayers(game).map((p) => p.position));
    setForfeited(!!forfeitPot);
    playSfx(forfeitPot ? "error" : "win");
    if (forfeitPot) {
      if (socket) {
        sendLog(socket, "chips forfeited");
      }
    } else {
      handleWinner(game, socket);
    }
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
    }
    // Showdown sequencing: the hand-type labels appear with the card reveal
    // first; the winner toast pops 1s later and stays 4s.
    toastTimerRef.current = setTimeout(() => {
      toastTimerRef.current = null;
      if (!mountedRef.current) {
        return;
      }
      setWinners(results);
    }, 1000);
    dismissTimerRef.current = setTimeout(() => {
      dismissTimerRef.current = null;
      if (!mountedRef.current) {
        return;
      }
      setRevealedPositions([]);
      setWinners([]);
      setForfeited(false);
      if (socket && isRunoutDriver) {
        dealGame(socket);
      }
    }, 5000);
  }, [game?.stage, game?.pots?.length]);

  // Deal sound: a new hand starts when the stage leaves NotReady into the
  // first betting street (PreFlop).
  useEffect(() => {
    const stage = game?.stage ?? -1;
    if (
      game?.running &&
      stage !== Stage.NotReady &&
      lastStageRef.current === Stage.NotReady
    ) {
      playSfx("deal");
    }
    lastStageRef.current = stage;
  }, [game?.running, game?.stage]);

  // Track mounted state so a pending dismissal timer can no-op after unmount.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return (
    <div
      className="relative flex h-full w-full select-none items-start justify-center"
      style={{ WebkitTouchCallout: "none" } as React.CSSProperties}
      onPointerDown={startPeek}
      onPointerUp={endPeek}
      onClickCapture={swallowClickAfterHold}
      onPointerCancel={endPeek}
      onPointerLeave={endPeek}
      onContextMenu={(e) => {
        // A long press must not open the browser's context menu on phones.
        if (canPeek) {
          e.preventDefault();
        }
      }}
    >
      {showBoardView && game && (
        <div
          className={classNames(
            // Anchored to the top of the table, not the centre: the finger
            // that is holding the table would otherwise cover the popup.
            // Below the room's top toolbars (leave/vote row, hands pill,
            // wallet column) so it never overlaps them; it may cover the
            // top seats, which is fine for a transient popup.
            "absolute inset-x-0 top-28 z-40 flex items-start justify-center sm:top-24",
            // While held the popup is see-through to pointer events so the
            // release is always caught by the table; when pinned, a tap on
            // it closes it.
            pinned ? "pointer-events-auto" : "pointer-events-none"
          )}
          onClick={() => setPinned(false)}
        >
          {peekPlayer ? (
            // Held on a seat: that player's cards, large. Hidden unless the
            // viewer owns them or they are shown down / voluntarily revealed
            // — the server never sends the real values otherwise.
            <div className="animate-fade-in flex flex-col items-center gap-2 rounded-2xl border border-amber-300/60 bg-black/75 px-5 py-3 shadow-2xl sm:px-6 sm:py-4">
              <p className="max-w-[16rem] truncate text-base font-semibold text-ink sm:text-lg">
                {peekPlayer.username}
              </p>
              <div className="flex flex-row items-center">
                {(peekPlayer.cards.length > 0
                  ? peekPlayer.cards
                  : ["?", "?"]
                ).map((c, i) => {
                  const isMineCard = peekPlayer.uuid === appState.clientID;
                  const shown =
                    isMineCard ||
                    peekPlayer.revealed ||
                    revealedPositions.includes(peekPlayer.position);
                  return (
                    <div
                      key={`seatpeek-${i}-${c}`}
                      className="origin-center scale-[1.75] sm:scale-125"
                      style={{ margin: "22px 16px" }}
                    >
                      <Card
                        card={c}
                        placeholder={false}
                        folded={!peekPlayer.in}
                        hidden={!shown}
                      />
                    </div>
                  );
                })}
              </div>
              {peekPlayer.uuid === appState.clientID && myBestHand ? (
                // Own seat: live evaluation of the current hand.
                <p className="text-sm font-semibold text-amber-300">
                  {handLabel(myBestHand)}
                </p>
              ) : (
                peekPlayer.bestHand &&
                (peekPlayer.revealed ||
                  revealedPositions.includes(peekPlayer.position)) && (
                  <p className="text-sm font-semibold text-amber-300">
                    {handLabel(peekPlayer.bestHand)}
                  </p>
                )
              )}
            </div>
          ) : (
            <div className="animate-fade-in flex flex-col items-center gap-2 rounded-2xl border border-amber-300/60 bg-black/75 px-4 py-3 shadow-2xl sm:px-6 sm:py-4">
              {/* Community cards: five slots, placeholders for undealt streets. */}
              <div className="flex flex-row items-center">
                {[0, 1, 2, 3, 4].map((n) => {
                  const c = game.communityCards[n];
                  return (
                    <div
                      key={`board-${n}-${c ?? "x"}`}
                      className="origin-center scale-150 sm:scale-125"
                      style={{ margin: "14px 11px" }}
                    >
                      <Card
                        card={c || "placeholder"}
                        placeholder={!c}
                        folded={false}
                        hidden={false}
                      />
                    </div>
                  );
                })}
              </div>
              {myCards.length > 0 && me && (
                <div className="flex flex-col items-center border-t border-amber-300/30 pt-2">
                  <div className="flex flex-row items-center">
                    {myCards.map((c, i) => (
                      <div
                        key={`peek-${i}-${c}`}
                        className="origin-center scale-[1.75] sm:scale-125"
                        style={{ margin: "22px 16px" }}
                      >
                        <Card
                          card={c}
                          placeholder={false}
                          folded={!me.in}
                          hidden={false}
                        />
                      </div>
                    ))}
                  </div>
                  {myBestHand && (
                    <p className="text-sm font-semibold text-amber-300">
                      {handLabel(myBestHand)}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {/* Showdown toast at the bottom of the screen (above the chat tabs;
          the action bar is hidden while betting is over), leaving the
          revealed cards and hand labels on the table unobstructed. */}
      {(winners.length > 0 || forfeited) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-14 z-30 flex items-end justify-center px-2 sm:bottom-20">
          <div className="animate-winner-pop rounded-2xl border-2 border-amber-300 bg-tablehi/90 px-8 py-4 text-center shadow-2xl">
            <p className="type-heading">
              {forfeited ? t("chipsForfeited") : t("winner")}
            </p>
            {winners.map((w) => (
              <p
                key={w.player.position}
                className="text-3xl font-bold text-amber-300"
              >
                {w.player.username} +{w.amount}
              </p>
            ))}
          </div>
        </div>
      )}
      <div className="relative mt-10 h-2/3 w-full max-w-screen-xl sm:mt-28 sm:h-3/5">
        <div
          className={classNames(
            "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
            canPeek && "cursor-pointer"
          )}
          style={{ width: "56%", height: "50%" }}
          onClick={toggleBoardView}
          role={canPeek ? "button" : undefined}
          aria-label={canPeek ? t("boardView") : undefined}
        >
          <Felt />
        </div>
        {game && <TableFx game={game} maxPlayers={maxPlayers} />}
        {game && (!appState.clientID || (me && !game.running && !me.ready)) && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
            <div className="pointer-events-auto flex flex-col items-center gap-1 rounded-lg bg-black/50 px-4 py-2 text-center">
              {!appState.clientID ? (
                game.running ? (
                  <button
                    onClick={() => socket && queueNext(socket)}
                    className={`text-sm font-medium sm:text-base ${
                      queued ? "text-amber-300" : "text-ink hover:underline"
                    }`}
                  >
                    {queued ? t("queuedNextHand") : t("joinNextHand")}
                  </button>
                ) : (
                  <p className="text-sm font-medium text-ink sm:text-base">
                    {t("pickSeat")}
                  </p>
                )
              ) : (
                <>
                  <p className="text-sm font-medium text-ink sm:text-base">
                    {t("clickReadyButton")}
                  </p>
                </>
              )}
            </div>
          </div>
        )}
        {seats.map((player, i) => {
          const visualIndex = (i - seatRotation + maxPlayers) % maxPlayers;
          const pos = seatPosition(visualIndex, maxPlayers);
          // The player's own seat is stacked above the neighbours so its
          // hole cards are never hidden by an overlapping seat on narrow
          // screens.
          const isMine = !!player && player.uuid === appState.clientID;
          // Once a hand is running the other players' seats are drawn a
          // little smaller (their cards are face down anyway), leaving more
          // room for the board and the player's own seat. Scaling about the
          // centre keeps the seat anchored where TableFx expects it.
          const shrink = !!game?.running && !!player && !isMine;
          return (
            <div
              key={i}
              className={classNames(
                "absolute -translate-x-1/2 -translate-y-1/2 transition-transform duration-300",
                isMine && "z-10",
                shrink && "scale-[0.82] sm:scale-90"
              )}
              style={{ left: pos.left, top: pos.top }}
              data-seat-position={player ? player.position : undefined}
            >
              <Seat
                player={player}
                id={i + 1}
                visualId={visualIndex + 1}
                reveal={
                  player ? revealedPositions.includes(player.position) : false
                }
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
