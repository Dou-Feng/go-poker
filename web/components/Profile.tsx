import { useContext, useState } from "react";
import { AppContext } from "../providers/AppStore";
import { Profile as ProfileType, PlayerStats } from "../interfaces";
import { useTranslation } from "../hooks/useTranslation";
import { useSocket } from "../hooks/useSocket";
import { TranslationKey } from "../lib/translations";
import { changeUsername } from "../actions/actions";
import Avatar from "./Avatar";
import AvatarPicker from "./AvatarPicker";

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

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-row items-center justify-between border-b border-muted/30 py-1">
      <p className="type-label">{label}</p>
      <p className="text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}

export default function Profile() {
  const { appState, dispatch } = useContext(AppContext);
  const { t } = useTranslation();
  const socket = useSocket();
  const [showPicker, setShowPicker] = useState(false);
  const [showChangeUsername, setShowChangeUsername] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [copied, setCopied] = useState(false);
  const profile: ProfileType | null = appState.profile;
  const stats: PlayerStats | null = profile ? profile.stats : null;

  if (!profile) {
    return null;
  }

  const isSelf = !!profile.uuid && profile.uuid === appState.uuid;
  // A history entry is shown as a session view: its own stats, no avatar editing.
  const isSession = profile.net !== undefined || profile.buyIn !== undefined;
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-lg bg-card p-6 shadow-2xl">
        <div className="mb-4 flex flex-row items-center justify-between">
          <div className="flex flex-row items-center gap-3">
            <button
              onClick={
                isSelf && !isSession
                  ? () => setShowPicker(!showPicker)
                  : undefined
              }
              className={
                isSelf && !isSession
                  ? "cursor-pointer rounded-full hover:opacity-80"
                  : "cursor-default"
              }
              title={isSelf && !isSession ? t("changeAvatar") : undefined}
            >
              <Avatar
                username={profile.username}
                uuid={profile.uuid}
                emoji={avatarEmoji}
                hasImage={avatarImage}
                size={40}
                version={
                  isSelf && !isSession ? appState.avatarVersion : undefined
                }
              />
            </button>
            <div>
              <p className="type-heading">
                {profile.username}
              </p>
              {isSession && (
                <p className="type-label">
                  {t("buyInLabel")}: {profile.buyIn} · {t("net")}:{" "}
                  {profile.net !== undefined && profile.net >= 0 ? "+" : ""}
                  {profile.net}
                </p>
              )}
              {!isSession && profile.chips > 0 && (
                <p className="type-label">
                  {t("chips")}: {profile.chips}
                </p>
              )}
              {profile.uuid && (
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(profile.uuid ?? "");
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1200);
                  }}
                  className="flex flex-row items-center gap-1 font-mono type-caption hover:text-ink"
                  title={profile.uuid}
                >
                  <span className="max-w-[180px] truncate">
                    {t("uuid")}: {profile.uuid}
                  </span>
                  <span>{copied ? "✓" : "⧉"}</span>
                </button>
              )}
            </div>
          </div>
          <button
            onClick={() => {
              setShowPicker(false);
              dispatch({ type: "setProfile", payload: null });
            }}
            className="btn btn-text"
          >
            ✕
          </button>
        </div>

        {isSelf && !isSession && (
          <div className="mb-4">
            {showChangeUsername ? (
              <div className="flex flex-row items-center gap-2">
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder={t("newUsername")}
                  className="min-w-0 flex-1 rounded-md bg-floor px-2 py-1.5 text-sm text-ink outline-none"
                />
                <button
                  onClick={() => {
                    if (socket && newUsername.trim()) {
                      changeUsername(socket, newUsername.trim());
                    }
                    setShowChangeUsername(false);
                    setNewUsername("");
                  }}
                  className="btn btn-confirm"
                >
                  {t("change")}
                </button>
                <button
                  onClick={() => {
                    setShowChangeUsername(false);
                    setNewUsername("");
                  }}
                  className="btn btn-secondary"
                >
                  ✕
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowChangeUsername(true)}
                className="btn btn-secondary w-full"
              >
                {t("changeUsername")}
              </button>
            )}
          </div>
        )}

        {isSelf && !isSession && showPicker && (
          <div className="mb-4">
            <AvatarPicker onClose={() => setShowPicker(false)} />
          </div>
        )}

        <div className="mb-2 flex flex-col">
          <StatRow
            label={t("handsPlayed")}
            value={String(stats?.handsPlayed ?? 0)}
          />
          <StatRow
            label={t("winRate")}
            value={rate(stats?.handsWon ?? 0, stats?.handsPlayed ?? 0)}
          />
          <StatRow
            label={t("foldRate")}
            value={rate(stats?.folds ?? 0, stats?.handsPlayed ?? 0)}
          />
          <StatRow
            label={t("threeBetRate")}
            value={rate(stats?.threeBets ?? 0, stats?.handsPlayed ?? 0)}
          />
          <StatRow
            label={t("vpip")}
            value={rate(stats?.vpip ?? 0, stats?.handsPlayed ?? 0)}
          />
          <StatRow
            label={t("maxPotWon")}
            value={String(stats?.maxPotWon ?? 0)}
          />
          <StatRow label={t("calls")} value={String(stats?.calls ?? 0)} />
          <StatRow label={t("raises")} value={String(stats?.raises ?? 0)} />
        </div>

        <p className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-muted">
          {t("vpipByPosition")}
        </p>
        <div className="flex flex-col">
          {POSITION_KEYS.map((key, i) => (
            <StatRow
              key={key}
              label={t(key)}
              value={rate(stats?.vpipByPos?.[i] ?? 0, stats?.handsPlayed ?? 0)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
