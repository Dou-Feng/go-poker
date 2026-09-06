import { useState, useContext, useEffect } from "react";
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

  const game = appState.game;
  const action =
    !!game &&
    game.betting &&
    game.action < game.players.length &&
    appState.clientID === game.players[game.action].uuid;
  // The raise panel is a per-turn thing: it closes as soon as the turn moves
  // on (the component stays mounted, so the state must be reset here).
  useEffect(() => {
    if (!action) {
      setShowRaise(false);
    }
  }, [action]);

  if (!game || game.betting == false) return null;

  // A player who is all-in cannot act.
  const me = game.players.find((p) => p.uuid === appState.clientID);
  if (me && me.in && me.stack === 0) {
    return null;
  }

  const player = game.players[game.action];
  const playerBets = game.players.map((player) => player.bet);
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
      playSfx("check");
      sendLog(socket, user + " checks");
      playerCheck(socket);
    } else {
      playSfx("heroBet");
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

  // The raise panel opens above the bar (the bar stays put underneath, its
  // 加注 key toggles the panel).
  return (
    // The strip spans the screen but must not swallow taps beside the keys
    // (the room menu sits bottom-right): only the panel and bar are targets.
    <div className="room-action-input pointer-events-none flex w-full flex-col items-center gap-4 px-2 pt-2">
      {showRaise && <RaiseInput onClose={() => setShowRaise(false)} />}
      <div
        className="gp-action-bar animate-fade-in pointer-events-auto"
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
            onClick={() => setShowRaise((s) => !s)}
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
