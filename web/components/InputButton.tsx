import { MouseEventHandler, ReactNode } from "react";
import classNames from "classnames";

// Game action keys (call / bet / all-in / fold). They are deliberately their
// own small system (see `.action-key*` in styles/index.css) rather than the
// toolbar `btn` variants: thumb-sized targets, dark-gold edged charcoal, and
// one risk colour per action so the bar reads at a glance. A small icon
// (16–20px) sits before the label to lower recognition effort.
export type ActionVariant = "call" | "bet" | "allin" | "fold" | "neutral";

type buttonProps = {
  action: MouseEventHandler<HTMLButtonElement>;
  title: string;
  disabled: boolean;
  variant?: ActionVariant;
  icon?: ReactNode;
  className?: string;
  /** Legacy alias for variant="fold". */
  danger?: boolean;
};

export default function InputButton({
  action,
  title,
  disabled,
  variant,
  icon,
  className,
  danger = false,
}: buttonProps) {
  const v: ActionVariant = variant ?? (danger ? "fold" : "call");
  return (
    <button
      className={classNames("action-key", `action-key-${v}`, className)}
      onClick={action}
      disabled={disabled}
    >
      {icon && (
        <span className="flex h-4 w-4 items-center justify-center sm:h-5 sm:w-5">
          {icon}
        </span>
      )}
      {title}
    </button>
  );
}
