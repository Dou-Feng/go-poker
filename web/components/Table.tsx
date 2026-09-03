import Seat from "./Seat";
import Felt from "./Felt";
import { Game as GameType, Player } from "../interfaces";
import { AppContext } from "../providers/AppStore";
import { sendLog, dealGame, queueNext } from "../actions/actions";
import { useSocket } from "../hooks/useSocket";
import { useTranslation } from "../hooks/useTranslation";
import { useContext, useState, useEffect, useRef } from "react";

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
    const share = Math.floor(pot.amount / pot.winningPlayerNums.length);
    for (const num of pot.winningPlayerNums) {
      const player = game.players.find((p) => p.position === num);
      if (!player) {
        continue;
      }
      const existing = results.find(
        (r) => r.player.position === player.position
      );
      if (existing) {
        existing.amount += share;
      } else {
        results.push({ player, amount: share });
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
  if (game.stage === 1 && game.pots.length !== 0) {
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
  const [revealedPlayers, setRevealedPlayers] = useState<Player[]>([]);
  const [winners, setWinners] = useState<WinnerResult[]>([]);
  const [forfeited, setForfeited] = useState(false);
  const shownHandRef = useRef<string>("");
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

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
    // off while the board is still incomplete.
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
      // A new hand is in progress: clear the settlement result and timer.
      shownHandRef.current = "";
      setRevealedPlayers([]);
      setWinners([]);
      setForfeited(false);
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
      return;
    }
    if (game.stage !== 1) {
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
    setRevealedPlayers(getRevealedPlayers(game));
    setWinners(results);
    setForfeited(!!forfeitPot);
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
    dismissTimerRef.current = setTimeout(() => {
      dismissTimerRef.current = null;
      if (!mountedRef.current) {
        return;
      }
      setRevealedPlayers([]);
      setWinners([]);
      setForfeited(false);
      if (socket && isRunoutDriver) {
        dealGame(socket);
      }
    }, 5000);
  }, [game?.stage, game?.pots?.length]);

  // Track mounted state so a pending dismissal timer can no-op after unmount.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return (
    <div className="relative flex h-full w-full items-start justify-center">
      {(winners.length > 0 || forfeited) && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
          <div className="animate-winner-pop rounded-2xl border-2 border-amber-300 bg-zinc-900/90 px-8 py-4 text-center shadow-2xl">
            <p className="text-lg font-semibold text-neutral-300">
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
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{ width: "56%", height: "50%" }}
        >
          <Felt />
        </div>
        {game && (!appState.clientID || (me && !game.running && !me.ready)) && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
            <div className="pointer-events-auto flex flex-col items-center gap-1 rounded-lg bg-black/50 px-4 py-2 text-center">
              {!appState.clientID ? (
                game.running ? (
                  <button
                    onClick={() => socket && queueNext(socket)}
                    className={`text-sm font-medium sm:text-base ${
                      queued ? "text-amber-300" : "text-white hover:underline"
                    }`}
                  >
                    {queued ? t("queuedNextHand") : t("joinNextHand")}
                  </button>
                ) : (
                  <p className="text-sm font-medium text-white sm:text-base">
                    {t("pickSeat")}
                  </p>
                )
              ) : (
                <>
                  <p className="text-sm font-medium text-white sm:text-base">
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
          return (
            <div
              key={i}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: pos.left, top: pos.top }}
            >
              <Seat
                player={player}
                id={i + 1}
                visualId={visualIndex + 1}
                reveal={player ? revealedPlayers.includes(player) : false}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
