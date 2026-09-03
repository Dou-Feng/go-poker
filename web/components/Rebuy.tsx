import { useContext, useState } from "react";
import { AppContext } from "../providers/AppStore";
import { useSocket } from "../hooks/useSocket";
import { useTranslation } from "../hooks/useTranslation";
import { rebuy } from "../actions/actions";
import PlusIcon from "./PlusIcon";

export default function Rebuy() {
  const socket = useSocket();
  const { appState } = useContext(AppContext);
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
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

  if (remaining <= 0) {
    return null;
  }

  const increment = () => setAmount((a) => Math.min(a + buyIn, remaining));
  const decrement = () => setAmount((a) => Math.max(a - buyIn, 0));

  const handleRebuy = () => {
    if (!socket || amount <= 0) {
      return;
    }
    rebuy(socket, amount);
    setAmount(0);
    setShow(false);
  };

  return (
    <div className="pointer-events-auto absolute bottom-64 right-2 z-30 flex flex-col items-end gap-1 sm:bottom-72">
      {show && (
        <div className="rounded-lg border border-zinc-600 bg-zinc-900/95 p-2 shadow-lg">
          <div className="flex flex-row items-center gap-2">
            <button
              onClick={decrement}
              disabled={amount <= 0}
              aria-label="-"
              className="h-9 w-9 rounded-md bg-zinc-700 text-xl font-bold text-white hover:bg-zinc-600 disabled:opacity-40"
            >
              −
            </button>
            <span className="min-w-16 text-center font-mono text-lg font-semibold text-amber-300">
              {amount}
            </span>
            <button
              onClick={increment}
              disabled={amount >= remaining}
              aria-label="+"
              className="h-9 w-9 rounded-md bg-zinc-700 text-xl font-bold text-white hover:bg-zinc-600 disabled:opacity-40"
            >
              +
            </button>
          </div>
          <button
            onClick={handleRebuy}
            disabled={amount <= 0}
            className="mt-2 w-full rounded-md bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
          >
            {t("rebuy")}
          </button>
        </div>
      )}
      <button
        onClick={() => {
          setAmount(0);
          setShow((s) => !s);
        }}
        className="inline-flex flex-row items-center gap-1.5 rounded-sm border border-neutral-500 bg-zinc-900/80 px-3 py-1.5 text-sm font-semibold text-neutral-300 hover:bg-neutral-700"
      >
        <PlusIcon className="h-4 w-4" />
        {t("rebuy")}
      </button>
    </div>
  );
}
