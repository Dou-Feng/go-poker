import { useContext } from "react";
import { AppContext } from "../providers/AppStore";

export default function Pot() {
  const { appState } = useContext(AppContext);
  const game = appState.game;
  if (!game) {
    return null;
  }

  // The pot equals the sum of every player's committed chips (totalBet),
  // which updates in real time as bets are placed and cannot be taken back.
  const total = (game.players ?? []).reduce(
    (sum, p) => sum + (p.totalBet ?? 0),
    0
  );

  return (
    <div className="flex flex-col">
      <p className="flex h-10 w-24 flex-col items-center justify-center rounded-3xl bg-green-900 text-2xl font-semibold text-white">
        {total}
      </p>
    </div>
  );
}
