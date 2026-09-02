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
      className="inline-flex flex-row items-center gap-1.5 rounded-md bg-zinc-800/90 px-2.5 py-1 text-sm font-medium text-white shadow hover:bg-zinc-700"
    >
      <span aria-hidden>💰</span>
      <span>{appState.chips ?? 0}</span>
      <span className="font-semibold text-emerald-400">+</span>
    </button>
  );
}
