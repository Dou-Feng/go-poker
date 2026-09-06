import { MouseEventHandler, ReactNode } from "react";

export type ActionKind = "check" | "bet" | "allin" | "fold";

const ICON_PATH: Record<ActionKind, string> = {
  check: "/assets/ui/buttons/check/check_icon.svg",
  bet: "/assets/ui/buttons/bet/bet_icon.svg",
  allin: "/assets/ui/buttons/allin/allin_icon.svg",
  fold: "/assets/ui/buttons/fold/fold_icon.svg",
};

type InputButtonProps = {
  kind: ActionKind;
  icon?: ReactNode;
  pressed?: boolean;
  label: string;
  /** Small English caption shown under the label. */
  subLabel?: string;
  disabled?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  className?: string;
};

// Game action keys (check / bet / all-in / fold), rendered as layered material
// buttons (see styles/actionbar.css). The label is the primary text and
// subLabel is the small English caption under it.
export default function InputButton({
  kind,
  icon,
  pressed,
  label,
  subLabel = "",
  disabled = false,
  onClick,
  className = "",
}: InputButtonProps) {
  return (
    <button
      type="button"
      className={`gp-action-btn gp-action-btn--${kind} ${className}`}
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
    >
      <span className="gp-action-btn__shadow" aria-hidden="true" />
      <span className="gp-action-btn__surface" aria-hidden="true" />
      <span className="gp-action-btn__highlight" aria-hidden="true" />
      <span className="gp-action-btn__inner-shadow" aria-hidden="true" />
      <span className="gp-action-btn__border" aria-hidden="true" />

      <span className="gp-action-btn__content">
        <span className="gp-action-btn__icon-wrap" aria-hidden="true">
          {icon ?? (
            <img src={ICON_PATH[kind]} alt="" className="gp-action-btn__icon" />
          )}
        </span>

        <span className="gp-action-btn__divider" aria-hidden="true" />

        <span className="gp-action-btn__text">
          <strong>{label}</strong>
          {subLabel && <small>{subLabel}</small>}
        </span>
      </span>

      <span className="gp-action-btn__disabled-wash" aria-hidden="true" />
    </button>
  );
}
