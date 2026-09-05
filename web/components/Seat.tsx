import { useContext } from "react";
import { AppContext } from "../providers/AppStore";
import { Game, Player } from "../interfaces/index";
import Card from "./Card";
import Chip from "./Chip";
import classNames from "classnames";
import { useTranslation } from "../hooks/useTranslation";
import { TranslationKey } from "../lib/translations";
import { useSocket } from "../hooks/useSocket";
import {
  toggleReady,
  takeSeat,
  sendLog,
  moveSeat,
  showHand,
  addBot,
  removeBot,
} from "../actions/actions";
import Avatar from "./Avatar";
import PlusIcon from "./PlusIcon";
import MicIcon from "./MicIcon";
import { useVoice } from "../hooks/useVoice";

type seatProps = {
  player: Player | null;
  id: number;
  visualId?: number;
  reveal: boolean;
};

// Localized name for a showdown hand category ("full house" etc).
const HAND_KEYS: Record<string, TranslationKey> = {
  "royal flush": "hand_royal_flush",
  "straight flush": "hand_straight_flush",
  "four of a kind": "hand_four_of_a_kind",
  "full house": "hand_full_house",
  flush: "hand_flush",
  straight: "hand_straight",
  "three of a kind": "hand_three_of_a_kind",
  "two pair": "hand_two_pair",
  "one pair": "hand_one_pair",
  "high card": "hand_high_card",
};

export function useHandLabel() {
  const { t } = useTranslation();
  return (hand: string) => {
    const key = HAND_KEYS[hand];
    return key ? t(key) : hand;
  };
}

function chipPosition(id: number) {
  return classNames(
    {
      // The dealer button and the showdown hand label sit on the side of the
      // seat that faces the table center (the bet amount sits under the seat).
      "left-1/2 -translate-x-1/2 -top-9 flex-row": id === 1, // bottom
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
      "animate-active-pulse shadow-[0px_0px_40px_2px_rgba(255,255,255,255.3)] bg-ink text-brand":
        action && game.betting,

      // betting and not player's turn
      "bg-tablehi text-ink": !action && game.betting,

      // betting over and winner
      "shadow-[0px_0px_60px_20px_rgba(100,98,92,255.3)] bg-amber-200 text-brand":
        winner && !game.betting,

      // betting over and not winner
      "bg-tablehi text-ink ": !winner && !game.betting,
    },

    "rounded-xl border border-muted/30 flex flex-row justify-start items-center z-2"
  );
}

