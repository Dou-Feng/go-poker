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

  if (action) {
    if (showRaise) {
      return <RaiseInput setShowRaise={setShowRaise} showRaise={showRaise} />;
    }
    return (
      <div className="pointer-events-auto flex w-full justify-center p-2 pb-4 sm:p-6">
        <div className="flex flex-row flex-wrap items-center justify-center gap-1 rounded-2xl border-2 border-amber-300 bg-zinc-900/80 p-2 shadow-lg sm:p-3">
          <InputButton
            action={() => handleCallOrCheck(appState.username)}
            title={canCheck ? t("check") : t("call") + " (" + callAmount + ")"}
            disabled={false}
          />
          <InputButton
            action={() => setShowRaise(!showRaise)}
            title={t("bet")}
            disabled={false}
          />
          <InputButton
            action={() => handleAllIn(appState.username)}
            title={t("allIn")}
            disabled={false}
          />
          <InputButton
            action={() => handleFold(appState.username)}
            title={t("fold")}
            disabled={false}
            danger
          />
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-auto flex w-full flex-row flex-wrap items-center justify-center gap-1 p-2 pb-4 sm:p-6">
      <InputButton
        action={() => handleCallOrCheck(appState.username)}
        title={canCheck ? t("check") : t("call") + " (" + callAmount + ")"}
        disabled={true}
      />
      <InputButton
        action={() => setShowRaise(!showRaise)}
        title={t("bet")}
        disabled={true}
      />
      <InputButton
        action={() => handleAllIn(appState.username)}
        title={t("allIn")}
        disabled={true}
      />
      <InputButton
        action={() => handleFold(appState.username)}
        title={t("fold")}
        disabled={true}
        danger
      />
    </div>
  );
}
