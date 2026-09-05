import { useContext } from "react";
import { AppContext } from "../providers/AppStore";
import { useTranslation } from "../hooks/useTranslation";
import Scoreboard, { ScoreRow } from "./Scoreboard";

// Final scoreboard when the session ends (hand limit or surrender vote). Same
// table as the live "战绩" panel, plus the biggest pot of the session.
export default function Settlement() {
  const { appState, dispatch } = useContext(AppContext);
  const { t } = useTranslation();
  const settlement = appState.settlement;

  if (!settlement) {
    return null;
  }

  const rows: ScoreRow[] = settlement.players.map((p, i) => ({
    key: (p.uuid || p.username) + "-" + i,
    username: p.username,
    uuid: p.uuid,
    avatar: p.avatar,
    avatarImage: p.avatarImage,
    buyIn: p.buyIn,
    // The server sends buy-in and net; chips at the end is their sum.
    stack: p.buyIn + p.net,
  }));

  return (
    <Scoreboard
      title={t("settlement")}
      rows={rows}
      biggestPot={{
        winner: settlement.biggestPotWinner,
        amount: settlement.biggestPotAmount,
      }}
      onClose={() => dispatch({ type: "setSettlement", payload: null })}
    />
  );
}
