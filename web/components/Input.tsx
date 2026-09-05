import { useState, useContext } from "react";
import { AppContext } from "../providers/AppStore";
import {
  playerCall,
  playerCheck,
  playerFold,
  playerRaise,
  sendLog,
} from "../actions/actions";
import { useSocket } from "../hooks/useSocket";
import { useTranslation } from "../hooks/useTranslation";
import { playSfx } from "../lib/sfx";
import InputButton from "./InputButton";
import RaiseInput from "./RaiseInput";
import {
  FiArrowUpCircle,
  FiCornerDownLeft,
  FiSkipForward,
  FiX,
  FiZap,
} from "react-icons/fi";

export default function Input() {
  const socket = useSocket();
  const { appState, dispatch } = useContext(AppContext);
  const { t } = useTranslation();
  const [showRaise, setShowRaise] = useState(false);

  const handleFold = (user: string | null) => {
    if (socket) {
      playSfx("fold");
      let foldMessage = user + " folds";
      sendLog(socket, foldMessage);
      playerFold(socket);
    }
  };

  if (!appState.game || appState.game.betting == false) return null;

  // A player who is all-in cannot act.
  const me = appState.game.players.find((p) => p.uuid === appState.clientID);
  if (me && me.in && me.stack === 0) {
    return null;
  }

  const action =
    appState.clientID === appState.game.players[appState.game.action].uuid;

  const player = appState.game.players[appState.game.action];
  const playerBets = appState.game.players.map((player) => player.bet);
  const maxBet = Math.max(...playerBets);

  const canCheck = player.bet >= maxBet;
  const callAmount =
    maxBet - player.bet < player.stack ? maxBet - player.bet : player.stack;
  // A player who already acted this street and is behind the top bet is
  // facing a short all-in (less than a full raise). That does not reopen the
  // betting: the server only accepts a call or a fold from them.
  const callOnly = player.called && player.bet < maxBet;

  const handleCallOrCheck = (user: string | null) => {
    if (!socket) {
      return;
    }
    if (canCheck) {
      playSfx("click");
      sendLog(socket, user + " checks");
      playerCheck(socket);
    } else {
      playSfx("call");
      sendLog(socket, user + " calls " + callAmount);
      playerCall(socket);
    }
  };

  const handleAllIn = (user: string | null) => {
    if (!socket) {
      return;
    }
    playSfx("allin");
    sendLog(socket, user + " is all in");
    playerRaise(socket, player.stack);
  };

  // The action bar exists only on the player's own turn; otherwise nothing is
  // drawn (the glowing seat already shows whose turn it is).
  if (!action) {
    return null;
  }
  if (showRaise) {
    return <RaiseInput setShowRaise={setShowRaise} showRaise={showRaise} />;
  }
  // Layout: the three "play on" keys in a row, fold alone underneath so a
  // thumb aiming for call/raise cannot land on it. The bar keeps clear of
  // the phone's bottom gesture area (safe-area inset, at least 24px).
  return (
    <div className="pointer-events-auto flex w-full justify-center px-2 pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:p-6">
      <div className="animate-fade-in flex flex-col items-center gap-2 rounded-2xl border border-amber-700/40 bg-tablehi/95 p-2.5 shadow-lg sm:gap-2.5 sm:p-3">
        <div className="flex flex-row items-center justify-center gap-2 sm:gap-3">
          <InputButton
            action={() => handleCallOrCheck(appState.username)}
            title={canCheck ? t("check") : t("call") + " " + callAmount}
            disabled={false}
            variant="call"
            icon={
              canCheck ? (
                <FiSkipForward size="1em" />
              ) : (
                <FiCornerDownLeft size="1em" />
              )
            }
          />
          {!callOnly && (
            <InputButton
              action={() => setShowRaise(!showRaise)}
              title={t("bet")}
              disabled={false}
              variant="bet"
              icon={<FiArrowUpCircle size="1em" />}
            />
          )}
          {!callOnly && (
            <InputButton
              action={() => handleAllIn(appState.username)}
              title={t("allIn")}
              disabled={false}
              variant="allin"
              icon={<FiZap size="1em" />}
            />
          )}
        </div>
        <InputButton
          action={() => handleFold(appState.username)}
          title={t("fold")}
          disabled={false}
          variant="fold"
          icon={<FiX size="1em" />}
          className="min-w-[9rem] sm:min-w-[11rem]"
        />
      </div>
    </div>
  );
}
