import {
  useContext,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { AppContext } from "../providers/AppStore";
import { Profile as ProfileType, PlayerStats } from "../interfaces";
import { useTranslation } from "../hooks/useTranslation";
import { useSocket } from "../hooks/useSocket";
import { TranslationKey } from "../lib/translations";
import { addFriend, changeUsername, getUser } from "../actions/actions";
import { API_BASE } from "../lib/api";
import { useVoice } from "../hooks/useVoice";
import { voice } from "../lib/voice";
import Avatar from "./Avatar";
import MicIcon from "./MicIcon";
import PlusIcon from "./PlusIcon";
import {
  FiArrowLeft,
  FiChevronRight,
  FiCheck,
  FiEdit2,
  FiX,
} from "react-icons/fi";
import ui from "../styles/Dialog.module.css";
import s from "../styles/ProfileCard.module.css";

function rate(n: number, d: number): string {
  if (d === 0) {
    return "—";
  }
  return Math.round((n / d) * 100) + "%";
}

const POSITION_KEYS: TranslationKey[] = [
  "posBTN",
  "posSB",
  "posBB",
  "posUTG",
  "posMP",
  "posCO",
];
const POSITION_CODES = ["BTN", "SB", "BB", "UTG", "MP", "CO"];

export default function ProfileCard() {
  const { appState, dispatch } = useContext(AppContext);
  const { t } = useTranslation();
  const socket = useSocket();
  const voiceState = useVoice();
  const profile: ProfileType | null = appState.profile;

  // Which sub-view the card shows: the summary, or the detailed stats list.
  const [view, setView] = useState<"main" | "detail">("main");
  const [showChangeUsername, setShowChangeUsername] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const editNameRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (showChangeUsername) {
      renameInputRef.current?.focus({ preventScroll: true });
      renameInputRef.current?.select();
    }
  }, [showChangeUsername]);
  const [copied, setCopied] = useState(false);
  // Drag on the room sheet handle: pull down to close.
  const dragStartY = useRef<number | null>(null);

  if (!profile) {
    return null;
  }

  const stats: PlayerStats | null = profile.stats;
  const isSelf = !!profile.uuid && profile.uuid === appState.uuid;
  const isSession = profile.net !== undefined || profile.buyIn !== undefined;
  const otherUuid = !isSelf && profile.uuid ? profile.uuid : null;
  const isFriend =
    !!otherUuid && appState.friends.some((f) => f.uuid === otherUuid);
  const peerMuted = !!otherUuid && voiceState.mutedPeers.includes(otherUuid);

  // Lobby / history / scoreboard show a centred modal; inside a room the card
  // is a bottom sheet with a drag handle instead of a close button.
  const inRoom = !!appState.table;
  const isHost =
    !!inRoom && !!profile.uuid && appState.game?.host === profile.uuid;

  const avatarEmoji = isSession
    ? profile.avatar || "🙂"
    : isSelf
    ? appState.avatar || profile.avatar || "🙂"
    : profile.avatar || "🙂";
  const avatarImage = isSession
    ? profile.avatarImage
    : isSelf
    ? appState.avatarImage
    : profile.avatarImage;
  // Avatar changes are upload-only and only from outside a room (own card in
  // the lobby); there is no default-emoji grid at this stage and in-room
  // editing is not allowed.
  const canEditAvatar = isSelf && !isSession && !inRoom;
  const canEditName = isSelf && !isSession && !inRoom;
  const finishRename = () => {
    setShowChangeUsername(false);
    setNewUsername("");
    requestAnimationFrame(() =>
      editNameRef.current?.focus({ preventScroll: true })
    );
  };

  const close = () => {
    setShowChangeUsername(false);
    setView("main");
    dispatch({ type: "setProfile", payload: null });
  };

  const copyUuid = () => {
    navigator.clipboard?.writeText(profile.uuid ?? "");
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  // Tapping your own avatar opens an OS file picker straight away; uploading
  // goes through the /api/avatar endpoint like the rest of the app.
  const handleAvatarUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !socket) {
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      dispatch({ type: "setAuthError", payload: t("fileTooLarge") });
      e.target.value = "";
      return;
    }
    const fd = new FormData();
    fd.append("uuid", appState.uuid ?? "");
    fd.append("file", file);
    try {
      const res = await fetch(`${API_BASE}/api/avatar`, {
        method: "POST",
        body: fd,
      });
      if (res.ok) {
        // Bump the version so the cached avatar image is refreshed.
        dispatch({ type: "bumpAvatar" });
        getUser(socket);
      } else {
        const text = (await res.text().catch(() => "")).trim();
        const message = text.startsWith("<") ? "" : text.slice(0, 160);
        dispatch({
          type: "setAuthError",
          payload: message || t("uploadFailed"),
        });
      }
    } catch {
      dispatch({ type: "setAuthError", payload: t("uploadFailed") });
    }
    e.target.value = "";
  };

  const notify = (key: TranslationKey) =>
    dispatch({ type: "setNotice", payload: key });

  const hands = stats?.handsPlayed ?? 0;
  const headStats: Array<{ key: TranslationKey; value: string }> = [
    { key: "handsPlayed", value: String(hands) },
    { key: "winRate", value: rate(stats?.handsWon ?? 0, hands) },
    { key: "vpip", value: rate(stats?.vpip ?? 0, hands) },
    { key: "maxPotWon", value: String(stats?.maxPotWon ?? 0) },
  ];
  const behaviorStats: Array<{ key: TranslationKey; value: string }> = [
    { key: "foldRate", value: rate(stats?.folds ?? 0, hands) },
    { key: "threeBetRate", value: rate(stats?.threeBets ?? 0, hands) },
    { key: "raises", value: String(stats?.raises ?? 0) },
    { key: "calls", value: String(stats?.calls ?? 0) },
  ];

  const handleDown = (e: React.PointerEvent) => {
    dragStartY.current = e.clientY;
  };
  const handleUp = (e: React.PointerEvent) => {
    const dy = e.clientY - (dragStartY.current ?? e.clientY);
    dragStartY.current = null;
    // A deliberate downward drag (or a simple tap) dismisses the sheet.
    if (dy > 30 || dy <= 4) {
      close();
    }
  };

  return (
    <div
      className={`${s.overlay} ${inRoom ? s.overlayRoom : ""}`}
      onClick={close}
    >
      <div
        className={`${s.sheet} ${inRoom ? s.sheetRoom : s.sheetCenter}`}
        role="dialog"
        aria-modal="true"
        aria-label={t("detailStats")}
        onClick={(e) => e.stopPropagation()}
      >
        {inRoom ? (
          <button
            className={s.handle}
            onPointerDown={handleDown}
            onPointerUp={handleUp}
            aria-label={t("close")}
            title={t("close")}
          />
        ) : (
          <div className={s.closeRow}>
            <button
              onClick={close}
              data-sfx="back"
              aria-label={t("close")}
              className={ui.iconButton}
            >
              <FiX />
            </button>
          </div>
        )}

        <div className={s.scroll}>
          {view === "main" ? (
            <>
              <div className={s.head}>
                <div className={s.avatarWrap}>
                  <span className={s.avatarRing} aria-hidden="true" />
                  {canEditAvatar ? (
                    <label
                      className="relative block cursor-pointer rounded-full hover:opacity-80"
                      title={t("uploadImage")}
                      aria-label={t("uploadImage")}
                    >
                      <Avatar
                        username={profile.username}
                        uuid={profile.uuid}
                        emoji={avatarEmoji}
                        hasImage={avatarImage}
                        size={72}
                        version={
                          isSelf && !isSession
                            ? appState.avatarVersion
                            : undefined
                        }
                      />
                      <input
                        type="file"
                        accept="image/*"
                        aria-label={t("uploadImage")}
                        className="sr-only"
                        onChange={handleAvatarUpload}
                      />
                    </label>
                  ) : (
                    <div className="relative block">
                      <Avatar
                        username={profile.username}
                        uuid={profile.uuid}
                        emoji={avatarEmoji}
                        hasImage={avatarImage}
                        size={72}
                      />
                    </div>
                  )}
                  {isHost && (
                    <span className={s.crown} title="HOST" aria-label="HOST">
                      ♛
                    </span>
                  )}
                </div>

                <div className={s.info}>
                  <div className={s.nameRow}>
                    {showChangeUsername && canEditName ? (
                      <form
                        className={s.renameForm}
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!socket || !newUsername.trim()) return;
                          changeUsername(socket, newUsername.trim());
                          finishRename();
                        }}
                        onKeyDown={(e) => {
                          if (e.nativeEvent.isComposing) {
                            if (e.key === "Enter") e.preventDefault();
                            return;
                          }
                          if (e.key === "Escape") {
                            e.preventDefault();
                            e.stopPropagation();
                            finishRename();
                          }
                        }}
                      >
                        <input
                          ref={renameInputRef}
                          type="text"
                          value={newUsername}
                          onChange={(e) => setNewUsername(e.target.value)}
                          placeholder={t("newUsername")}
                          aria-label={t("newUsername")}
                          className={s.renameInput}
                          autoComplete="off"
                        />
                        <button
                          type="submit"
                          className={`${s.editName} ${s.saveName}`}
                          disabled={!socket || !newUsername.trim()}
                          aria-label={t("change")}
                          title={t("change")}
                        >
                          <FiCheck size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={finishRename}
                          data-sfx="back"
                          aria-label={t("cancel")}
                          title={t("cancel")}
                          className={s.editName}
                        >
                          <FiX size={16} />
                        </button>
                      </form>
                    ) : (
                      <>
                        <h2 title={profile.username}>{profile.username}</h2>
                        {canEditName && (
                          <button
                            ref={editNameRef}
                            onClick={() => {
                              setNewUsername(profile.username);
                              setShowChangeUsername(true);
                            }}
                            data-sfx="pong"
                            className={s.editName}
                            aria-label={t("changeUsername")}
                            title={t("changeUsername")}
                          >
                            <FiEdit2 size={13} />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  {isSession ? (
                    <p className={s.netLine}>
                      {t("buyInLabel")}: {profile.buyIn} · {t("net")}:{" "}
                      {profile.net !== undefined && profile.net >= 0 ? "+" : ""}
                      {profile.net}
                    </p>
                  ) : (
                    <p className={s.coins}>
                      <img
                        src="/icons/dollar.svg"
                        alt=""
                        aria-hidden
                        draggable={false}
                      />
                      {profile.chips.toLocaleString()}
                    </p>
                  )}
                  {profile.uuid && (
                    <button
                      onClick={copyUuid}
                      className={s.uid}
                      title={profile.uuid}
                    >
                      <span>
                        {t("uuid")}: {profile.uuid}
                      </span>
                      <span>{copied ? "✓" : "⧉"}</span>
                    </button>
                  )}
                </div>

                {otherUuid && (
                  <div className={s.actions}>
                    <div className={s.btnRow}>
                      <button
                        onClick={() => {
                          if (isFriend || !socket) {
                            return;
                          }
                          dispatch({ type: "setAuthError", payload: null });
                          addFriend(socket, otherUuid);
                        }}
                        disabled={isFriend}
                        title={isFriend ? t("isFriend") : t("addFriend")}
                        className={`${s.action} ${s.gold}`}
                      >
                        {isFriend ? "✓" : <PlusIcon className="h-4 w-4" />}
                        {t("addFriend")}
                      </button>
                      <button
                        onClick={() => notify("messageNotSupported")}
                        title={t("messageLabel")}
                        className={s.action}
                      >
                        {t("messageLabel")}
                      </button>
                    </div>
                    {inRoom && voiceState.supported && (
                      <button
                        onClick={() => voice.toggleMutePeer(otherUuid)}
                        title={peerMuted ? t("unmuteMicFor") : t("muteMicFor")}
                        aria-pressed={peerMuted}
                        className={s.action}
                        style={{ alignSelf: "flex-start" }}
                      >
                        <MicIcon off={!peerMuted} className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className={s.stats}>
                {headStats.map(({ key, value }) => (
                  <div className={s.stat} key={key}>
                    <div className={s.statValue}>{value}</div>
                    <div className={s.statLabel}>{t(key)}</div>
                  </div>
                ))}
              </div>

              <button
                className={s.row}
                onClick={() => setView("detail")}
                data-sfx="pong"
              >
                <span className={`${s.rowIcon} ${s.blue}`}>▤</span>
                <span className={s.rowCopy}>
                  <strong>{t("detailStats")}</strong>
                  <span>{t("detailStatsHint")}</span>
                </span>
                <FiChevronRight className={s.chev} />
              </button>

              <button
                className={s.row}
                onClick={() => notify("comingSoon")}
                data-sfx="pong"
              >
                <span className={s.rowIcon}>🏅</span>
                <span className={s.rowCopy}>
                  <strong>{t("achievements")}</strong>
                  <span>{t("comingSoon")}</span>
                </span>
                <FiChevronRight className={s.chev} />
              </button>
            </>
          ) : (
            <>
              <div className={s.detailHead}>
                <button onClick={() => setView("main")} className={s.backBtn}>
                  <FiArrowLeft /> {t("goBack")}
                </button>
                <h3>{t("detailStats")}</h3>
              </div>

              <dl className={`${s.stats} ${s.detailStats}`}>
                {headStats.map(({ key, value }) => (
                  <div className={s.stat} key={key}>
                    <dd className={s.statValue}>{value}</dd>
                    <dt className={s.statLabel}>{t(key)}</dt>
                  </div>
                ))}
              </dl>

              <section className={s.detailSection}>
                <h4 className={s.detailSectionTitle}>{t("gameBehavior")}</h4>
                <dl className={`${s.detailGrid} ${s.behaviorGrid}`}>
                  {behaviorStats.map(({ key, value }) => (
                    <div className={s.detailMetric} key={key}>
                      <dd>{value}</dd>
                      <dt>{t(key)}</dt>
                    </div>
                  ))}
                </dl>
              </section>

              <section className={s.detailSection}>
                <h4 className={s.detailSectionTitle}>{t("vpipByPosition")}</h4>
                <dl className={`${s.detailGrid} ${s.positionGrid}`}>
                  {POSITION_KEYS.map((key, i) => (
                    <div className={s.positionMetric} key={key}>
                      <dd>{rate(stats?.vpipByPos?.[i] ?? 0, hands)}</dd>
                      <span>{POSITION_CODES[i]}</span>
                      <dt>{t(key)}</dt>
                    </div>
                  ))}
                </dl>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
