import { useContext } from "react";
import { AppContext } from "../providers/AppStore";
import SettlementModal, { SettlementPlayer } from "./SettlementModal";

// End-of-session result takeover (hand limit or surrender vote), installed
// from tmp/new_settlement: winner hero + chip-flow rows + biggest pot.
// "Leave room" runs the same teardown as the in-game leave button, which the
// room (Game) supplies via onLeaveRoom.
type settlementProps = {
  onLeaveRoom?: () => void;
};

export default function Settlement({ onLeaveRoom }: settlementProps) {
  const { appState, dispatch } = useContext(AppContext);
  const settlement = appState.settlement;

  if (!settlement) {
    return null;
  }

  const close = () => dispatch({ type: "setSettlement", payload: null });
  const leaveRoom = () => {
    onLeaveRoom?.();
    close();
  };

  const players: SettlementPlayer[] = settlement.players.map((p) => ({
    id: p.uuid || p.username,
    name: p.username,
    avatar: p.avatar || "🙂",
    avatarImage: p.avatarImage,
    avatarUuid: p.uuid,
    // Cache-bust only the current user's freshly uploaded picture.
    avatarVersion:
      p.uuid === appState.uuid ? appState.avatarVersion : undefined,
    buyIn: p.buyIn,
    // Everyone has cashed out at settlement: end chips = buy-in + net.
    endingChips: p.buyIn + p.net,
  }));

  // Rank by net (profit) descending: first place is the session winner and
  // the list is shown from the biggest winner to the biggest loser. The
  // biggest-pot line may be a different player (the server sends a
  // name/uuid — match either).
  const ranked = [...players].sort(
    (a, b) => b.endingChips - b.buyIn - (a.endingChips - a.buyIn)
  );
  const winner = ranked[0];
  const biggestPotPlayer =
    players.find(
      (p) =>
        p.name === settlement.biggestPotWinner ||
        p.id === settlement.biggestPotWinner
    ) ?? players[0];

  return (
    <SettlementModal
      players={ranked}
      winnerId={winner?.id ?? ""}
      biggestPotPlayerId={biggestPotPlayer?.id ?? ""}
      biggestPot={settlement.biggestPotAmount}
      onLeaveRoom={leaveRoom}
      onNextHand={close}
    />
  );
}
