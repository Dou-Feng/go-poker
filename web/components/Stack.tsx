import { useContext, useState } from "react";
import { AppContext } from "../providers/AppStore";
import { useTranslation } from "../hooks/useTranslation";
import Chip from "./Chip";
import Rebuy from "./Rebuy";

// The player's table stack in the top-right. Tapping it drops down the rebuy
// panel ("- amount +").
export default function Stack() {
  const { appState } = useContext(AppContext);
  const { t } = useTranslation();
  const [showRebuy, setShowRebuy] = useState(false);

  const game = appState.game;
  const me = game?.players.find((p) => p.uuid === appState.clientID);
  if (!game || !me) {
    return null;
  }

  return (
    <div className="relative flex flex-col items-end">
      <button
        onClick={() => setShowRebuy((s) => !s)}
        aria-label={`${t("rebuy")}: ${me.stack}`}
        title={t("rebuy")}
        className="inline-flex w-20 flex-row items-center justify-between rounded-md bg-card/60 px-2.5 py-1 text-sm text-amber-300 shadow hover:bg-cardhi/60"
      >
        <Chip className="h-4 w-4" amount={me.stack} />
        <span className="type-num leading-none">{me.stack}</span>
      </button>
      {showRebuy && (
        <div className="absolute right-0 top-full z-50 mt-1 w-44">
          <Rebuy onDone={() => setShowRebuy(false)} />
        </div>
      )}
    </div>
  );
}
