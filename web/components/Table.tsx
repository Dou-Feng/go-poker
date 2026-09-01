import Seat from "./Seat";
import Felt from "./Felt";
import { Game as GameType, Player } from "../interfaces";
import { AppContext } from "../providers/AppStore";
import { sendLog, dealGame } from "../actions/actions";
import { useSocket } from "../hooks/useSocket";
import { useTranslation } from "../hooks/useTranslation";
import { useContext, useState, useEffect } from "react";

function seatPosition(index: number, total: number): { left: string; top: string } {
    const angle = Math.PI / 2 + index * ((2 * Math.PI) / total);
    const rx = 42;
    const ry = 40;
    return {
        left: `${50 + rx * Math.cos(angle)}%`,
        top: `${50 + ry * Math.sin(angle)}%`,
    };
}

function getWinner(game: GameType): Player | null {
    const lastPot = game.pots[game.pots.length - 1];
    if (!lastPot || lastPot.winningPlayerNums.length === 0) {
        return null;
    }
    const winnerNum = lastPot.winningPlayerNums[0];
    const winningPlayer = game.players.find((player) => player.position == winnerNum);
    return winningPlayer ?? null;
}

function handleWinner(game: GameType | null, socket: WebSocket | null) {
    if (!game || !socket) {
        return;
    }
    if (game.stage === 1 && game.pots.length !== 0) {
        const winningPlayer = getWinner(game);
        if (!winningPlayer) {
            return;
        }
        const pot = game.pots[game.pots.length - 1].amount;
        const message = winningPlayer.username + " wins " + pot;
        sendLog(socket, message);
    }
}

function getRevealedPlayers(game: GameType) {
    const lastPot = game.pots[game.pots.length - 1];
    if (!lastPot) {
        return [];
    }
    const revealedNums = lastPot.eligiblePlayerNums;
    // if only one player was eligible for the pot (everyone else folded), then they do not have to reveal
    if (revealedNums.length <= 1) {
        return [];
    }
    const revealedPlayers = game.players.filter((player) => revealedNums.includes(player.position));
    return revealedPlayers;
}

export default function Table() {
    const socket = useSocket();
    const { appState } = useContext(AppContext);
    const { t } = useTranslation();
    const game = appState.game;
    const [revealedPlayers, setRevealedPlayers] = useState<Player[]>([]);
    const [winner, setWinner] = useState<Player | null>(null);
    const [selectedSeat, setSelectedSeat] = useState<number | null>(null);

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
        // this effect triggers when betting is over
        if (game && game.stage === 1 && game.pots.length !== 0) {
            setRevealedPlayers(getRevealedPlayers(game));
            setWinner(getWinner(game));
            handleWinner(game, socket);
            const timer = setTimeout(() => {
                setRevealedPlayers([]);
                setWinner(null);
                if (socket) {
                    dealGame(socket);
                }
            }, 5000);
            return () => {
                clearTimeout(timer);
            };
        }
    }, [game?.pots]);

    return (
        <div className="relative flex h-full w-full items-start justify-center">
            {winner && (
                <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
                    <div className="animate-winner-pop rounded-2xl border-2 border-amber-300 bg-zinc-900/90 px-8 py-4 text-center shadow-2xl">
                        <p className="text-lg font-semibold text-neutral-300">{t("winner")}</p>
                        <p className="text-3xl font-bold text-amber-300">
                            {winner.username} +{game ? game.pots[game.pots.length - 1]?.amount : 0}
                        </p>
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
                                selected={selectedSeat === i + 1}
                                onSelect={() =>
                                    setSelectedSeat((prev) => (prev === i + 1 ? null : i + 1))
                                }
                            />
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
