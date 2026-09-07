import { useContext } from "react";
import { useTranslation } from "../hooks/useTranslation";
import { AppContext } from "../providers/AppStore";
import { WALLET_FRAME_IMAGE } from "../lib/preload";

type WalletButtonProps = {
  onOpen: () => void;
};

export default function WalletButton({ onOpen }: WalletButtonProps) {
  const { t } = useTranslation();
  const { appState } = useContext(AppContext);

  return (
    <button
      onClick={onOpen}
      aria-label={`${t("chips")}: ${appState.chips ?? 0}`}
      className="relative inline-flex w-20 flex-row items-center justify-between overflow-hidden rounded-md bg-card/60 px-2.5 py-1 text-sm font-medium text-amber-300 shadow hover:bg-cardhi/60"
    >
      <img
        src="/icons/dollar.svg"
        alt=""
        draggable={false}
        aria-hidden
        className="h-4 w-4"
      />
      <span className="type-num leading-none">{appState.chips ?? 0}</span>
      {/* Gold bracket frame (transparent interior) drawn over the button
          without touching its own surface, colour or opacity. */}
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
