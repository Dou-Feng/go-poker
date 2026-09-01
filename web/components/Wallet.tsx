import React, { useContext } from "react";
import { AppContext } from "../providers/AppStore";
import { useSocket } from "../hooks/useSocket";
import { rebuy } from "../actions/actions";
import { useTranslation } from "../hooks/useTranslation";

export default function Wallet() {
    const socket = useSocket();
    const { appState } = useContext(AppContext);
    const { t } = useTranslation();

    const player = appState.game?.players.find((p) => p.uuid === appState.clientID);
    const buyIn = appState.game?.config.buyIn ?? 200;
    const atMax =
        !!player &&
        !!appState.game &&
        appState.game.config.maxBuy > 0 &&
        player.stack >= appState.game.config.maxBuy;
    const canRebuy = !!player && !player.in && !atMax;

    return (
        <div className="flex flex-col items-end">
            <p className="text-neutral-400">
                {t("chips")}: <span className="text-white">{appState.chips ?? 0}</span>
            </p>
            {canRebuy && (
                <button
                    onClick={() => socket && rebuy(socket, buyIn)}
                    className="mt-1 rounded-sm bg-emerald-800 px-2 py-1 text-xs text-white hover:bg-emerald-700"
                >
                    {t("rebuy")} +{buyIn}
                </button>
            )}
            {atMax && (
                <p className="mt-1 text-xs text-neutral-500">{t("maxBuyInReached")}</p>
            )}
        </div>
    );
}
