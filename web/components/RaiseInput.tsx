import { useState, useContext, useCallback } from "react";
import { AppContext } from "../providers/AppStore";
import { playerRaise, sendLog } from "../actions/actions";
import { useSocket } from "../hooks/useSocket";
import { useTranslation } from "../hooks/useTranslation";
import InputButton from "./InputButton";
import { Slider } from "@mantine/core";
import classNames from "classnames";

type raiseProps = {
    showRaise: boolean;
    setShowRaise: React.Dispatch<React.SetStateAction<boolean>>;
};
function button() {
    return classNames(
        "mx-0.5 my-1 rounded-sm border border-2 border-zinc-600 px-2 py-1 text-sm text-neutral-200 hover:bg-zinc-600 font-light sm:p-2 sm:text-base"
    );
}

export default function RaiseInput({ showRaise, setShowRaise }: raiseProps) {
    const socket = useSocket();
    const { appState, dispatch } = useContext(AppContext);
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
        appState.game.pots.length != 0 ? appState.game.pots[0].amount : bigBlind + smallBlind;

    // a pot sized bet is equal to 3 times the previous largest bet + pot before previous bet
    const potBet = 3 * maxBet + currentPot - maxBet;

    function potPortion(pot: number, fraction: number) {
        // returns rounded fraction of the pot
        return Math.ceil(pot * fraction);
    }

    function betValidator(bet: number, minRaise: number, stack: number) {
        // bet can never be smaller than min raise and can never be bigger than player stack + committed chips
        if (bet < minRaise) {
            return minRaise;
        } else if (bet > stack) {
            return stack;
        } else {
            return bet;
        }
    }

    const half = appState.game.pots.length != 0 ? potPortion(potBet, 0.5) : minRaise;
    const threeQuarter =
        appState.game.pots.length != 0 ? potPortion(potBet, 0.75) : Math.ceil(bigBlind * 2.5);

    const full = appState.game.pots.length != 0 ? potBet : bigBlind * 3;
    const allIn = currentStack + currentBet;

    const [inputValue, setInputValue] = useState(minRaise);

    const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const bet = parseInt(e.target.value);
        setInputValue(bet);
    }, []);

    const handleRaise = (user: string | null, amount: number) => {
        if (socket) {
            let raiseMessage = user + " bets " + amount;
            sendLog(socket, raiseMessage);
            playerRaise(socket, amount);
        }
        setShowRaise(!showRaise);
    };

    return (
        <div className="flex w-full flex-row flex-wrap items-center justify-center gap-1 p-2 sm:p-6">
            <input
                autoFocus
                className="mx-1 w-16 rounded-sm border border-2 border-zinc-600 bg-zinc-800 p-2 text-xl font-normal text-neutral-200 focus:outline-none sm:w-24 sm:text-2xl"
                id="input"
                type="text"
                value={inputValue ? inputValue : ""}
                onChange={handleChange}
            />
            <div className="mx-1 flex flex-col items-center justify-center rounded-sm border border-2 border-zinc-600 px-2">
                <div className="flex flex-row flex-wrap items-center justify-center">
                    <button
                        className={button()}
                        onClick={() =>
                            setInputValue(
                                betValidator(minRaise, minRaise, currentStack + currentBet)
                            )
                        }
                    >
                        {t("min")}
                    </button>
                    <button
                        className={button()}
                        onClick={() =>
                            setInputValue(betValidator(half, minRaise, currentStack + currentBet))
                        }
                    >
                        {t("halfPot")}
                    </button>
                    <button
                        className={button()}
                        onClick={() =>
                            setInputValue(
                                betValidator(threeQuarter, minRaise, currentStack + currentBet)
                            )
                        }
                    >
                        {t("threeQuarterPot")}
                    </button>
                    <button
                        className={button()}
                        onClick={() =>
                            setInputValue(betValidator(full, minRaise, currentStack + currentBet))
                        }
                    >
                        {t("pot")}
                    </button>
                    <button
                        className={button()}
                        onClick={() =>
                            setInputValue(betValidator(allIn, minRaise, currentStack + currentBet))
                        }
                    >
                        {t("allIn")}
                    </button>
                </div>
                <div className="w-36 pb-2 sm:w-64">
                    <Slider
                        value={inputValue}
                        onChange={setInputValue}
                        min={minRaise}
                        max={currentStack + currentBet}
                        step={1}
                        color="gray"
                        showLabelOnHover={false}
                        size="md"
                        radius="xs"
                    />
                </div>
            </div>
            <InputButton
                action={() => handleRaise(appState.username, inputValue - currentBet)}
                title={t("bet")}
                disabled={inputValue < minRaise || inputValue > currentStack + currentBet}
            />
            <InputButton
                action={() => setShowRaise(!showRaise)}
                title={t("close")}
                disabled={false}
                danger
            />
        </div>
    );
}
