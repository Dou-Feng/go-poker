import { useContext, useState } from "react";
import { AppContext } from "../providers/AppStore";
import { useSocket } from "../hooks/useSocket";
import { useTranslation } from "../hooks/useTranslation";
import { rebuy } from "../actions/actions";

// Rebuy panel: a "- amount +" control plus the rebuy button. Rendered inline
// by the table-stack chip count in the top-right; the parent controls when it
// is visible.
export default function Rebuy() {
  const socket = useSocket();
  const { appState } = useContext(AppContext);
  const { t } = useTranslation();
  const [amount, setAmount] = useState(0);

  const game = appState.game;
  const me = game?.players.find((p) => p.uuid === appState.clientID);
  if (!game || !me) {
    return null;
  }

  const buyIn = game.config.buyIn ?? 200;
  const maxBuy = game.config.maxBuy ?? 0;
  const remaining =
    maxBuy > 0 ? Math.max(0, maxBuy - me.totalBuyIn) : Number.MAX_SAFE_INTEGER;

  const increment = () => setAmount((a) => Math.min(a + buyIn, remaining));
  const decrement = () => setAmount((a) => Math.max(a - buyIn, 0));

  const handleRebuy = () => {
    if (!socket || amount <= 0) {
      return;
    }
    rebuy(socket, amount);
    setAmount(0);
  };

  return (
    <div className="rounded-lg border border-muted/30 bg-tablehi/95 p-2 shadow-lg">
      <div className="flex flex-row items-center justify-center gap-2">
        <button
          onClick={decrement}
          disabled={amount <= 0}
          aria-label={t("decreaseBuyIn")}
          className="btn btn-secondary h-9 w-9 rounded-md px-0 text-xl font-bold"
        >
          −
        </button>
        <span className="min-w-16 type-num text-center text-lg text-amber-300">
          {amount}
        </span>
        <button
          onClick={increment}
          disabled={amount >= remaining}
          aria-label={t("increaseBuyIn")}
          className="btn btn-secondary h-9 w-9 rounded-md px-0 text-xl font-bold"
        >
          +
        </button>
      </div>
      <button
        onClick={handleRebuy}
        disabled={amount <= 0}
        className="btn btn-room-control mt-2 w-full"
      >
        {t("rebuy")}
      </button>
    </div>
  );
}
