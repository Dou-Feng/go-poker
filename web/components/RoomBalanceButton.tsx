import { ReactNode, Ref } from "react";
import { FiPlus } from "react-icons/fi";
import { WALLET_FRAME_IMAGE } from "../lib/preload";

type RoomBalanceButtonProps = {
  amount: number;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  expanded?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
};

// Wallet and table stack share one button so their sizing and frame stay aligned.
export default function RoomBalanceButton({
  amount,
  label,
  icon,
  onClick,
  expanded,
  buttonRef,
}: RoomBalanceButtonProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      aria-label={`${label}: ${amount}`}
      aria-expanded={expanded}
      title={`${label}: ${amount}`}
      className="relative inline-grid h-9 w-28 grid-cols-[auto_1fr_auto] items-center gap-1 overflow-hidden rounded-md bg-card/60 px-3 text-amber-300 shadow transition-colors hover:bg-cardhi/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 sm:w-32"
    >
      {icon}
      <span className="type-num min-w-0 truncate text-center text-sm leading-none">
        {amount}
      </span>
      <FiPlus size={14} className="justify-self-end" aria-hidden="true" />
      <img
        src={WALLET_FRAME_IMAGE}
        alt=""
        aria-hidden
        draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
    </button>
  );
}
