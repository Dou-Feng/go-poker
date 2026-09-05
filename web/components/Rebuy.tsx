import { useContext, useState } from "react";
import { AppContext } from "../providers/AppStore";
import { useSocket } from "../hooks/useSocket";
import { useTranslation } from "../hooks/useTranslation";
import { rebuy } from "../actions/actions";
import PlusIcon from "./PlusIcon";
import classNames from "classnames";

type rebuyProps = {
  /** Extra classes for the trigger button (the menu stretches it). */
  className?: string;
};

// Rebuy control: a trigger button plus a +/- amount panel that opens above
// it. Positioning is left to the parent (it lives inside RoomMenu).
export default function Rebuy({ className }: rebuyProps) {
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
    <div className="relative flex flex-col items-stretch gap-1">
      {show && (
        <div className="rounded-lg border border-muted/30 bg-tablehi/95 p-2 shadow-lg">
          <div className="flex flex-row items-center gap-2">
            <button
              onClick={decrement}
              disabled={amount <= 0}
              aria-label="-"
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
              aria-label="+"
              className="btn btn-secondary h-9 w-9 rounded-md px-0 text-xl font-bold"
            >
              +
            </button>
          </div>
          <button
            onClick={handleRebuy}
            disabled={amount <= 0}
            className="btn btn-accent mt-2 w-full"
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
        className={classNames("btn btn-ghost", className)}
      >
        <PlusIcon className="h-4 w-4" />
        {t("rebuy")}
      </button>
    </div>
  );
}
