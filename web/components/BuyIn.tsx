import { useContext } from "react";
import { takeSeat, sendLog } from "../actions/actions";
import { useSocket } from "../hooks/useSocket";
import { AppContext } from "../providers/AppStore";
import { FcCheckmark } from "react-icons/fc";
import { useTranslation } from "../hooks/useTranslation";

type buyInProps = {
    seatID: number;
    onClose: () => void;
};

export default function BuyIn({ seatID, onClose }: buyInProps) {
    const socket = useSocket();
    const { appState } = useContext(AppContext);
    const { t } = useTranslation();

    // The buy-in amount is fixed per room.
    const buyIn = appState.game?.config.buyIn ?? 200;

    const handleSitDown = () => {
        if (socket && appState.username) {
            takeSeat(socket, appState.username, seatID, buyIn);
            sendLog(socket, appState.username + " buys in for " + buyIn);
        }
        onClose();
    };
    return (
        <div className="relative right-1 m-4 flex h-full w-full flex-col items-start justify-center">
            <p className="-mb-1 text-lg font-semibold">{appState.username}</p>
            <div className="flex flex-row items-center">
                <p>
                    {t("buyIn")} {buyIn}
                </p>
                <button onClick={handleSitDown} className="ml-3 text-2xl">
                    <FcCheckmark />
                </button>
            </div>
        </div>
    );
}
