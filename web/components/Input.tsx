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
import { playSfx } from "../lib/sfx";
import InputButton from "./InputButton";
import RaiseInput from "./RaiseInput";

export default function Input() {
  const socket = useSocket();
  const { appState } = useContext(AppContext);
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

  // The action bar exists only on the player's own turn.
  if (!action) {
    return null;
  }
  if (showRaise) {
    return <RaiseInput setShowRaise={setShowRaise} showRaise={showRaise} />;
  }

  return (
    <div className="pointer-events-auto flex w-full justify-center px-2 pt-2 pb-[10dvh]">
      <div
        className="gp-action-bar animate-fade-in"
        role="group"
        aria-label="玩家操作"
      >
        <InputButton
          kind="check"
          label={canCheck ? "过牌" : `跟注 ${callAmount}`}
          subLabel={canCheck ? "CHECK" : "CALL"}
          onClick={() => handleCallOrCheck(appState.username)}
        />
        {!callOnly && (
          <InputButton
            kind="bet"
            label="加注"
            subLabel="BET"
            onClick={() => setShowRaise(!showRaise)}
          />
        )}
        {!callOnly && (
          <InputButton
            kind="allin"
            label="ALL-IN"
            onClick={() => handleAllIn(appState.username)}
          />
        )}
        <InputButton
          kind="fold"
          label="弃牌"
          subLabel="FOLD"
          onClick={() => handleFold(appState.username)}
        />
      </div>
    </div>
  );
}
