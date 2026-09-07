import { useState } from "react";
import { FiLink } from "react-icons/fi";
import { useTranslation } from "../hooks/useTranslation";
import { TableLayout } from "../lib/tableLayout";
import { WAITING_CARDS_IMAGE } from "../lib/preload";
import Portal from "./Portal";
import ui from "../styles/Dialog.module.css";

type TableWaitingProps = {
  layout: TableLayout;
  maxPlayers: number;
  playerCount: number;
  roomName: string;
};

export default function TableWaiting({
  layout,
  maxPlayers,
  playerCount,
  roomName,
}: TableWaitingProps) {
  const { t } = useTranslation();
  const [manualInvite, setManualInvite] = useState("");
  const [copied, setCopied] = useState(false);
  // Scale the 204x290px card to a comfortable overlay: a touch bigger than the
  // previous 60% pass on phones, and larger on wide/PC tables so the text stays
  // readable instead of capping at the small phone size. The two inline claims
  // keep it inside the felt (never taller than half the scene).
  const maxScale = layout.large ? 1.1 : 0.9;
  const widthClaim = maxPlayers >= 7 ? 0.32 : layout.large ? 0.34 : 0.36;
  const scale = Math.min(
    maxScale,
    (layout.width * widthClaim) / 204,
    (layout.height * 0.5) / 290
  );

  const invite = async () => {
    const url = new URL(window.location.pathname, window.location.origin).href;
    const text = `${t("roomInvitation")} ${roomName}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "GoPoker", text, url });
        return;
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError") return;
      }
    }
    const invitation = `${text}\n${url}`;
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(invitation);
      setCopied(true);
    } catch {
      // HTTP deployments and denied clipboard access still offer a selectable
      // invitation, rather than reporting a copy that failed.
      setManualInvite(invitation);
    }
  };

  return (
    <>
      <div
        className="table-waiting-anchor"
        style={{ top: `${layout.centerY}%` }}
      >
        <section
          className="table-waiting"
          style={{ transform: `scale(${scale})` }}
          aria-label={t("waitingForPlayers")}
        >
          <img
            className="table-waiting-art"
            src={WAITING_CARDS_IMAGE}
            alt=""
            aria-hidden="true"
            draggable={false}
          />
          <h2>
            {t(playerCount < 2 ? "waitingForPlayers" : "waitingForReady")}
          </h2>
          <p className="table-waiting-hint">
            {playerCount < 2 ? (
              <>
                {t("gatherPlayersPrefix")} <strong>2–{maxPlayers}</strong>{" "}
                {t("gatherPlayersSuffix")}
              </>
            ) : (
              t("allPlayersReadyHint")
            )}
          </p>
          <div className="table-waiting-divider" aria-hidden="true">
            <span>♠</span>
          </div>
          <button className="table-waiting-invite" onClick={invite}>
            <FiLink aria-hidden="true" />
            {t(copied ? "invitationCopied" : "inviteFriends")}
          </button>
        </section>
      </div>
      {manualInvite && (
        <Portal>
          <div className={ui.overlay}>
            <div
              className="table-invite-dialog"
              role="dialog"
              aria-modal="true"
              aria-label={t("inviteFriends")}
            >
              <h2>{t("inviteFriends")}</h2>
              <label htmlFor="room-invitation">
                {t("copyInvitationManually")}
              </label>
              <textarea
                id="room-invitation"
                value={manualInvite}
                readOnly
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                className="btn btn-confirm"
                onClick={() => setManualInvite("")}
              >
                {t("close")}
              </button>
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}
