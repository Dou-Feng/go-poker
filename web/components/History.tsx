import { useContext } from "react";
import { AppContext } from "../providers/AppStore";
import { useSocket } from "../hooks/useSocket";
import { getUser } from "../actions/actions";
import { useTranslation } from "../hooks/useTranslation";
import Avatar from "./Avatar";

function formatTime(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) {
        return iso;
    }
    return d.toLocaleString();
}

export default function History() {
    const { appState } = useContext(AppContext);
    const socket = useSocket();
    const { t } = useTranslation();
    const records = appState.history ?? [];

    return (
        <div className="flex w-full max-w-md flex-col gap-2">
            <p className="text-sm text-neutral-500">{t("history")}</p>
            {records.length === 0 && (
                <p className="text-sm text-neutral-600">{t("noHistory")}</p>
            )}
            {records.map((rec, i) => (
                <button
                    key={i}
                    onClick={() => socket && getUser(socket, rec.username)}
                    className="flex flex-row items-center justify-between rounded-sm bg-neutral-800 px-4 py-2 text-left hover:bg-neutral-700"
                >
                    <div className="flex flex-row items-center gap-3">
                        <Avatar
                            username={rec.username}
                            emoji={rec.avatar || "🙂"}
                            hasImage={rec.avatarImage}
                            size={28}
                        />
                        <div className="flex flex-col">
                            <p className="text-white">{rec.username}</p>
                            <p className="text-xs text-neutral-500">
                                {rec.room} · {formatTime(rec.time)}
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-col items-end">
                        <p
                            className={`text-sm font-semibold ${
                                rec.net >= 0 ? "text-emerald-400" : "text-rose-400"
                            }`}
                        >
                            {rec.net >= 0 ? "+" : ""}
                            {rec.net}
                        </p>
                        <p className="text-xs text-neutral-500">
                            {t("handsPlayed")}: {rec.stats.handsPlayed}
                        </p>
                    </div>
                </button>
            ))}
        </div>
    );
}