export default function Seat({ player, id, visualId, reveal }: seatProps) {
  const { appState, dispatch } = useContext(AppContext);
  const socket = useSocket();
  const { t } = useTranslation();
  const handLabel = useHandLabel();
  const voiceState = useVoice();

  const game = appState.game;
  const running = game?.running ?? false;
  // Bot placement mode (host only, between hands): empty seats become "+"
  // to add a bot there, seated bots become removable.
  const isHost = !!game && !!appState.uuid && game.host === appState.uuid;
  const botMode = appState.botMode && isHost && !running;

  // Occupied seat.
  if (player && game) {
    const isMine = player.uuid === appState.clientID;
    const hidden = running && !isMine;
    const left = player.left;
    const isBot = !!player.bot;
    const removable = botMode && isBot;
    // Live-mic badge: our own toggle, or what the peer announced over voice.
    const micLive = isMine
      ? voiceState.micOn
      : !!voiceState.peers[player.accountUuid]?.mic;
    const micMuted =
      !isMine && voiceState.mutedPeers.includes(player.accountUuid);
    const openStats = () => {
      dispatch({
        type: "setProfile",
        payload: {
          uuid: isMine ? appState.uuid ?? "" : player.accountUuid ?? "",
          username: player.username,
          avatar: isMine
            ? appState.avatar || player.avatar || "🙂"
            : player.avatar || "🙂",
          avatarImage: isMine ? appState.avatarImage : player.avatarImage,
          chips: isMine ? appState.chips ?? player.stack : player.stack,
          friends: isMine ? appState.friends ?? [] : [],
          stats: isMine ? appState.stats ?? player.stats : player.stats,
        },
      });
    };
    const handleClick = () => {
      if (removable) {
        if (socket) {
          removeBot(socket, player.uuid);
        }
        return;
      }
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
      } else {
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
            removable && "ring-2 ring-rose-500",
            "relative"
          )}
          onClick={handleClick}
          title={
            removable
              ? t("removeBot")
              : isMine &&
                running &&
                player.in &&
                player.stack === 0 &&
                !player.revealed
              ? t("showCards")
              : t("viewRoomStats")
          }
          style={{ cursor: "pointer" }}
        >
          {running ? (
            <>
              <div className="flex flex-row items-center justify-center">
                {player.cards.map((c, i) => (
                  <div key={`${i}-${c}`} className="mx-0.5">
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
                  uuid={player.accountUuid}
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
                uuid={player.accountUuid}
                emoji={player.avatar || "🙂"}
                hasImage={player.avatarImage}
                size={44}
              />
              <div className="flex min-w-0 flex-col justify-center leading-tight">
                <p className="truncate text-base font-medium text-ink sm:text-lg">
                  {player.username}
                </p>
                <div className="flex flex-row items-center gap-1">
                  <Chip
                    className="h-4 w-4 sm:h-5 sm:w-5"
                    amount={player.stack}
                  />
                  <p className="type-num text-base text-amber-300 sm:text-lg">
                    {player.stack}
                  </p>
                </div>
              </div>
            </div>
          )}
          {!running && player.ready && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-black/50">
              <p className="text-base font-semibold text-ink/90 sm:text-xl">
                {t("ready")}
              </p>
            </div>
          )}
          {removable && (
            <span
              className="absolute -left-1.5 -top-1.5 z-20 flex h-5 w-5 items-center justify-center rounded-full bg-rose-600 text-xs font-bold text-ink shadow"
              aria-hidden
            >
              ✕
            </span>
          )}
          {(micLive || micMuted) && (
            <span
              className={classNames(
                "absolute -right-1.5 -top-1.5 z-20 flex h-5 w-5 items-center justify-center rounded-full border border-brand/40 shadow",
                micMuted ? "bg-rose-600 text-ink" : "bg-emerald-600 text-ink"
              )}
              title={micMuted ? t("muteMicFor") : t("micOn")}
            >
              <MicIcon off={micMuted} className="h-3 w-3" />
            </span>
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
              className="btn btn-accent mt-1 w-full py-1 text-xs font-bold sm:text-sm"
            >
              {t("showCards")}
            </button>
          ) : (
            <div className="mt-1 flex w-full flex-row items-center justify-between px-1 sm:px-2">
              <p className="truncate pr-1 text-base font-medium text-ink sm:text-lg">
                {player.username}
              </p>
              <div className="flex flex-row items-center gap-1">
                <Chip className="h-4 w-4 sm:h-5 sm:w-5" amount={player.stack} />
                <p className="type-num text-base text-amber-300 sm:text-lg">
                  {player.stack}
                </p>
              </div>
            </div>
          ))}
        {!running && isMine && (
          <button
            onClick={(e) => {
              e.stopPropagation();
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
            }}
            className={classNames(
              // Narrower than the seat box (w-32 / sm:w-56) and centered, so
              // it reads as a control under the seat rather than a bar.
              "btn mx-auto mt-1 flex w-24 py-1 text-xs font-bold sm:w-36 sm:text-sm",
              player.ready ? "btn-secondary" : "btn-confirm"
            )}
          >
            {player.ready ? t("cancelReady") : t("ready")}
          </button>
        )}
        {/* This street's bet, directly under the seat (same spot on every
            seat), as a chip plus amount. */}
        {running && player.bet !== 0 && (
          <div className="flex w-full justify-center">
            <div
              key={player.bet}
              className="animate-chip-pop mt-1 inline-flex items-center gap-1 rounded-full border border-amber-300/40 bg-black/40 px-2 py-0.5 text-sm font-semibold text-amber-300 sm:text-base"
            >
              <Chip className="h-3.5 w-3.5 sm:h-4 sm:w-4" amount={player.bet} />
              <span className="type-num leading-none">{player.bet}</span>
            </div>
          </div>
        )}
        <div className={chipPosition(visualId ?? id)}>
          {running && game.dealer == player.position && (
            <div className="mx-0.5 my-0.5 flex h-5 w-6 items-center justify-center text-sm sm:mx-1 sm:my-1 sm:h-7 sm:w-8 sm:text-xl">
              🔔
            </div>
          )}
          {/* Best hand at showdown: shown on the table-facing side of the
              seat (same spot as chips), only for players whose cards are
              actually revealed (participated in the showdown). */}
          {running && player.bestHand && (reveal || player.revealed) && (
            <p
              className={classNames(
                "animate-fade-in max-w-28 sm:max-w-36 truncate rounded-3xl bg-tablehi/90 px-2 text-xs font-semibold text-amber-300 sm:text-sm",
                // Match the chip's side of the seat so it never overlaps
                // the hole cards.
                (visualId ?? id) === 3 ? "flex-col items-start" : "flex-row"
              )}
            >
              {handLabel(player.bestHand)}
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
        <button className="m-1 h-16 w-32 rounded-2xl border border-muted/40 bg-transparent p-2 text-muted opacity-20 sm:m-4 sm:h-20 sm:w-56">
          <p className="text-3xl sm:text-4xl">{t("open")}</p>
          <h2 className="text-xs opacity-70 sm:text-base">{id}</h2>
        </button>
      </div>
    );
  }

  // Bot placement: the host taps "+" to seat a bot here.
  if (botMode) {
    return (
      <div>
        <button
          className="m-1 flex h-16 w-32 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-emerald-500/70 bg-emerald-900/20 p-2 text-emerald-300 transition-colors hover:bg-emerald-900/40 sm:m-4 sm:h-20 sm:w-56"
          onClick={() => socket && addBot(socket, id)}
          title={t("addBot")}
        >
          <PlusIcon className="h-7 w-7 sm:h-9 sm:w-9" />
          <h2 className="text-xs opacity-70 sm:text-base">{id}</h2>
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
          className="m-1 h-16 w-32 rounded-2xl border border-muted/40 bg-transparent p-2 text-ink transition-colors hover:bg-card sm:m-4 sm:h-20 sm:w-56"
          onClick={handleClick}
        >
          <p className="text-3xl sm:text-4xl">{t("open")}</p>
          <h2 className="text-xs opacity-70 sm:text-base">{id}</h2>
        </button>
      </div>
    );
  }

  return (
    <div>
      <button className="m-1 h-16 w-32 rounded-2xl border border-muted/40 bg-transparent p-2 text-muted opacity-20 sm:m-4 sm:h-20 sm:w-56">
        <p className="text-3xl sm:text-4xl">{t("open")}</p>
        <h2 className="text-xs opacity-70 sm:text-base">{id}</h2>
      </button>
    </div>
  );
}
