import React, { useContext, useEffect, useRef, useState } from "react";
import { useSocket } from "../hooks/useSocket";
import { AppContext } from "../providers/AppStore";
import { FiUser, FiLock, FiArrowRight } from "react-icons/fi";
import { FaDiscord, FaSteam } from "react-icons/fa";
import { FcGoogle } from "react-icons/fc";
import styles from "../styles/Register.module.css";
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

  const switchMode = (next: "register" | "login") => {
    setMode(next);
    dispatch({ type: "setAuthError", payload: null });
  };

  return (
    <main className={styles.page}>
      <div className={styles.mask} aria-hidden="true" />
      <div className={styles.settings}>
        <Settings />
      </div>
      <section className={styles.shell} aria-label={t("title")}>
        <header className={styles.brand}>
          <div className={styles.symbol} aria-hidden="true">
            <span />♠<span />
          </div>
          <h1>GoPoker</h1>
          <p>
            PLAY <b>•</b> MEET <b>•</b> ENJOY
          </p>
        </header>
        <div className={styles.switch} aria-label={t("authMode")}>
          {(["register", "login"] as const).map((item) => (
            <button
              key={item}
              type="button"
              data-sfx="pong"
              aria-pressed={mode === item}
              className={mode === item ? styles.active : ""}
              onClick={() => switchMode(item)}
            >
              {t(item === "register" ? "signUp" : "logIn")}
            </button>
          ))}
        </div>
        <div className={styles.forms}>
          {(["register", "login"] as const).map((item) => {
            const registering = item === "register";
            return (
              <form
                key={item}
                className={`${styles.form} ${
                  mode !== item ? styles.hidden : ""
                }`}
                aria-hidden={mode !== item}
                onSubmit={(event) => {
                  event.preventDefault();
                  submit();
                }}
              >
                {registering && (
                  <Field
                    inputRef={registerField}
                    icon={<FiUser />}
                    label={t("username")}
                    value={username}
                    onChange={setUsername}
                    maxLength={20}
                    autoComplete="nickname"
                  />
                )}
                <Field
                  inputRef={registering ? undefined : loginField}
                  icon={<FiLock />}
                  label={registering ? t("authUserId") : t("identifier")}
                  hint={registering ? t("uuidHint") : undefined}
                  value={registering ? uuid : identifier}
                  onChange={registering ? setUuid : setIdentifier}
                  maxLength={32}
                  autoComplete="username"
                />
                <Field
                  icon={<FiLock />}
                  label={t("password")}
                  type="password"
                  value={password}
                  onChange={setPassword}
                  maxLength={64}
                  autoComplete={
                    registering ? "new-password" : "current-password"
                  }
                />
                {registering && (
                  <fieldset className={styles.avatarSection}>
                    <legend>{t("authChooseAvatar")}</legend>
                    <div className={styles.avatars}>
                      {AVATARS.map((a, index) => (
                        <button
                          key={a}
                          type="button"
                          aria-label={`${t("authAvatar")} ${index + 1}`}
                          aria-pressed={avatar === a}
                          onClick={() => setAvatar(a)}
                          className={avatar === a ? styles.selected : ""}
                        >
                          {a}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                )}
                <button
                  type="submit"
                  data-sfx="pong"
                  className={styles.primary}
                  disabled={
                    password === "" ||
                    (registering
                      ? username === "" || uuid === ""
                      : identifier === "")
                  }
                >
                  {t(registering ? "signUp" : "logIn")}
                  <FiArrowRight aria-hidden="true" />
                </button>
              </form>
            );
          })}
        </div>
        <p className={styles.error} role="status" aria-live="polite">
          {appState.authError ? tError(appState.authError) : ""}
        </p>
        <div className={styles.divider}>
          <span />
          {t("authOtherMethods")}
          <span />
        </div>
        <div className={styles.oauth}>
          {[
            { name: "Google", icon: <FcGoogle /> },
            { name: "Discord", icon: <FaDiscord color="#8993ff" /> },
            { name: "Steam", icon: <FaSteam /> },
          ].map(({ name, icon }) => (
            <button
              key={name}
              type="button"
              disabled
              aria-label={`${name}: ${t("authUnavailable")}`}
              title={t("authUnavailable")}
            >
              {icon}
            </button>
          ))}
        </div>
        <p className={styles.note}>{t("authUnavailable")}</p>
      </section>
    </main>
  );
}

interface FieldProps {
  inputRef?: React.Ref<HTMLInputElement>;
  icon: React.ReactNode;
  label: string;
  hint?: string;
  type?: string;
  value: string;
  maxLength: number;
  autoComplete: string;
  onChange: (value: string) => void;
}

function Field({
  inputRef,
  icon,
  label,
  hint,
  type = "text",
  value,
  maxLength,
  autoComplete,
  onChange,
}: FieldProps) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldIcon} aria-hidden="true">
        {icon}
      </span>
      <input
        ref={inputRef}
        aria-label={label}
        title={hint}
        type={type}
        placeholder={label}
        required
        value={value}
        maxLength={maxLength}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && <span className={styles.hint}>{hint}</span>}
    </label>
  );
}
