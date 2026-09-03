import { useContext } from "react";
import { startGame } from "../actions/actions";
import { useSocket } from "../hooks/useSocket";
import { AppContext } from "../providers/AppStore";
import { useTranslation } from "../hooks/useTranslation";

function handleStartGame(socket: WebSocket | null) {
  if (socket) {
    startGame(socket);
  }
}

export default function Start() {
  const socket = useSocket();
  const { appState } = useContext(AppContext);
  const { t } = useTranslation();
  const game = appState.game;
  const readyCount = game?.readyCount ?? 0;

  if (!game) {
    return null;
  }

  if (!game.running && readyCount < 2) {
    return (
      <div
        className=" m-1 rounded-sm border border-2 border-neutral-400 p-2 px-4 py-2 text-xl font-light text-neutral-300 opacity-10 sm:m-10 sm:text-2xl"
        title={t("mustHaveTwoPlayers")}
      >
        {t("start")}
      </div>
    );
  }

  if (!game.running && readyCount >= 2) {
    return (
      <button
        className=" m-1 rounded-sm border border-2 border-neutral-400 p-2 px-4 py-2 text-xl font-normal text-neutral-300 hover:underline sm:m-10 sm:text-2xl"
        onClick={() => handleStartGame(socket)}
      >
        {t("start")}
      </button>
    );
  }

  return null;
}
