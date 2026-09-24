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
      className="border-white/15 flex items-center gap-3 rounded-xl border bg-slate-900 px-4 py-3 text-sm text-white shadow-xl"
    >
      <span
        aria-hidden="true"
        className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-white/25 border-t-cyan-300"
      />
      <span>{t(message)}</span>
    </div>
  );
  return appState.table ? (
    <div
      className="bg-slate-950/60 fixed inset-0 z-[100] flex items-center justify-center p-4"
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
