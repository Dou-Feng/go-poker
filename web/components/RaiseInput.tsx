import { useState, useContext } from "react";
import { AppContext } from "../providers/AppStore";
import { playerRaise, sendLog } from "../actions/actions";
import { useSocket } from "../hooks/useSocket";
import { useTranslation } from "../hooks/useTranslation";
import { playSfx } from "../lib/sfx";
import InputButton from "./InputButton";
import Chip from "./Chip";
import { Slider } from "@mantine/core";
import classNames from "classnames";

type raiseProps = {
  showRaise: boolean;
  setShowRaise: React.Dispatch<React.SetStateAction<boolean>>;
};
// Quick-amount chips (min / ½ pot / ¾ pot / pot): flat toolbar buttons.
function button() {
  return classNames("btn btn-secondary px-2.5 py-1 text-xs sm:text-sm");
}

export default function RaiseInput({ showRaise, setShowRaise }: raiseProps) {
  const socket = useSocket();
  const { appState } = useContext(AppContext);
  const { t } = useTranslation();

  if (!appState.game) {
    return null;
  }

  const bigBlind = appState.game.config.bb;
  const smallBlind = appState.game.config.sb;
  const currentBet = appState.game.players[appState.game.action].bet; // active player's bet
  const currentStack = appState.game.players[appState.game.action].stack; // active player's stack
  const playerBets = appState.game.players.map((player) => player.bet); // array of all players' bets
  const maxBet = Math.max(...playerBets); // largest bet out of all player's bets
  const minRaise = maxBet + appState.game.minRaise;

  const currentPot =
    appState.game.pots.length != 0
      ? appState.game.pots[0].amount
      : bigBlind + smallBlind;

  function betValidator(bet: number, min: number, stack: number) {
    // bet can never be smaller than min raise and can never be bigger than player stack + committed chips
    if (bet < min) {
      return min;
    } else if (bet > stack) {
      return stack;
    } else {
      return bet;
    }
  }

  // Quick amounts are a pot-sized raise relative to the current pot.
  const potBet = currentPot + 2 * (maxBet - currentBet);
  const half = Math.ceil(potBet / 2);
  const threeQuarter = Math.ceil((potBet * 3) / 4);
  const full = potBet;
  const allInTotal = currentStack + currentBet;

  const [inputValue, setInputValue] = useState(minRaise);

  const isAllIn = inputValue >= allInTotal;

  const handleRaise = (user: string | null, amount: number) => {
    if (socket) {
      playSfx(isAllIn ? "allin" : "raise");
      const raiseMessage = isAllIn
        ? user + " is all in"
        : user + " bets " + amount;
      sendLog(socket, raiseMessage);
      playerRaise(socket, amount);
    }
    setShowRaise(!showRaise);
  };

  return (
    <div className="pointer-events-auto flex w-full justify-center p-2 pb-4 sm:p-6">
      <div className="animate-fade-in flex flex-row flex-wrap items-center justify-center gap-2 rounded-xl border border-muted/30 bg-tablehi/95 p-2 shadow-lg ring-1 ring-amber-300/50 sm:gap-3 sm:p-3">
        <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg bg-card px-3 py-2">
          <div className="flex items-center justify-center gap-1.5 text-xl font-semibold text-amber-300 sm:text-2xl">
            <Chip className="h-5 w-5 sm:h-6 sm:w-6" amount={inputValue} />
            <span className="type-num leading-none">{inputValue}</span>
          </div>
          <div className="flex flex-row flex-wrap items-center justify-center gap-1">
            <button
              className={button()}
              onClick={() =>
                setInputValue(betValidator(minRaise, minRaise, allInTotal))
              }
            >
              {t("min")}
            </button>
            <button
              className={button()}
              onClick={() =>
                setInputValue(betValidator(half, minRaise, allInTotal))
              }
            >
              {t("halfPot")}
            </button>
            <button
              className={button()}
              onClick={() =>
                setInputValue(betValidator(threeQuarter, minRaise, allInTotal))
              }
            >
              {t("threeQuarterPot")}
            </button>
            <button
              className={button()}
              onClick={() =>
                setInputValue(betValidator(full, minRaise, allInTotal))
              }
            >
              {t("pot")}
            </button>
          </div>
          <div className="w-44 pb-1 sm:w-72">
            <Slider
              value={inputValue}
              onChange={setInputValue}
              min={minRaise}
              max={allInTotal}
              step={1}
              color="cyan"
              showLabelOnHover={false}
              size="md"
              radius="xl"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <InputButton
            action={() =>
              handleRaise(appState.username, inputValue - currentBet)
            }
            title={isAllIn ? t("allIn") : t("bet")}
            disabled={inputValue < minRaise || inputValue > allInTotal}
            variant={isAllIn ? "allin" : "bet"}
          />
          <InputButton
            action={() => setShowRaise(!showRaise)}
            title={t("close")}
            disabled={false}
            variant="neutral"
          />
        </div>
      </div>
    </div>
  );
}
