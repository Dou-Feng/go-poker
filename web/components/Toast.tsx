import { useContext, useEffect } from "react";
import { AppContext } from "../providers/AppStore";
import { useTranslation } from "../hooks/useTranslation";

export default function Toast() {
    const { appState, dispatch } = useContext(AppContext);
    const { tError } = useTranslation();
    const message = appState.authError;

    useEffect(() => {
        if (!message) {
            return;
        }
        const timer = setTimeout(() => {
            dispatch({ type: "setAuthError", payload: null });
        }, 3500);
        return () => clearTimeout(timer);
    }, [message, dispatch]);

    if (!message) {
        return null;
    }

    return (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-[70] -translate-x-1/2">
            <div className="rounded-lg bg-rose-600 px-5 py-2.5 text-sm font-medium text-white shadow-xl">
                {tError(message)}
            </div>
        </div>
    );
}
