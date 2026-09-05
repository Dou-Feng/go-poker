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

  // A translucent pill over the felt rather than a solid dark disc (which
  // read as a hole in the table): the felt texture shows through and only the
  // number is emphasised.
  return (
    <div className="flex flex-col">
      <p className="type-num flex h-9 min-w-[5.5rem] flex-col items-center justify-center rounded-full border border-white/10 bg-black/25 px-4 text-xl text-amber-200 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] sm:h-10 sm:text-2xl">
        {total}
      </p>
    </div>
  );
}
