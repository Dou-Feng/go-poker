import { useContext } from "react";
import { useTranslation } from "../hooks/useTranslation";
import { AppContext } from "../providers/AppStore";

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
      className="inline-flex w-20 flex-row items-center justify-between rounded-md bg-card/60 px-2.5 py-1 text-sm font-medium text-amber-300 shadow hover:bg-cardhi/60"
    >
      <img
        src="/dollar.svg"
        alt=""
        draggable={false}
        aria-hidden
        className="h-4 w-4"
      />
      <span className="type-num leading-none">{appState.chips ?? 0}</span>
    </button>
  );
}
