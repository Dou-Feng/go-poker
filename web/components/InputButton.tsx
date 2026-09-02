import { MouseEventHandler } from "react";
import classNames from "classnames";

type buttonProps = {
  action: MouseEventHandler<HTMLButtonElement>;
  title: string;
  disabled: boolean;
  danger?: boolean;
};

const getAction = (danger: boolean, disabled: boolean) => {
  return classNames(
    {
      "text-rose-600 border-rose-600 font-semibold": danger,
      "text-emerald-500 border-emerald-500 font-normal": !danger,
      "opacity-20 ": disabled,
    },

    "mx-0.5 rounded-xl border-2 px-2.5 py-2 text-base sm:px-3 sm:text-lg"
  );
};

export default function InputButton({
  action,
  title,
  disabled,
  danger = false,
}: buttonProps) {
  if (disabled) {
    return <div className={getAction(danger, disabled)}>{title}</div>;
  }
  return (
    <button className={getAction(danger, disabled)} onClick={action}>
      {title}
    </button>
  );
}
