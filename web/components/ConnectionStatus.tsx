import { useContext } from "react";
import { AppContext } from "../providers/AppStore";
import { ConnectionContext } from "../providers/WebSocket";
import { useTranslation } from "../hooks/useTranslation";

export default function ConnectionStatus() {
  const status = useContext(ConnectionContext);
  const { appState } = useContext(AppContext);
  const { t } = useTranslation();
  if (status === "connected") return null;

  const message =
    status === "disconnected"
      ? "connectionUnavailable"
      : status === "connecting"
      ? "connecting"
      : "reconnecting";
  const content = (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2.5 rounded-xl bg-slate-900/60 px-4 py-2.5 text-sm text-slate-100 shadow-md shadow-black/10 backdrop-blur-sm"
    >
      <span
        aria-hidden="true"
        className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-white/20 border-t-cyan-200/80"
      />
      <span>{t(message)}</span>
    </div>
  );
  return appState.table ? (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/10 p-4"
      aria-busy="true"
    >
      {content}
    </div>
  ) : (
    <div className="pointer-events-none fixed left-1/2 top-3 z-[100] w-max max-w-[calc(100%-24px)] -translate-x-1/2">
      {content}
    </div>
  );
}
