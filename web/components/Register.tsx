import React, { useContext, useEffect, useRef, useState } from "react";
import { useSocket } from "../hooks/useSocket";
import { AppContext } from "../providers/AppStore";
import Footer from "./Footer";
import Settings from "./Settings";
import { registerUser, login } from "../actions/actions";
import { useTranslation } from "../hooks/useTranslation";

const AVATARS = ["🙂", "😎", "🦊", "🐸", "🐯", "🐼", "🐨", "🐷"];

export default function Register() {
  const socket = useSocket();
  const { appState, dispatch } = useContext(AppContext);
  const [mode, setMode] = useState<"register" | "login">("register");
  const [username, setUsername] = useState("");
  const [uuid, setUuid] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const { t, tError } = useTranslation();

  // Both forms stay mounted and stacked in the same grid cell so the block
  // keeps a constant height (the register form's) when switching modes —
  // the logo never moves. Focus the active form's first field on switch,
  // replacing per-input autoFocus (which only fires on mount).
  const registerField = useRef<HTMLInputElement>(null);
  const loginField = useRef<HTMLInputElement>(null);
  useEffect(() => {
    (mode === "register" ? registerField : loginField).current?.focus();
  }, [mode]);

  const submit = () => {
    if (!socket) {
      return;
    }
    dispatch({ type: "setAuthError", payload: null });
    if (mode === "register") {
      if (username == "" || uuid == "" || password == "") {
        return;
      }
      registerUser(socket, username, uuid, password, avatar);
    } else {
      if (identifier == "" || password == "") {
        return;
      }
      login(socket, identifier, password);
    }
  };

  return (
    <div className="login-wallpaper flex min-h-screen flex-col">
      <div className="flex w-full justify-end px-4 py-2">
        <Settings />
      </div>
      <div className="flex flex-grow flex-col items-center justify-center px-4">
        <h1 className="type-display mb-10 text-5xl">{t("title")}</h1>
        <div className="flex flex-col items-center gap-2">
          <div className="mb-2 flex flex-row gap-1 rounded-md bg-card p-1">
            <button
              onClick={() => setMode("register")}
              className={`rounded-sm px-4 py-1 text-sm ${
                mode === "register"
                  ? "bg-cyan-900 text-ink"
                  : "text-ink hover:text-ink"
              }`}
            >
              {t("signUp")}
            </button>
            <button
              onClick={() => setMode("login")}
              className={`rounded-sm px-4 py-1 text-sm ${
                mode === "login"
                  ? "bg-cyan-900 text-ink"
                  : "text-ink hover:text-ink"
              }`}
            >
              {t("logIn")}
            </button>
          </div>

          <div className="grid">
            <div
              className={`col-start-1 row-start-1 flex flex-col items-center gap-2 ${
                mode === "register" ? "" : "invisible"
              }`}
              aria-hidden={mode !== "register"}
            >
              <input
                ref={registerField}
                className="w-64 rounded-sm bg-floor py-2 pl-4 text-ink focus:outline-none"
                type="text"
                value={username}
                placeholder={t("username")}
                maxLength={20}
                onChange={(e) => setUsername(e.target.value)}
              />
              <input
                className="w-64 rounded-sm bg-floor py-2 pl-4 text-ink focus:outline-none"
                type="text"
                value={uuid}
                placeholder={t("uuid")}
                maxLength={32}
                onChange={(e) => setUuid(e.target.value)}
              />
              <p className="type-caption">{t("uuidHint")}</p>
              <input
                className="w-64 rounded-sm bg-floor py-2 pl-4 text-ink focus:outline-none"
                type="password"
                value={password}
                placeholder={t("password")}
                maxLength={64}
                onChange={(e) => setPassword(e.target.value)}
              />
              <div className="flex flex-row items-center gap-1 py-1">
                {AVATARS.map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setAvatar(a)}
                    className={`rounded-md p-1 text-2xl ${
                      avatar === a ? "bg-cardhi" : "hover:bg-floor"
                    }`}
                  >
                    {a}
                  </button>
                ))}
              </div>
              <button
                disabled={username == "" || uuid == "" || password == ""}
                onClick={submit}
                className="btn btn-primary"
              >
                {t("signUp")}
              </button>
            </div>
            <div
              className={`col-start-1 row-start-1 flex flex-col items-center gap-2 ${
                mode === "login" ? "" : "invisible"
              }`}
              aria-hidden={mode !== "login"}
            >
              <input
                ref={loginField}
                className="w-64 rounded-sm bg-floor py-2 pl-4 text-ink focus:outline-none"
                type="text"
                value={identifier}
                placeholder={t("identifier")}
                maxLength={32}
                onChange={(e) => setIdentifier(e.target.value)}
              />
              <input
                className="w-64 rounded-sm bg-floor py-2 pl-4 text-ink focus:outline-none"
                type="password"
                value={password}
                placeholder={t("password")}
                maxLength={64}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    submit();
                  }
                }}
              />
              <button
                disabled={identifier == "" || password == ""}
                onClick={submit}
                className="btn btn-ghost"
              >
                {t("logIn")}
              </button>
            </div>
          </div>

          {/* Fixed-height slot: the error message appearing/disappearing
              must not re-center (and jump) the whole block. */}
          <p className="mt-2 h-5 text-sm text-rose-400">
            {appState.authError ? tError(appState.authError) : ""}
          </p>
        </div>
      </div>
      <Footer />
    </div>
  );
}
