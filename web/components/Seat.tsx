import { useContext } from "react";
import { AppContext } from "../providers/AppStore";
import { Game, Player } from "../interfaces/index";
import Card from "./Card";
import BuyIn from "./BuyIn";
import classNames from "classnames";
import { useTranslation } from "../hooks/useTranslation";
import Avatar from "./Avatar";

type seatProps = {
    player: Player | null;
    id: number;
    reveal: boolean;
    selected: boolean;
    onSelect: () => void;
};

function chipPosition(id: number) {
    return classNames(
        {
            "right-[60%] top-[-45%] flex-row": id === 1,
            "right-[30%] top-[-40%] flex-row": id === 2,
            "right-[-20%] top-[20%] flex-col": id === 3,
            "right-[30%] bottom-[-40%] flex-row": id === 4,
            "right-[60%] bottom-[-40%] flex-row": id === 5,
            "left-[-23%] top-[15%] flex-col": id === 6,
        },
        "absolute flex items-center justify-start z-10"
    );
}

function active(player: Player, game: Game) {
    const action = player.position === game.action;
    const winner = player.position == game?.pots[game.pots.length - 1]?.winningPlayerNums[0];
    return classNames(
        {
            // betting and player's turn
            "shadow-[0px_0px_40px_2px_rgba(255,255,255,255.3)] bg-neutral-100 text-zinc-900 animate-seat-glow":
                action && game.betting,

            // betting and not player's turn
            "bg-zinc-900 text-neutral-100": !action && game.betting,

            // betting over and winner
            "shadow-[0px_0px_60px_20px_rgba(100,98,92,255.3)] bg-amber-200 text-zinc-900":
                winner && !game.betting,

            // betting over and not winner
            "bg-zinc-900 text-neutral-100 ": !winner && !game.betting,
        },

        "rounded-xl m-1 sm:m-4 h-16 w-32 sm:h-20 sm:w-56 flex flex-row justify-start items-center z-2"
    );
}

export default function Seat({ player, id, reveal, selected, onSelect }: seatProps) {
    const { appState, dispatch } = useContext(AppContext);
    const { t } = useTranslation();

    const game = appState.game;
    const running = game?.running ?? false;

    // Occupied seat.
    if (player && game) {
        const hidden = running && appState.clientID !== player.uuid;
        const openStats = () => {
            dispatch({
                type: "setProfile",
                payload: {
                    username: player.username,
                    avatar: player.avatar || "🙂",
                    avatarImage: player.avatarImage,
                    chips: player.stack,
                    friends: [],
                    stats: player.stats,
                },
            });
        };
        return (
            <div className="relative">
                <div
                    className={active(player, game)}
                    onClick={openStats}
                    title={t("viewRoomStats")}
                    style={{ cursor: "pointer" }}
                >
                    <div className="relative right-1 sm:right-2 flex flex-row items-center justify-center">
                        {player.cards.map((c, i) => (
                            <div key={i} className="mx-0.5">
                                <Card
                                    card={c}
                                    placeholder={false}
                                    folded={!player.in}
                                    hidden={reveal ? false : hidden}
                                />
                            </div>
                        ))}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-row items-center rounded-md px-1.5 py-0.5">
                        <div className="flex w-1/2 items-center justify-center">
                            <Avatar
                                username={player.username}
                                emoji={player.avatar || "🙂"}
                                hasImage={player.avatarImage}
                                size={44}
                            />
                        </div>
                        <div className="flex w-1/2 min-w-0 flex-col justify-center leading-tight">
                            <p className="truncate text-sm font-normal sm:text-base">
                                {player.username}
                            </p>
                            <p className="text-sm font-semibold sm:text-base">{player.stack}</p>
                        </div>
                    </div>
                </div>
                <div className={chipPosition(id)}>
                    {running && game.dealer == player.position && (
                        <div className="mx-1 my-1 flex h-5 w-6 items-center justify-center rounded-[50%] bg-white text-sm font-bold text-purple-800 sm:mx-3 sm:my-3 sm:h-7 sm:w-8 sm:text-xl">
                            D
                        </div>
                    )}
                    {player.bet !== 0 && (
                        <p
                            key={player.bet}
                            className="animate-chip-pop flex h-6 w-9 items-center justify-center rounded-3xl bg-amber-300 text-sm font-semibold text-zinc-900 sm:h-8 sm:w-12 sm:text-xl"
                        >
                            {player.bet}
                        </p>
                    )}
                </div>
            </div>
        );
    }

    // Empty seat. Only interactive once the game is loaded and not running.
    if (!game || running) {
        return (
            <div>
                <button className="m-1 h-16 w-32 rounded-2xl bg-neutral-700 p-2 text-neutral-400 opacity-20 sm:m-4 sm:h-20 sm:w-56">
                    <h2 className="text-3xl sm:text-4xl">{id}</h2>
                </button>
            </div>
        );
    }

    const canSit = !appState.clientID;

    if (canSit && selected) {
        return (
            <div>
                <div className="m-1 h-16 w-32 rounded-2xl bg-neutral-700 text-neutral-100 sm:m-4 sm:h-20 sm:w-56">
                    <BuyIn seatID={id} onClose={onSelect} />
                </div>
            </div>
        );
    }

    if (canSit) {
        return (
            <div>
                <button
                    className="m-1 h-16 w-32 rounded-2xl bg-neutral-700 p-2 text-neutral-100 sm:m-4 sm:h-20 sm:w-56"
                    onClick={onSelect}
                >
                    <h2 className="text-3xl sm:text-4xl">{id}</h2>
                    <p className="text-xs opacity-70 sm:text-base">{t("open")}</p>
                </button>
            </div>
        );
    }

    return (
        <div>
            <button className="m-1 h-16 w-32 rounded-2xl bg-neutral-700 p-2 text-neutral-400 opacity-20 sm:m-4 sm:h-20 sm:w-56">
                <h2 className="text-3xl sm:text-4xl">{id}</h2>
            </button>
        </div>
    );
}
