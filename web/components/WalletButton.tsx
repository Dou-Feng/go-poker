import { useContext } from "react";
import { useTranslation } from "../hooks/useTranslation";
import { AppContext } from "../providers/AppStore";
import RoomBalanceButton from "./RoomBalanceButton";

type WalletButtonProps = {
  onOpen: () => void;
};

export default function WalletButton({ onOpen }: WalletButtonProps) {
  const { t } = useTranslation();
  const { appState } = useContext(AppContext);

  return (
    <RoomBalanceButton
      amount={appState.chips ?? 0}
      label={t("tapToRecharge")}
      onClick={onOpen}
      icon={
        <img
          src="/icons/dollar.svg"
          alt=""
          draggable={false}
          aria-hidden
          className="h-4 w-4 shrink-0"
        />
      }
    />
  );
}
