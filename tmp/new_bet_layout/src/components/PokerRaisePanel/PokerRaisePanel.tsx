import React, { useMemo, useState } from "react";
import "./PokerRaisePanel.css";

export type RaisePreset = "min" | "half-pot" | "pot" | "double-pot";

export type PokerRaisePanelProps = {
  pot: number;
  minRaise: number;
  maxRaise: number;
  initialAmount?: number;
  onConfirm: (amount: number) => void;
  onClose: () => void;
  className?: string;
};

const presetText: Record<RaisePreset, { zh: string; en: string }> = {
  min: { zh: "最小", en: "MIN" },
  "half-pot": { zh: "1/2 底池", en: "1/2 POT" },
  pot: { zh: "满池", en: "POT" },
  "double-pot": { zh: "2 倍底池", en: "2 × POT" },
};

export default function PokerRaisePanel({
  pot,
  minRaise,
  maxRaise,
  initialAmount,
  onConfirm,
  onClose,
  className = "",
}: PokerRaisePanelProps) {
  const safeInitial = Math.min(
    maxRaise,
    Math.max(minRaise, initialAmount ?? minRaise)
  );

  const [amount, setAmount] = useState(safeInitial);
  const [selectedPreset, setSelectedPreset] = useState<RaisePreset | null>("min");

  const clamp = (value: number) =>
    Math.min(maxRaise, Math.max(minRaise, Math.round(value)));

  const presetValue = useMemo(() => ({
    min: minRaise,
    "half-pot": clamp(pot * 0.5),
    pot: clamp(pot),
    "double-pot": clamp(pot * 2),
  }), [pot, minRaise, maxRaise]);

  const choosePreset = (preset: RaisePreset) => {
    setSelectedPreset(preset);
    setAmount(presetValue[preset]);
  };

  const updateAmount = (value: number) => {
    setSelectedPreset(null);
    setAmount(clamp(value));
  };

  return (
    <div className={`gp-raise-panel ${className}`} role="dialog" aria-label="加注">
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
          <img src="/assets/ui/buttons/common/chip_silver.svg" alt="" />
          <div>
            <span>当前底池</span>
            <strong>{pot}</strong>
          </div>
        </div>

        <button
          type="button"
          className="gp-raise-panel__close"
          onClick={onClose}
          aria-label="关闭"
        >
          ×
        </button>
      </header>

      <div className="gp-raise-panel__divider" />

      <div className="gp-raise-panel__presets">
        {(Object.keys(presetText) as RaisePreset[]).map((preset) => (
          <button
            type="button"
            key={preset}
            className={`gp-preset ${selectedPreset === preset ? "is-selected" : ""}`}
            onClick={() => choosePreset(preset)}
          >
            <strong>{presetText[preset].zh}</strong>
            <span>{presetText[preset].en}</span>
          </button>
        ))}
      </div>

      <section className="gp-raise-panel__amount-section">
        <div className="gp-raise-panel__amount-copy">
          <strong>加注金额</strong>
          <span>AMOUNT</span>
          <small>范围：{minRaise} - {maxRaise}</small>
        </div>

        <div className="gp-raise-panel__slider-wrap">
          <input
            className="gp-raise-slider"
            type="range"
            min={minRaise}
            max={maxRaise}
            value={amount}
            onChange={(e) => updateAmount(Number(e.target.value))}
          />
        </div>

        <div className="gp-raise-panel__controls">
          <button type="button" onClick={() => updateAmount(amount - 1)}>−</button>

          <div className="gp-raise-panel__value">
            <img src="/assets/ui/buttons/common/chip_silver.svg" alt="" />
            <strong>{amount}</strong>
          </div>

          <button type="button" onClick={() => updateAmount(amount + 1)}>+</button>
        </div>
      </section>

      <footer className="gp-raise-panel__footer">
        <button
          type="button"
          className="gp-confirm-raise"
          onClick={() => onConfirm(amount)}
        >
          <img src="/assets/ui/buttons/bet/bet_icon.svg" alt="" />
          <div>
            <strong>确认加注</strong>
            <span>RAISE</span>
          </div>
        </button>
      </footer>

      <span className="gp-raise-panel__pointer" aria-hidden="true" />
    </div>
  );
}
