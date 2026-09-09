import { useContext, useMemo, useState } from "react";
import { AppContext } from "../providers/AppStore";
import { playerRaise, sendLog } from "../actions/actions";
import { useSocket } from "../hooks/useSocket";
import { playSfx, playTickedAction } from "../lib/sfx";
import InputButton from "./InputButton";
import Chip from "./Chip";
import classNames from "classnames";

type raiseProps = {
  /** Hide the panel (close button, or after the raise is sent). */
  onClose: () => void;
};

type Preset = "min" | "half" | "pot" | "double";

// Labels follow the action bar next to the panel: Chinese primary, small
// English caption (see Input.tsx).
const PRESET_TEXT: Record<Preset, { zh: string; en: string }> = {
  min: { zh: "最小", en: "MIN" },
  half: { zh: "1/2 底池", en: "1/2 POT" },
  pot: { zh: "满池", en: "POT" },
  double: { zh: "2 倍底池", en: "2 × POT" },
};

// Raise panel above the action bar (styles/raisepanel.css): quick amounts,
// a slider with −/+ nudges in big-blind steps, and the bar's own BET /
// ALL-IN key to confirm. Amounts are the player's total bet for the street
// (what the slider shows); the server receives the increment on top of what
// they already have in.
export default function RaiseInput({ onClose }: raiseProps) {
  const socket = useSocket();
  const { appState } = useContext(AppContext);
  const game = appState.game;

  const bigBlind = game?.config.bb ?? 0;
  const smallBlind = game?.config.sb ?? 0;
  const actor = game ? game.players[game.action] : undefined;
  const currentBet = actor?.bet ?? 0;
  const currentStack = actor?.stack ?? 0;
  const maxBet = game ? Math.max(...game.players.map((p) => p.bet)) : 0;
  const allInTotal = currentStack + currentBet;
  // Minimum legal total; a short stack that cannot make a full raise can
  // still shove, so the floor never exceeds the all-in amount.
  const minRaise = Math.min(maxBet + (game?.minRaise ?? 0), allInTotal);
  const currentPot =
    game && game.pots.length !== 0
      ? game.pots[0].amount
      : bigBlind + smallBlind;

  const clamp = (v: number) =>
    Math.min(allInTotal, Math.max(minRaise, Math.round(v)));

  // Quick amounts are pot-sized raises relative to the current pot.
  const presetValue = useMemo(() => {
    const potBet = currentPot + 2 * (maxBet - currentBet);
    return {
      min: clamp(minRaise),
      half: clamp(Math.ceil(potBet / 2)),
      pot: clamp(potBet),
      double: clamp(potBet * 2),
    } as Record<Preset, number>;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPot, maxBet, currentBet, minRaise, allInTotal]);

  const [amount, setAmount] = useState(minRaise);

  if (!game || !actor) {
    return null;
  }

  const value = clamp(amount);
  const isAllIn = value >= allInTotal;
  const step = Math.max(1, bigBlind);
  const fill =
    allInTotal > minRaise ? (value - minRaise) / (allInTotal - minRaise) : 1;
  const selected = (Object.keys(PRESET_TEXT) as Preset[]).find(
    (p) => presetValue[p] === value
  );

  const confirm = () => {
    if (socket) {
      playTickedAction(isAllIn ? "allin" : "heroBet");
      sendLog(
        socket,
        isAllIn
          ? appState.username + " is all in"
          : appState.username + " bets " + value
      );
      playerRaise(socket, value - currentBet);
    }
    onClose();
  };

  return (
    <div
      className="gp-raise-panel animate-fade-in pointer-events-auto"
      role="dialog"
      aria-label="加注"
    >
      <div className="gp-raise-panel__topline" aria-hidden="true" />

      <header className="gp-raise-panel__header">
        <div className="gp-raise-panel__title">
          <img src="/assets/ui/buttons/bet/bet_icon.svg" alt="" />
          <div>
            <strong>加注</strong>
            <span>RAISE</span>
          </div>
        </div>

        <div className="gp-raise-panel__pot">
          <Chip className="gp-raise-panel__pot-chip" amount={currentPot} />
          <div>
            <span>当前底池</span>
            <strong className="type-num">{currentPot}</strong>
          </div>
        </div>

        <button
          type="button"
          className="gp-raise-panel__close"
          data-sfx="back"
          onClick={onClose}
          aria-label="关闭"
        >
          ×
        </button>
      </header>

      <div className="gp-raise-panel__divider" />

      <div className="gp-raise-panel__presets">
        {(Object.keys(PRESET_TEXT) as Preset[]).map((preset) => (
          <button
            type="button"
            key={preset}
            className={classNames(
              "gp-preset",
              selected === preset && "is-selected"
            )}
            onClick={() => {
              playSfx("tick");
              setAmount(presetValue[preset]);
            }}
          >
            <strong>{PRESET_TEXT[preset].zh}</strong>
            <span>{PRESET_TEXT[preset].en}</span>
          </button>
        ))}
      </div>

      <section className="gp-raise-panel__amount-section">
        <div className="gp-raise-panel__amount-copy">
          <strong>加注金额</strong>
          <span>AMOUNT</span>
          <small className="type-num">
            {minRaise} - {allInTotal}
          </small>
        </div>

        <div className="gp-raise-panel__slider-wrap">
          <input
            className="gp-raise-slider"
            type="range"
            min={minRaise}
            max={allInTotal}
            step={1}
            value={value}
            onChange={(e) => setAmount(Number(e.target.value))}
            style={{ ["--fill" as string]: fill }}
            aria-label="加注金额"
          />
        </div>

        <div className="gp-raise-panel__controls">
          <button
            type="button"
            onClick={() => {
              playSfx("tick");
              setAmount(clamp(value - step));
            }}
            disabled={value <= minRaise}
            aria-label="减少"
          >
            −
          </button>
          <div className="gp-raise-panel__value">
            <Chip className="gp-raise-panel__value-chip" amount={value} />
            <strong className="type-num">{value}</strong>
          </div>
          <button
            type="button"
            onClick={() => {
              playSfx("tick");
              setAmount(clamp(value + step));
            }}
            disabled={value >= allInTotal}
            aria-label="增加"
          >
            +
          </button>
        </div>
      </section>

      <footer className="gp-raise-panel__footer">
        <InputButton
          kind={isAllIn ? "allin" : "bet"}
          label={isAllIn ? "ALL-IN" : "确认"}
          subLabel={isAllIn ? "" : "CONFIRM"}
          onClick={confirm}
        />
      </footer>

      <span className="gp-raise-panel__pointer" aria-hidden="true" />
    </div>
  );
}
