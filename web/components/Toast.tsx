import { useContext, useEffect } from "react";
import { AppContext } from "../providers/AppStore";
import { useTranslation } from "../hooks/useTranslation";

// Bottom-centre toasts: a red one for server/client errors (appState.authError,
// a raw server message translated via tError) and a neutral one for plain
// notices (appState.notice, a translation key). Both dismiss themselves.
export default function Toast() {
  const { appState, dispatch } = useContext(AppContext);
  const { t, tError } = useTranslation();
  const error = appState.authError;
  const notice = appState.notice;

  useEffect(() => {
    if (!error) {
      return;
    }
    const timer = setTimeout(() => {
      dispatch({ type: "setAuthError", payload: null });
    }, 3500);
    return () => clearTimeout(timer);
  }, [error, dispatch]);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = setTimeout(() => {
      dispatch({ type: "setNotice", payload: null });
    }, 3500);
    return () => clearTimeout(timer);
  }, [notice, dispatch]);

  if (!error && !notice) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[70] flex -translate-x-1/2 flex-col items-center gap-2">
      {notice && (
        <div
          role="status"
          className="rounded-lg border border-amber-300/60 bg-tablehi/95 px-5 py-2.5 text-sm font-medium text-ink shadow-xl"
        >
          {t(notice)}
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-lg bg-rose-600 px-5 py-2.5 text-sm font-medium text-ink shadow-xl"
        >
          {tError(error)}
        </div>
      )}
    </div>
  );
}
