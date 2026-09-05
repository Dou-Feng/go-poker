import { MouseEventHandler } from "react";
import classNames from "classnames";

// Game action keys (call / bet / all-in / fold). They are deliberately their
// own small system (see `.action-key*` in styles/index.css) rather than the
// toolbar `btn` variants: same surface ladder and radius, but bigger touch
// targets and one colour per action so the bar reads at a glance.
export type ActionVariant = "call" | "bet" | "allin" | "fold" | "neutral";

type buttonProps = {
  action: MouseEventHandler<HTMLButtonElement>;
  title: string;
  disabled: boolean;
  variant?: ActionVariant;
  /** Legacy alias for variant="fold". */
  danger?: boolean;
};

export default function InputButton({
  action,
  title,
  disabled,
  variant,
  danger = false,
}: buttonProps) {
  const v: ActionVariant = variant ?? (danger ? "fold" : "call");
  const className = classNames("action-key", `action-key-${v}`);
  return (
    <button className={className} onClick={action} disabled={disabled}>
      {title}
    </button>
  );
}
