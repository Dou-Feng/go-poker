import React, { useContext } from "react";
import { useSocket } from "../hooks/useSocket";
import { AppContext } from "../providers/AppStore";
import { setAvatar, getUser } from "../actions/actions";
import { useTranslation } from "../hooks/useTranslation";
import { API_BASE } from "../lib/api";

const AVATARS = ["🙂", "😎", "🦊", "🐸", "🐯", "🐼", "🐨", "🐷"];

type AvatarPickerProps = {
  onClose?: () => void;
};

export default function AvatarPicker({ onClose }: AvatarPickerProps) {
  const socket = useSocket();
  const { appState, dispatch } = useContext(AppContext);
  const { t } = useTranslation();

  const onChangeAvatar = (a: string) => {
    if (socket) {
      setAvatar(socket, a);
    }
    onClose?.();
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
        // A proxied dev server may answer with a whole HTML error page:
        // keep the toast readable.
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
    onClose?.();
  };

  return (
    <div className="flex flex-row flex-wrap items-center justify-center gap-1">
      {AVATARS.map((a) => (
        <button
          key={a}
          onClick={() => onChangeAvatar(a)}
          className={`rounded-md p-1 text-2xl ${
            appState.avatar === a ? "bg-zinc-600" : "hover:bg-zinc-700"
          }`}
        >
          {a}
        </button>
      ))}
      <label className="ml-2 cursor-pointer rounded-sm border border-neutral-600 px-2 py-1 text-xs text-neutral-400 hover:text-neutral-200">
        {t("uploadImage")}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleUpload}
        />
      </label>
    </div>
  );
}
