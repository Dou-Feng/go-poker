import { useContext, useMemo, useState } from "react";
import { AppContext } from "../providers/AppStore";
import { playerRaise, sendLog } from "../actions/actions";
import { useSocket } from "../hooks/useSocket";
import { playSfx, playTickedAction } from "../lib/sfx";
import InputButton from "./InputButton";
import Chip from "./Chip";
import classNames from "classnames";
import { raisePresetAmounts, totalPot } from "../lib/betting";

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
// ALL-IN key to confirm. Every displayed amount is the number of chips this
// action adds, matching the amount sent to the server.
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
  // Minimum chips to add: call the outstanding amount, then complete one
  // minimum raise. A short stack can still shove below that floor.
  const minAmount = Math.min(
    Math.max(0, maxBet + (game?.minRaise ?? 0) - currentBet),
    currentStack
  );
  const currentPot = game
    ? totalPot(game.pots, game.players)
    : bigBlind + smallBlind;

  const clamp = (v: number) =>
    Math.min(currentStack, Math.max(minAmount, Math.round(v)));

  // Quick amounts are pot-sized raises relative to the current pot.
  const presetValue = useMemo(() => {
    return raisePresetAmounts(
      currentPot,
      currentBet,
      maxBet,
      minAmount,
      currentStack
    ) as Record<Preset, number>;
  }, [currentPot, maxBet, currentBet, minAmount, currentStack]);

  const [amount, setAmount] = useState(minAmount);
  // Keep the player's actual preset choice separate from the resulting
  // amount. Multiple presets can clamp to the same legal minimum; deriving
  // selection from the number would make tapping 1/2 pot appear to do
  // nothing because "min" is the first preset with that value.
  const [activePreset, setActivePreset] = useState<Preset | null>("min");

  if (!game || !actor) {
    return null;
  }

  const value = clamp(amount);
  const isAllIn = value >= currentStack;
  const step = Math.max(1, bigBlind);
  const fill =
    currentStack > minAmount
      ? (value - minAmount) / (currentStack - minAmount)
      : 1;
  const confirm = () => {
    if (socket) {
      playTickedAction(isAllIn ? "allin" : "heroBet");
      const user = appState.username ?? "";
      if (isAllIn) {
        sendLog(socket, "logAllIn", [user]);
      } else if (maxBet > currentBet) {
        sendLog(socket, "logRaisesTo", [user, String(currentBet + value)]);
      } else {
        sendLog(socket, "logBets", [user, String(value)]);
      }
      playerRaise(socket, value);
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
              activePreset === preset && "is-selected"
            )}
            aria-pressed={activePreset === preset}
            onClick={() => {
              playSfx("tick");
              setActivePreset(preset);
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
          <strong>本次投入</strong>
          <span>ADD CHIPS</span>
          <small className="type-num">
            {minAmount} - {currentStack}
          </small>
        </div>

        <div className="gp-raise-panel__slider-wrap">
          <input
            className="gp-raise-slider"
            type="range"
            min={minAmount}
            max={currentStack}
            step={1}
            value={value}
            onChange={(e) => {
              setActivePreset(null);
              setAmount(Number(e.target.value));
            }}
            style={{ ["--fill" as string]: fill }}
            aria-label="加注金额"
          />
        </div>

        <div className="gp-raise-panel__controls">
          <button
            type="button"
            onClick={() => {
              playSfx("tick");
              setActivePreset(null);
              setAmount(clamp(value - step));
            }}
            disabled={value <= minAmount}
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
              setActivePreset(null);
              setAmount(clamp(value + step));
            }}
            disabled={value >= currentStack}
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
