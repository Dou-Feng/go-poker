import React, { useContext, useState } from "react";
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
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const { t, tError } = useTranslation();

  const submit = (mode: "register" | "login") => {
    if (!socket || username == "" || password == "") {
      return;
    }
    dispatch({ type: "setAuthError", payload: null });
    if (mode === "register") {
      registerUser(socket, username, password, avatar);
    } else {
      login(socket, username, password);
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex w-full justify-end px-4 py-2">
        <Settings />
      </div>
      <div className="flex flex-grow flex-col items-center justify-center px-4">
        <h1 className="mb-10 text-5xl font-semibold text-white">
          {t("title")}
        </h1>
        <div className="flex flex-col items-center gap-2">
          <input
            autoFocus
            className="w-64 rounded-sm bg-neutral-700 py-2 pl-4 text-white focus:outline-none"
            type="text"
            value={username}
            placeholder={t("username")}
            maxLength={20}
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            className="w-64 rounded-sm bg-neutral-700 py-2 pl-4 text-white focus:outline-none"
            type="password"
            value={password}
            placeholder={t("password")}
            maxLength={64}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                submit("register");
              }
            }}
          />
          <div className="flex flex-row items-center gap-1 py-1">
            {AVATARS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAvatar(a)}
                className={`rounded-md p-1 text-2xl ${
                  avatar === a ? "bg-zinc-600" : "hover:bg-zinc-700"
                }`}
              >
                {a}
              </button>
            ))}
          </div>
          <div className="flex flex-row gap-2">
            <button
              disabled={username == "" || password == ""}
              onClick={() => submit("register")}
              className="rounded-sm bg-cyan-900 px-5 py-2 text-white hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("signUp")}
            </button>
            <button
              disabled={username == "" || password == ""}
              onClick={() => submit("login")}
              className="rounded-sm border border-neutral-600 px-5 py-2 text-neutral-200 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("logIn")}
            </button>
          </div>
          {appState.authError && (
            <p className="mt-2 text-sm text-rose-400">
              {tError(appState.authError)}
            </p>
          )}
        </div>
      </div>
      <Footer />
    </div>
  );
}
