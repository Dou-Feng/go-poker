import { useContext, useEffect, useState } from "react";
import { useSocket } from "../hooks/useSocket";
import { AppContext } from "../providers/AppStore";
import styles from "../styles/Lobby.module.css";
import ui from "../styles/Dialog.module.css";
import {
  listTables,
  joinTable,
  createTable,
  getUser,
  addFriend,
  getHistory,
} from "../actions/actions";
import {
  saveSession,
  clearSession,
  clearTabAuth,
  clearUser,
} from "../lib/session";
import Settings from "./Settings";
import Avatar from "./Avatar";
import History from "./History";

import Recharge from "./Recharge";
import { useTranslation } from "../hooks/useTranslation";
import {
  FiUsers,
  FiClock,
  FiLogOut,
  FiRefreshCw,
  FiPlus,
  FiLock,
  FiX,
  FiArrowRight,
  FiCreditCard,
} from "react-icons/fi";
import { GiSpades } from "react-icons/gi";

export default function Lobby() {
  const socket = useSocket();
  const { appState, dispatch } = useContext(AppContext);
  const [newRoom, setNewRoom] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [joinTarget, setJoinTarget] = useState<string | null>(null);
  const [joinPassword, setJoinPassword] = useState("");
  const [friendUuid, setFriendUuid] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [showRecharge, setShowRecharge] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showFriends, setShowFriends] = useState(false);
  const [sb, setSb] = useState("5");
  const [bb, setBb] = useState("10");
  const [buyIn, setBuyIn] = useState("200");
  const [maxBuy, setMaxBuy] = useState("600");
  // 锦标赛: cap each player's total buy-ins (maxBuy); busted players with no
  // buy-ins left are benched. Off by default = unlimited rebuys.
  const [tournament, setTournament] = useState(false);
  const [maxPlayers, setMaxPlayers] = useState("6");
  const [handsLimit, setHandsLimit] = useState("20");
  // 操作时限: seconds each player has to act before the server checks or
  // folds for them; 0 = no clock.
  const [actionTimeout, setActionTimeout] = useState("40");
  const { t } = useTranslation();

  useEffect(() => {
    if (socket) {
      listTables(socket);
      getUser(socket);
      getHistory(socket);
    }
  }, [socket]);

  const join = (name: string, password?: string) => {
    if (!socket) {
      return;
    }
    dispatch({ type: "setAuthError", payload: null });
    dispatch({ type: "clearGame" });
    dispatch({ type: "setTablename", payload: name });
    saveSession({
      username: appState.username ?? "",
      table: name,
      clientID: null,
    });
    joinTable(socket, name, undefined, password);
  };

  const onJoinClick = (room: { name: string; locked: boolean }) => {
    if (!room.locked) {
      join(room.name);
      return;
    }
    if (joinTarget === room.name) {
      join(room.name, joinPassword);
      setJoinTarget(null);
      setJoinPassword("");
    } else {
      setJoinTarget(room.name);
      setJoinPassword("");
    }
  };

  const parseNumber = (
    value: string,
    fallback: number,
    min?: number,
    max?: number
  ) => {
    const n = Number(value);
    if (value.trim() === "" || !Number.isFinite(n)) {
      return fallback;
    }
    if (min !== undefined && n < min) {
      return fallback;
    }
    if (max !== undefined && n > max) {
      return fallback;
    }
    return n;
  };

  const create = () => {
    if (!socket) {
      return;
    }
    const name =
      newRoom.trim() === ""
        ? "room-" + Math.random().toString(36).slice(2, 8)
        : newRoom.trim();
    dispatch({ type: "setAuthError", payload: null });
    dispatch({ type: "clearGame" });
    dispatch({ type: "setTablename", payload: name });
    saveSession({
      username: appState.username ?? "",
      table: name,
      clientID: null,
    });
    const buyInNum = parseNumber(buyIn, 200, 1);
    createTable(socket, name, {
      password: newPassword || undefined,
      sb: parseNumber(sb, 5, 1),
      bb: parseNumber(bb, 10, 2),
      buyIn: buyInNum,
      maxBuy: tournament
        ? parseNumber(maxBuy, Math.max(600, buyInNum), buyInNum)
        : 0,
      tournament,
      maxPlayers: parseNumber(maxPlayers, 6, 2, 8),
      handsLimit: parseNumber(handsLimit, 20, 0),
      actionTimeout: parseNumber(actionTimeout, 40, 0, 300),
    });
  };

  const logout = () => {
    clearUser();
    clearSession();
    clearTabAuth();
    dispatch({ type: "resetGame" });
  };

  const viewSelf = () => {
    dispatch({
      type: "setProfile",
      payload: {
        uuid: appState.uuid ?? "",
        username: appState.username ?? "",
        avatar: appState.avatar ?? "🙂",
        chips: appState.chips ?? 0,
        friends: appState.friends,
        avatarImage: appState.avatarImage,
        stats: appState.stats ?? {
          handsPlayed: 0,
          handsWon: 0,
          folds: 0,
          calls: 0,
          raises: 0,
          threeBets: 0,
          maxPotWon: 0,
          vpip: 0,
          vpipByPos: [0, 0, 0, 0, 0, 0],
        },
      },
    });
  };

  const onAddFriend = () => {
    if (socket && friendUuid != "") {
      dispatch({ type: "setAuthError", payload: null });
      addFriend(socket, friendUuid);
      setFriendUuid("");
    }
  };

  return (
    <main className={`room-wallpaper ${styles.page}`}>
      <header className={styles.toolbar}>
        <div className={styles.account}>
          <button
            onClick={viewSelf}
            className={styles.profile}
            title={t("myStats")}
          >
            <Avatar
              username={appState.username ?? ""}
              uuid={appState.uuid ?? ""}
              emoji={appState.avatar ?? "🙂"}
              hasImage={appState.avatarImage}
              size={36}
              version={appState.avatarVersion}
            />
            <span>{appState.username}</span>
          </button>
          <button
            className={styles.wallet}
            onClick={() => setShowRecharge(true)}
            aria-label={t("recharge")}
          >
            <img src="/dollar.svg" alt="" aria-hidden className="h-4 w-4" />
            <span>{appState.chips ?? 0}</span>
            <FiCreditCard aria-hidden="true" />
          </button>
        </div>
        <nav className={styles.tools} aria-label={t("lobbyTools")}>
          <button
            onClick={() => setShowFriends(true)}
            title={t("friends")}
            aria-label={t("friends")}
            className={ui.iconButton}
          >
            <FiUsers />
          </button>
          <button
            onClick={() => {
              setShowHistory(true);
              if (socket) getHistory(socket);
            }}
            title={t("history")}
            aria-label={t("history")}
            className={ui.iconButton}
          >
            <FiClock />
          </button>
          <Settings buttonClassName={`${ui.iconButton} w-full`} />
          <button
            onClick={logout}
            title={t("logout")}
            aria-label={t("logout")}
            className={ui.iconButton}
          >
            <FiLogOut />
          </button>
        </nav>
      </header>
      <section className={styles.content}>
        <div className={styles.brand}>
          <GiSpades aria-hidden="true" />
          <p>GoPoker</p>
          <span>PLAY • MEET • ENJOY</span>
          <h1>{t("lobby")}</h1>
        </div>
        <div className={styles.actions}>
          <button
            onClick={() => socket && listTables(socket)}
            className={ui.secondary}
          >
            <FiRefreshCw aria-hidden="true" />
            {t("refresh")}
          </button>
          <button onClick={() => setShowCreate(true)} className={ui.primary}>
            <FiPlus aria-hidden="true" />
            {t("newRoom")}
          </button>
        </div>
        <section className={styles.rooms} aria-label={t("rooms")}>
          <h2>{t("rooms")}</h2>
          {appState.tables.length === 0 && (
            <div className={styles.empty}>
              <GiSpades aria-hidden="true" className={styles.emptySpade} />
              <h3>{t("lobbyEmptyTitle")}</h3>
              <p>{t("lobbyEmptyHint")}</p>
            </div>
          )}
          <div className={styles.roomList}>
            {appState.tables.map((room) => (
              <article key={room.name} className={styles.room}>
                <div className={styles.roomSummary}>
                  <div className={styles.roomText}>
                    <h3>
                      {room.name}
                      {room.locked && (
                        <FiLock aria-hidden="true" title={t("roomPassword")} />
                      )}
                    </h3>
                    {room.tournament && (
                      <span
                        className={styles.badge}
                        title={t("tournamentHint")}
                      >
                        {t("tournament")}
                      </span>
                    )}
                    <p>
                      {room.players} {t("players")} · {room.spectators}{" "}
                      {t("watching")}
                      {room.running ? " · " + t("running") : ""}
                    </p>
                  </div>
                  <button
                    onClick={() => onJoinClick(room)}
                    className={ui.secondary}
                  >
                    {t("join")}
                    <FiArrowRight aria-hidden="true" />
                  </button>
                </div>
                {joinTarget === room.name && (
                  <div className={styles.joinForm}>
                    <input
                      autoFocus
                      className={ui.input}
                      type="password"
                      value={joinPassword}
                      aria-label={t("roomPassword")}
                      placeholder={t("roomPassword")}
                      onChange={(e) => setJoinPassword(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          join(room.name, joinPassword);
                          setJoinTarget(null);
                          setJoinPassword("");
                        }
                      }}
                    />
                    <button
                      onClick={() => {
                        setJoinTarget(null);
                        setJoinPassword("");
                      }}
                      className={ui.secondary}
                    >
                      {t("cancel")}
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      </section>
      <footer className={styles.footer}>GoPoker · PLAY · MEET · ENJOY</footer>
      {showCreate && (
        <div className={ui.overlay}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-room-title"
            className={ui.dialog}
          >
            <header className={ui.dialogHeader}>
              <h2 id="create-room-title">{t("newRoom")}</h2>
              <button
                onClick={() => setShowCreate(false)}
                className={ui.iconButton}
                aria-label={t("close")}
              >
                <FiX />
              </button>
            </header>
            <form
              className={ui.createForm}
              onSubmit={(event) => {
                event.preventDefault();
                create();
              }}
            >
              <label className={ui.field}>
                {t("newRoomName")}
                <input
                  autoFocus
                  className={ui.input}
                  type="text"
                  value={newRoom}
                  placeholder={t("roomAutoName")}
                  maxLength={20}
                  onChange={(e) => setNewRoom(e.target.value)}
                />
              </label>
              <label className={ui.field}>
                {t("roomPassword")}
                <input
                  className={ui.input}
                  type="password"
                  value={newPassword}
                  placeholder={t("optionalField")}
                  maxLength={20}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </label>
              <fieldset className={ui.blinds}>
                <legend>{t("blinds")}</legend>
                <div className={ui.columns}>
                  <label className={ui.inlineField}>
                    <span>{t("smallBlindLabel")}</span>
                    <input
                      aria-label={t("smallBlindLabel")}
                      type="text"
                      inputMode="numeric"
                      value={sb}
                      onChange={(e) => setSb(e.target.value)}
                    />
                  </label>
                  <label className={ui.inlineField}>
                    <span>{t("bigBlindLabel")}</span>
                    <input
                      aria-label={t("bigBlindLabel")}
                      type="text"
                      inputMode="numeric"
                      value={bb}
                      onChange={(e) => setBb(e.target.value)}
                    />
                  </label>
                </div>
              </fieldset>
              <label className={ui.field}>
                {t("buyIn")}
                <input
                  className={ui.input}
                  type="text"
                  inputMode="numeric"
                  value={buyIn}
                  onChange={(e) => setBuyIn(e.target.value)}
                />
              </label>
              <label className={ui.tournament}>
                <span>
                  {t("tournament")}
                  <small>{t("tournamentHint")}</small>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={tournament}
                  onChange={(e) => setTournament(e.target.checked)}
                />
              </label>
              {tournament && (
                <label className={ui.field}>
                  {t("maxBuy")}
                  <input
                    className={ui.input}
                    type="text"
                    inputMode="numeric"
                    value={maxBuy}
                    onChange={(e) => setMaxBuy(e.target.value)}
                  />
                </label>
              )}
              <div className={ui.columns}>
                <label className={ui.field}>
                  {t("maxPlayers")}
                  <input
                    className={ui.input}
                    type="text"
                    inputMode="numeric"
                    value={maxPlayers}
                    onChange={(e) => setMaxPlayers(e.target.value)}
                  />
                </label>
                <label className={ui.field}>
                  {t("hands")}
                  <input
                    className={ui.input}
                    type="text"
                    inputMode="numeric"
                    value={handsLimit}
                    onChange={(e) => setHandsLimit(e.target.value)}
                  />
                  <small>0 = {t("unlimited")}</small>
                </label>
                <label className={ui.field}>
                  {t("actionTimeout")}
                  <input
                    className={ui.input}
                    type="text"
                    inputMode="numeric"
                    value={actionTimeout}
                    onChange={(e) => setActionTimeout(e.target.value)}
                  />
                  <small>0 = {t("unlimited")}</small>
                </label>
              </div>
              <div className={ui.dialogActions}>
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className={ui.secondary}
                >
                  {t("cancel")}
                </button>
                <button type="submit" className={ui.primary}>
                  {t("create")}
                  <FiArrowRight aria-hidden="true" />
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {showFriends && (
        <div className={ui.overlay}>
          <div
            className={ui.dialog}
            role="dialog"
            aria-modal="true"
            aria-label={t("friends")}
          >
            <div className={ui.dialogHeader}>
              <p className="type-heading">{t("friends")}</p>
              <button
                onClick={() => setShowFriends(false)}
                aria-label={t("close")}
                className={ui.iconButton}
              >
                ✕
              </button>
            </div>
            <div className="flex min-w-0 flex-row items-center gap-2">
              <input
                className={ui.input}
                type="text"
                value={friendUuid}
                placeholder={t("friendUuid")}
                aria-label={t("friendUuid")}
                maxLength={32}
                onChange={(e) => setFriendUuid(e.target.value)}
              />
              <button
                onClick={onAddFriend}
                disabled={friendUuid == ""}
                className={ui.secondary}
              >
                {t("add")}
              </button>
            </div>
            {appState.friends.length === 0 && (
              <p className="type-label mt-3">{t("noFriends")}</p>
            )}
            <div className="mt-2 flex flex-col gap-2">
              {appState.friends.map((f) => (
                <div key={f.uuid} className={styles.friendRow}>
                  <div className="flex flex-row items-center gap-2">
                    <Avatar
                      username={f.username}
                      uuid={f.uuid}
                      emoji={f.avatar || "🙂"}
                      hasImage={f.avatarImage}
                      size={24}
                    />
                    <p className="min-w-0 break-all text-ink">{f.username}</p>
                  </div>
                  <button
                    onClick={() => socket && getUser(socket, f.uuid)}
                    className="type-caption shrink-0 hover:text-ink"
                  >
                    {t("viewStats")}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {showRecharge && <Recharge onClose={() => setShowRecharge(false)} />}
      {showHistory && <History onClose={() => setShowHistory(false)} />}
    </main>
  );
}
