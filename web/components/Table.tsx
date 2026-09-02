import Seat from "./Seat";
import Felt from "./Felt";
import { Game as GameType, Player } from "../interfaces";
import { AppContext } from "../providers/AppStore";
import { sendLog, dealGame } from "../actions/actions";
import { useSocket } from "../hooks/useSocket";
import { useTranslation } from "../hooks/useTranslation";
import { useContext, useState, useEffect, useRef } from "react";

type WinnerResult = { player: Player; amount: number };

function seatPosition(
  index: number,
  total: number
): { left: string; top: string } {
  const angle = Math.PI / 2 + index * ((2 * Math.PI) / total);
  const rx = 42;
  const ry = 40;
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
  const [revealedPlayers, setRevealedPlayers] = useState<Player[]>([]);
  const [winners, setWinners] = useState<WinnerResult[]>([]);
  const shownHandRef = useRef<string>("");

  const maxPlayers = game?.config.maxPlayers ?? 6;

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
    if (!game || !socket) {
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
  }, [game?.running, game?.betting, game?.stage, socket]);

  useEffect(() => {
    // this effect triggers when betting is over
    if (!game) {
      return;
    }
    if (game.pots.length === 0) {
      // A new hand is in progress: reset the result marker.
      shownHandRef.current = "";
      return;
    }
    if (game.stage !== 1) {
      return;
    }
    const results = getWinners(game);
    if (results.length === 0) {
      return;
    }
    const sig = results
      .map((r) => r.player.position + ":" + r.amount)
      .join(",");
    if (shownHandRef.current === sig) {
      // Already shown for this settled hand (e.g. a failed deal).
      return;
    }
    shownHandRef.current = sig;
    setRevealedPlayers(getRevealedPlayers(game));
    setWinners(results);
    handleWinner(game, socket);
    const timer = setTimeout(() => {
      setRevealedPlayers([]);
      setWinners([]);
      if (socket) {
        dealGame(socket);
      }
    }, 5000);
    return () => {
      clearTimeout(timer);
    };
  }, [game?.pots]);

  return (
    <div className="relative flex h-full w-full items-start justify-center">
      {winners.length > 0 && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
          <div className="animate-winner-pop rounded-2xl border-2 border-amber-300 bg-zinc-900/90 px-8 py-4 text-center shadow-2xl">
            <p className="text-lg font-semibold text-neutral-300">
              {t("winner")}
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
      <div className="relative mt-2 h-2/3 w-full max-w-screen-xl sm:mt-28 sm:h-3/5">
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{ width: "56%", height: "50%" }}
        >
          <Felt />
        </div>
        {seats.map((player, i) => {
          const pos = seatPosition(i, maxPlayers);
          return (
            <div
              key={i}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: pos.left, top: pos.top }}
            >
              <Seat
                player={player}
                id={i + 1}
                reveal={player ? revealedPlayers.includes(player) : false}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
