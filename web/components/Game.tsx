import { useContext } from "react";
import ChatLog from "./ChatLog";
import GameInfo from "./GameInfo";
import Start from "./Start";
import Input from "./Input";
import Table from "./Table";
import Wallet from "./Wallet";
import { AppContext } from "../providers/AppStore";
import { useSocket } from "../hooks/useSocket";
import { useTranslation } from "../hooks/useTranslation";
import { leaveTable } from "../actions/actions";
import { clearSession } from "../lib/session";

export default function Game() {
    const { appState, dispatch } = useContext(AppContext);
    const socket = useSocket();
    const { t } = useTranslation();

    const handleLeave = () => {
        clearSession();
        if (socket && appState.table) {
            leaveTable(socket, appState.table);
        }
        dispatch({ type: "leaveRoom" });
    };

    const game = appState.game;
    const me = game?.players.find((p) => p.uuid === appState.clientID);
    const buyIn = game?.config.buyIn ?? 0;
    const maxBuyIns = buyIn > 0 ? Math.floor((game?.config.maxBuy ?? 0) / buyIn) : 0;
    const usedBuyIns = buyIn > 0 ? Math.floor((me?.totalBuyIn ?? 0) / buyIn) : 0;
    const remainingBuyIns = Math.max(0, maxBuyIns - usedBuyIns);

    return (
        <div className="relative h-screen w-screen overflow-hidden">
            <div className="flex h-screen w-screen items-start justify-center">
                <Table />
            </div>
            {!appState.clientID && appState.game && (
                <div className="absolute left-1/2 top-0 z-40 -translate-x-1/2 rounded-b-lg bg-zinc-900/80 px-4 py-1.5 text-sm font-medium text-neutral-200">
                    {appState.game.running ? t("spectating") : t("pickSeat")}
                </div>
            )}
            {me && game && !game.running && !me.ready && (
                <div className="absolute left-1/2 top-0 z-40 flex -translate-x-1/2 flex-col items-center rounded-b-lg bg-zinc-900/80 px-4 py-1.5">
                    <p className="text-sm font-medium text-white">{t("clickAvatarToReady")}</p>
                    {maxBuyIns > 0 && (
                        <p className="text-xs text-neutral-400">
                            {t("buyInsLeft")}: {remainingBuyIns}
                        </p>
                    )}
                </div>
            )}
            <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col sm:block">
                <div className="w-full sm:absolute sm:inset-x-0 sm:bottom-0 sm:z-20">
                    <Input />
                </div>
                <div className="w-full sm:absolute sm:bottom-0 sm:left-0 sm:right-auto sm:z-10">
                    <ChatLog />
                </div>
            </div>
            <div className="absolute left-0 top-0 z-10 flex flex-row items-center">
                <button
                    onClick={handleLeave}
                    className="m-2 rounded-sm border border-rose-600 px-3 py-1.5 text-sm font-semibold text-rose-500 hover:bg-rose-600 hover:text-white"
                >
                    {t("leave")}
                </button>
            </div>
            <div className="absolute top-0 right-0 z-10 flex flex-col items-end gap-2 p-2">
                <GameInfo />
                <Wallet />
            </div>
            <div className="absolute bottom-0 right-0 z-30">
                <Start />
            </div>
        </div>
    );
}
