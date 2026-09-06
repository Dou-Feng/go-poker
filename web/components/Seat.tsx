import { useContext } from "react";
import { AppContext } from "../providers/AppStore";
import { Player } from "../interfaces/index";
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
  /** Chips this seat just won; while set (the showdown window) it replaces
   *  the name as "+amount", then the name comes back. */
  winAmount?: number;
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

export default function Seat({
  player,
  id,
  visualId,
  reveal,
  winAmount,
}: seatProps) {
  const { appState, dispatch } = useContext(AppContext);
  const socket = useSocket();
  const { t } = useTranslation();
  const handLabel = useHandLabel();
  const voiceState = useVoice();

  const game = appState.game;
  const running = game?.running ?? false;
  // Bot placement mode (host only, between hands, not yet readied): empty
  // seats become "+" to add a bot there, seated bots become removable.
  const isHost = !!game && !!appState.uuid && game.host === appState.uuid;
  const hostReady = !!game?.players.find((p) => p.uuid === appState.clientID)
    ?.ready;
  const botMode = appState.botMode && isHost && !running && !hostReady;

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
    const inHand = running && player.in;
    const allIn = inHand && player.stack === 0;
    const folded = running && !player.in && !left;
    const myTurn = running && game.betting && player.position === game.action;
    // A player wins if they are awarded any pot, including side pots.
    const winner =
      running &&
      !game.betting &&
      (game.pots ?? []).some((pot) =>
        (pot.winningPlayerNums ?? []).includes(player.position)
      );
    const canShow = isMine && inHand && player.stack === 0 && !player.revealed;
    // Table position as a badge on the avatar (independent of the seat
    // state, so BB + TURN or D + ALL-IN simply stack).
    const role: "dealer" | "sb" | "bb" | null = !running
      ? null
      : player.position === game.dealer
      ? "dealer"
      : player.position === game.sb
      ? "sb"
      : player.position === game.bb
      ? "bb"
      : null;
    const status = !running
      ? isMine
        ? "YOU"
        : isBot
        ? "BOT"
        : ""
      : winner
      ? "WIN"
      : allIn
      ? "ALL-IN"
      : folded
      ? "FOLDED"
      : myTurn
      ? "TURN"
      : isMine
      ? "YOU"
      : "";
    return (
      <div className="relative flex flex-col items-center">
        <div
          className={classNames("gps-seat", {
            "gps-seat--idle": !running,
            "gps-seat--hero": isMine,
            "gps-seat--active": myTurn,
            "gps-seat--folded": folded,
            "gps-seat--allin": allIn,
            "gps-seat--winner": winner,
            "gps-seat--left": left,
            "gps-seat--removable": removable,
          })}
          onClick={handleClick}
          role="button"
          title={
            removable
              ? t("removeBot")
              : canShow
              ? t("showCards")
              : t("viewRoomStats")
          }
        >
          {/* This street's bet, above the seat, as a chip plus amount. */}
          {running && player.bet !== 0 && (
            <div className="gps-seat__bet">
              <div
                key={player.bet}
                className="gps-seat__bet-pill animate-chip-pop"
              >
                <Chip className="gps-seat__chip" amount={player.bet} />
                <span className="type-num">{player.bet}</span>
              </div>
            </div>
          )}

          <div className="gps-seat__avatar">
            <Avatar
              username={player.username}
              uuid={player.accountUuid}
              emoji={player.avatar || "🙂"}
              hasImage={player.avatarImage}
              size={44}
            />
            {role && (
              <span className={`gps-seat__role gps-seat__role--${role}`}>
                {role === "dealer" ? "D" : role.toUpperCase()}
              </span>
            )}
            {removable && (
              <span className="gps-seat__x" aria-hidden>
                ✕
              </span>
            )}
            {(micLive || micMuted) && (
              <span
                className={classNames(
                  "gps-seat__mic",
                  micMuted ? "is-muted" : "is-live"
                )}
                title={micMuted ? t("muteMicFor") : t("micOn")}
              >
                <MicIcon off={micMuted} className="h-3 w-3" />
              </span>
            )}
          </div>

          {running && (
            <div className="gps-seat__cards">
              {/* Showdown hand name, as a translucent pill over the cards,
                  only for players whose cards are actually revealed. */}
              {player.bestHand && (reveal || player.revealed) && (
                <span className="gps-seat__hand animate-fade-in">
                  {handLabel(player.bestHand)}
                </span>
              )}
              {player.cards.map((c, i) => (
                <Card
                  key={`${i}-${c}`}
                  card={c}
                  placeholder={false}
                  folded={!player.in}
                  hidden={reveal || player.revealed ? false : hidden}
                />
              ))}
            </div>
          )}

          <div className="gps-seat__panel">
            <div className="gps-seat__row">
              {winAmount !== undefined ? (
                <strong
                  key="win"
                  className="gps-seat__name gps-seat__name--win animate-fade-in type-num"
                >
                  +{winAmount}
                </strong>
              ) : (
                <strong key="name" className="gps-seat__name">
                  {player.username}
                </strong>
              )}
              {status && <span className="gps-seat__status">{status}</span>}
            </div>
            <div className="gps-seat__stack">
              <Chip className="gps-seat__chip" amount={player.stack} />
              <span className="type-num">{player.stack}</span>
            </div>
            {!running && player.ready && (
              <div className="gps-seat__ready">{t("ready")}</div>
            )}
          </div>
        </div>

        {canShow && (
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
        )}
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
              // Narrower than the seat and centred, so it reads as a control
              // under the seat rather than a bar.
              "btn mx-auto mt-1 flex w-24 py-1 text-xs font-bold sm:w-36 sm:text-sm",
              player.ready ? "btn-secondary" : "btn-confirm"
            )}
          >
            {player.ready ? t("cancelReady") : t("ready")}
          </button>
        )}
      </div>
    );
  }

  // Empty seat.
  if (!game) {
    return (
      <div>
        <button
          disabled
          className="m-1 h-16 w-32 rounded-2xl border border-muted/40 bg-transparent p-2 text-muted opacity-20 sm:m-4 sm:h-20 sm:w-56"
        >
          <p className="text-3xl sm:text-4xl">{t("open")}</p>
          <h2 className="text-xs opacity-70 sm:text-base">{id}</h2>
        </button>
      </div>
    );
  }

  const buyIn = game.config.buyIn ?? 200;
  // take-seat: sits down between hands; during a hand it claims the seat for
  // the next hand instead (the server seats the claimant, not ready, when the
  // hand ends). Tapping an own claim again cancels it.
  const sitOrClaim = () => {
    if (!socket || !appState.username) {
      return;
    }
    if (appState.chips != null && appState.chips < buyIn) {
      dispatch({ type: "setAuthError", payload: "not enough chips" });
      return;
    }
    takeSeat(socket, appState.username, id, buyIn);
    if (!running) {
      sendLog(socket, appState.username + " buys in for " + buyIn);
    }
  };

  // A seat somebody claimed for the next hand: their avatar, dimmed, with a
  // "next hand" tag. Only the claimant can tap it (to cancel).
  const reservation = game.reserved.find((r) => r.seatID === id);
  if (reservation) {
    const mine = reservation.accountUuid === appState.uuid;
    return (
      <div>
        <button
          disabled={!mine}
          onClick={mine ? sitOrClaim : undefined}
          title={mine ? t("cancelReservation") : undefined}
          className={classNames(
            "m-1 flex h-16 w-32 flex-row items-center justify-center gap-2 rounded-2xl border border-dashed border-amber-300/60 bg-black/30 p-2 sm:m-4 sm:h-20 sm:w-56",
            mine ? "transition-colors hover:bg-card" : "cursor-default"
          )}
        >
          <div className="opacity-70">
            <Avatar
              username={reservation.username}
              uuid={reservation.accountUuid}
              emoji={reservation.avatar || "🙂"}
              hasImage={reservation.avatarImage}
              size={36}
            />
          </div>
          <div className="flex min-w-0 flex-col items-start leading-tight">
            <p className="max-w-[4.5rem] truncate text-sm font-medium text-ink sm:max-w-[8rem] sm:text-base">
              {reservation.username}
            </p>
            <p className="type-caption text-amber-300">{t("nextHand")}</p>
          </div>
        </button>
      </div>
    );
  }

  // During a hand empty seats are not drawn: seated players and anonymous
  // viewers see only the players (and any seat a newcomer has claimed, above).
  // A logged-in spectator is the exception: they need a target to tap, so for
  // them the empty slots stay visible as claimable "next hand" seats.
  if (running) {
    const canClaim = !appState.clientID && !!appState.username;
    if (!canClaim) {
      return null;
    }
    return (
      <div>
        <button
          onClick={sitOrClaim}
          title={t("reserveSeat")}
          className="m-1 h-16 w-32 rounded-2xl border border-amber-300/50 bg-transparent p-2 text-ink transition-colors hover:bg-card sm:m-4 sm:h-20 sm:w-56"
        >
          <p className="text-3xl sm:text-4xl">{t("open")}</p>
          <h2 className="text-xs opacity-70 sm:text-base">{t("nextHand")}</h2>
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
    const handleClick = () => {
      if (!socket) {
        return;
      }
      if (appState.clientID) {
        // Already seated but not ready: move to this seat.
        moveSeat(socket, id);
      } else {
        sitOrClaim();
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
      <button
        disabled
        className="m-1 h-16 w-32 rounded-2xl border border-muted/40 bg-transparent p-2 text-muted opacity-20 sm:m-4 sm:h-20 sm:w-56"
      >
        <p className="text-3xl sm:text-4xl">{t("open")}</p>
        <h2 className="text-xs opacity-70 sm:text-base">{id}</h2>
      </button>
    </div>
  );
}
