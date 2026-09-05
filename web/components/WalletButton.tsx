import { useContext } from "react";
import { AppContext } from "../providers/AppStore";

type WalletButtonProps = {
  onOpen: () => void;
};

export default function WalletButton({ onOpen }: WalletButtonProps) {
  const { appState } = useContext(AppContext);

  return (
    <button
      onClick={onOpen}
      className="inline-flex w-20 flex-row items-center justify-between rounded-md bg-card/90 px-2.5 py-1 text-sm font-medium text-amber-300 shadow hover:bg-floor"
    >
      <img
        src="/wallet.svg"
        alt=""
        draggable={false}
        aria-hidden
        className="h-4 w-4"
      />
      <span className="type-num leading-none">
        {appState.chips ?? 0}
      </span>
    </button>
  );
}
