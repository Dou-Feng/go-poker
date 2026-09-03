import { useContext } from "react";
import { AppContext } from "../providers/AppStore";
import { Game, Player } from "../interfaces/index";
import Card from "./Card";
import Chip from "./Chip";
import classNames from "classnames";
import { useTranslation } from "../hooks/useTranslation";
import { useSocket } from "../hooks/useSocket";
import {
  toggleReady,
  takeSeat,
  sendLog,
  moveSeat,
  showHand,
} from "../actions/actions";
import Avatar from "./Avatar";

type seatProps = {
  player: Player | null;
  id: number;
  visualId?: number;
  reveal: boolean;
};

function chipPosition(id: number) {
  return classNames(
    {
      // The chip (bet amount / dealer) sits on the side of the seat that
      // faces the table center.
      "left-1/2 -translate-x-1/2 -top-6 flex-row": id === 1, // bottom
      "right-1 -top-9 flex-row": id === 2, // bottom-left
      "right-1 top-full mt-1 flex-col": id === 3, // top-left
      "left-1/2 -translate-x-1/2 top-full mt-1 flex-row": id === 4, // top
      "left-1 top-full mt-1 flex-row": id === 5, // top-right
      "left-1 -top-9 flex-row": id === 6, // bottom-right
    },
    "absolute flex items-center justify-start z-10"
  );
}

function active(player: Player, game: Game) {
  const action = player.position === game.action;
  // A player wins if they are awarded any pot, including side pots.
  const winner = (game.pots ?? []).some((pot) =>
    (pot.winningPlayerNums ?? []).includes(player.position)
  );
  return classNames(
    {
      // betting and player's turn
      "animate-active-pulse shadow-[0px_0px_40px_2px_rgba(255,255,255,255.3)] bg-neutral-100 text-zinc-900":
        action && game.betting,

      // betting and not player's turn
      "bg-zinc-900 text-neutral-100": !action && game.betting,

      // betting over and winner
      "shadow-[0px_0px_60px_20px_rgba(100,98,92,255.3)] bg-amber-200 text-zinc-900":
        winner && !game.betting,

      // betting over and not winner
      "bg-zinc-900 text-neutral-100 ": !winner && !game.betting,
    },

    "rounded-xl flex flex-row justify-start items-center z-2"
  );
}

export default function Seat({ player, id, visualId, reveal }: seatProps) {
  const { appState, dispatch } = useContext(AppContext);
  const socket = useSocket();
  const { t } = useTranslation();

  const game = appState.game;
  const running = game?.running ?? false;

  // Occupied seat.
  if (player && game) {
    const isMine = player.uuid === appState.clientID;
    const hidden = running && !isMine;
    const left = player.left;
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
    const handleClick = () => {
      if (
        isMine &&
        running &&
        player.in &&
        player.stack === 0 &&
        !player.revealed
      ) {
        if (socket) {
          showHand(socket);
        }
      } else if (isMine && !running) {
        if (player.stack === 0) {
          dispatch({
            type: "setAuthError",
            payload: "not enough chips to ready",
          });
          return;
        }
        if (socket) {
          toggleReady(socket);
        }
      } else if (!isMine) {
        openStats();
      }
    };
    return (
      <div className="relative">
        <div
          className={classNames(
            active(player, game),
            isMine || !running
              ? "m-1 h-16 w-32 sm:m-4 sm:h-20 sm:w-56"
              : "m-0.5 h-16 w-32 sm:m-2 sm:h-20 sm:w-44",
            left && "opacity-40 grayscale",
            "relative"
          )}
          onClick={handleClick}
          title={
            isMine &&
            running &&
            player.in &&
            player.stack === 0 &&
            !player.revealed
              ? t("showCards")
              : isMine
              ? t("ready")
              : t("viewRoomStats")
          }
          style={{ cursor: "pointer" }}
        >
          {running ? (
            <>
              <div className="flex flex-row items-center justify-center">
                {player.cards.map((c) => (
                  <div key={c} className="mx-0.5">
                    <Card
                      card={c}
                      placeholder={false}
                      folded={!player.in}
                      hidden={reveal || player.revealed ? false : hidden}
                    />
                  </div>
                ))}
              </div>
              <div className="flex flex-1 items-center justify-center">
                <Avatar
                  username={player.username}
                  emoji={player.avatar || "🙂"}
                  hasImage={player.avatarImage}
                  size={44}
                />
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-row items-center justify-center gap-2">
              <Avatar
                username={player.username}
                emoji={player.avatar || "🙂"}
                hasImage={player.avatarImage}
                size={44}
              />
              <div className="flex min-w-0 flex-col justify-center leading-tight">
                <p className="truncate text-base font-medium text-white sm:text-lg">
                  {player.username}
                </p>
                <div className="flex flex-row items-center gap-1">
                  <Chip className="h-4 w-4 sm:h-5 sm:w-5" />
                  <p className="font-mono text-base font-semibold text-amber-300 sm:text-lg">
                    {player.stack}
                  </p>
                </div>
              </div>
            </div>
          )}
          {!running && player.ready && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-black/50">
              <p className="text-base font-semibold text-white/90 sm:text-xl">
                {t("ready")}
              </p>
            </div>
          )}
        </div>
        {running &&
          (isMine && player.in && player.stack === 0 && !player.revealed ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (socket) {
                  showHand(socket);
                }
              }}
              className="mt-1 w-full rounded-sm bg-amber-600 py-1 text-xs font-bold text-white hover:bg-amber-500 sm:text-sm"
            >
              {t("showCards")}
            </button>
          ) : (
            <div className="mt-1 flex w-full flex-row items-center justify-between px-1 sm:px-2">
              <p className="truncate pr-1 text-base font-medium text-white sm:text-lg">
                {player.username}
              </p>
              <div className="flex flex-row items-center gap-1">
                <Chip className="h-4 w-4 sm:h-5 sm:w-5" />
                <p className="font-mono text-base font-semibold text-amber-300 sm:text-lg">
                  {player.stack}
                </p>
              </div>
            </div>
          ))}
        <div className={chipPosition(visualId ?? id)}>
          {running && game.dealer == player.position && (
            <div className="mx-0.5 my-0.5 flex h-5 w-6 items-center justify-center text-sm sm:mx-1 sm:my-1 sm:h-7 sm:w-8 sm:text-xl">
              🔔
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

  const me = game.players.find((p) => p.uuid === appState.clientID);
  const canMove = !!me && !me.ready && !running;
  const canSit = !appState.clientID || canMove;

  if (canSit) {
    const buyIn = game.config.buyIn ?? 200;
    const handleClick = () => {
      if (!socket) {
        return;
      }
      if (appState.clientID) {
        // Already seated but not ready: move to this seat.
        moveSeat(socket, id);
      } else if (appState.username) {
        if (appState.chips != null && appState.chips < buyIn) {
          dispatch({ type: "setAuthError", payload: "not enough chips" });
          return;
        }
        takeSeat(socket, appState.username, id, buyIn);
        sendLog(socket, appState.username + " buys in for " + buyIn);
      }
    };
    return (
      <div>
        <button
          className="m-1 h-16 w-32 rounded-2xl bg-neutral-700 p-2 text-neutral-100 sm:m-4 sm:h-20 sm:w-56"
          onClick={handleClick}
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
