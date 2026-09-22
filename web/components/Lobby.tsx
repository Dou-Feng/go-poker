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
  clearSession,
  clearTabAuth,
  clearUser,
  saveSession,
} from "../lib/session";
import Settings from "./Settings";
import { startBgm, stopBgm } from "../lib/sfx";
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
  FiDatabase,
  FiLayers,
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
  // 机器人类型: "normal" 内置启发式（默认）或 "ai"（Deep CFR 推理服务）。
  // 只有推理服务健康（table-list 携带的 aiAvailable）时才能选 AI。
  const [botType, setBotType] = useState<"normal" | "ai">("normal");
  const { t } = useTranslation();

  useEffect(() => {
    if (socket) {
      listTables(socket);
      getUser(socket);
      getHistory(socket);
    }
  }, [socket]);

  // Lobby background music (the game room plays its own track).
  useEffect(() => {
    startBgm("lobby");
    return () => stopBgm();
  }, []);

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

  // The Deep CFR net is 6-handed: raising the seat count past six silently
  // reverts an AI pick (the toggle also disables, and the submit guards
  // again — this just keeps the switch honest).
  const maxPlayersNum = parseNumber(maxPlayers, 6, 2, 8);
  useEffect(() => {
    if (maxPlayersNum > 6 && botType === "ai") {
      setBotType("normal");
    }
  }, [maxPlayersNum, botType]);

  // AI 开关不可选时的原因；null = 可选。服务不健康或座位超过模型支持的
  // 6 人都会禁用（提示文案同步展示在开关下方）。
  const aiDisabledReason = !appState.aiAvailable
    ? t("aiBotsUnavailable")
    : maxPlayersNum > 6
    ? t("aiBotsTooManyPlayers")
    : null;

  const join = (name: string, password?: string) => {
    if (!socket) {
      return;
    }
    dispatch({ type: "setAuthError", payload: null });
    joinTable(socket, name, undefined, password);
  };

  const onJoinClick = (room: { name: string; locked: boolean }) => {
    if (!room.locked) {
      join(room.name);
      return;
    }
    if (joinTarget === room.name) {
      join(room.name, joinPassword);
    } else {
      setJoinTarget(room.name);
      setJoinPassword("");
    }
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
      maxPlayers: maxPlayersNum,
      handsLimit: parseNumber(handsLimit, 20, 0),
      actionTimeout: parseNumber(actionTimeout, 40, 0, 300),
      // Deep CFR 模型只训练过 6 人局：座位更多时即使已勾选也退回普通机器人。
      botType: botType === "ai" && maxPlayersNum <= 6 ? "ai" : "normal",
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
          handsByPos: [0, 0, 0, 0, 0, 0],
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
            <img
              src="/icons/dollar.svg"
              alt=""
              aria-hidden
              className="h-4 w-4"
            />
            <span>{appState.chips ?? 0}</span>
            <FiCreditCard aria-hidden="true" />
          </button>
        </div>
        <nav className={styles.tools} aria-label={t("lobbyTools")}>
          <button
            onClick={() => setShowFriends(true)}
            title={t("friends")}
            aria-label={t("friends")}
            className={styles.toolButton}
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
            className={styles.toolButton}
          >
            <FiClock />
          </button>
          <Settings buttonClassName={styles.toolButton} />
          <button
            onClick={logout}
            title={t("logout")}
            aria-label={t("logout")}
            className={styles.toolButton}
          >
            <FiLogOut />
          </button>
        </nav>
      </header>
      <section className={styles.content}>
        <header className={styles.lobbyIntro}>
          <div className={styles.introTitle}>
            <GiSpades className={styles.introSpade} aria-hidden="true" />
            <h1>{t("lobby")}</h1>
            <p>{t("lobbyTagline")}</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            data-sfx="pong"
            className={`${ui.primary} ${styles.createButton}`}
          >
            <FiPlus aria-hidden="true" />
            {t("newRoom")}
          </button>
        </header>
        <section className={styles.rooms} aria-label={t("rooms")}>
          <header className={styles.roomsHeader}>
            <div className={styles.roomsTitle}>
              <h2>{t("rooms")}</h2>
              <span className="type-num">{appState.tables.length}</span>
            </div>
            <button
              type="button"
              onClick={() => socket && listTables(socket)}
              className={styles.refreshButton}
            >
              <FiRefreshCw aria-hidden="true" />
              <span>{t("refresh")}</span>
            </button>
          </header>
          <div
            className={`${styles.roomViewport} ${
              appState.tables.length === 0 ? styles.emptyViewport : ""
            }`}
            role="region"
            aria-label={t("rooms")}
            tabIndex={0}
          >
            {appState.tables.length === 0 && (
              <div className={styles.empty}>
                <GiSpades aria-hidden="true" className={styles.emptySpade} />
                <h3>{t("lobbyEmptyTitle")}</h3>
                <p>{t("lobbyEmptyHint")}</p>
                <button
                  type="button"
                  onClick={() => setShowCreate(true)}
                  data-sfx="pong"
                  className={`${ui.primary} ${styles.emptyAction}`}
                >
                  <FiPlus aria-hidden="true" />
                  {t("createFirstRoom")}
                </button>
              </div>
            )}
            <div className={styles.roomList}>
              {appState.tables.map((room) => (
                <article key={room.name} className={styles.room}>
                  <span className={styles.roomCrest} aria-hidden="true">
                    <GiSpades />
                  </span>
                  <div className={styles.roomCorners} aria-hidden="true">
                    <GiSpades />
                    <GiSpades />
                    <GiSpades />
                    <GiSpades />
                  </div>
                  <img
                    className={styles.roomArt}
                    src="/assets/ui/table/waiting-cards.webp"
                    alt=""
                    aria-hidden="true"
                  />
                  <div className={styles.roomTopline}>
                    <div className={styles.roomIdentity}>
                      <span className={styles.roomMark} aria-hidden="true">
                        <GiSpades />
                      </span>
                      <div className={styles.roomText}>
                        <h3 title={room.name}>
                          <span>{room.name}</span>
                          {room.locked && (
                            <FiLock
                              aria-hidden="true"
                              title={t("roomPassword")}
                            />
                          )}
                        </h3>
                        <p className={styles.roomSubtitle}>
                          {t("roomTagline")}
                        </p>
                        <div className={styles.roomBadges}>
                          {room.tournament && (
                            <span
                              className={styles.badge}
                              title={t("tournamentHint")}
                            >
                              {t("tournament")}
                            </span>
                          )}
                          {room.botType === "ai" && (
                            <span
                              className={styles.badge}
                              title={t("botTypeAIHint")}
                            >
                              {t("botTypeAI")}
                            </span>
                          )}
                          {room.running && (
                            <span className={styles.runningBadge}>
                              {t("running")}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className={styles.roomCapacity}>
                      <strong className={`${styles.occupancy} type-num`}>
                        <FiUsers aria-hidden="true" />
                        {room.players} / {room.maxPlayers}
                      </strong>
                      <span aria-hidden="true">TEXAS HOLD’EM</span>
                    </div>
                  </div>

                  <div className={styles.roomFacts}>
                    <div>
                      <span>
                        <FiLayers aria-hidden="true" />
                        {t("blinds")}
                      </span>
                      <strong className="type-num">
                        {room.sb} / {room.bb}
                      </strong>
                    </div>
                    <div>
                      <span>
                        <FiDatabase aria-hidden="true" />
                        {t("buyInLabel")}
                      </span>
                      <strong className="type-num">{room.buyIn}</strong>
                    </div>
                  </div>

                  <div className={styles.roomFooter}>
                    <p>
                      <FiClock aria-hidden="true" />
                      <span>
                        {room.handsLimit > 0
                          ? `${room.handsLimit} ${t("hands")}`
                          : t("unlimited")}
                      </span>
                      <span>·</span>
                      <span>
                        {room.actionTimeout > 0
                          ? `${room.actionTimeout}s`
                          : t("unlimited")}
                      </span>
                      {room.spectators > 0 && (
                        <>
                          <span>·</span>
                          <span>
                            {room.spectators} {t("watching")}
                          </span>
                        </>
                      )}
                    </p>
                    <button
                      onClick={() => onJoinClick(room)}
                      className={styles.joinButton}
                    >
                      <GiSpades aria-hidden="true" />
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
                          }
                        }}
                      />
                      <button
                        onClick={() => {
                          setJoinTarget(null);
                          setJoinPassword("");
                        }}
                        data-sfx="pong"
                        className={ui.secondary}
                      >
                        {t("cancel")}
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </div>
        </section>
      </section>
      <footer className={styles.footer}>
        <GiSpades aria-hidden="true" />
        <span>GoPoker · PLAY · MEET · ENJOY</span>
        <GiSpades aria-hidden="true" />
      </footer>
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
                data-sfx="back"
                className={ui.iconButton}
                aria-label={t("close")}
              >
                <FiX />
              </button>
            </header>
            <form
              className={`${ui.createForm} ${ui.compactCreateForm}`}
              onSubmit={(event) => {
                event.preventDefault();
                create();
              }}
            >
              <div className={ui.identityFields}>
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
              </div>
              <fieldset className={`${ui.blinds} ${ui.economyFields}`}>
                <legend>{t("blinds")}</legend>
                <div className={ui.compactColumns}>
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
                  <label className={ui.inlineField}>
                    <span>{t("buyInLabel")}</span>
                    <input
                      aria-label={t("buyIn")}
                      type="text"
                      inputMode="numeric"
                      value={buyIn}
                      onChange={(e) => setBuyIn(e.target.value)}
                    />
                  </label>
                </div>
              </fieldset>
              <details className={ui.advancedSettings}>
                <summary>
                  <span>{t("moreSettings")}</span>
                  <small className="type-num">
                    {maxPlayers}P · {handsLimit || 0}H · {actionTimeout || 0}s
                  </small>
                </summary>
                <div className={ui.advancedBody}>
                  <div className={ui.compactColumns}>
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
                    </label>
                  </div>
                  <p className={ui.zeroHint}>0 = {t("unlimited")}</p>
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
                    <label className={`${ui.field} ${ui.maxBuyField}`}>
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
                  <label
                    className={ui.tournament}
                    title={aiDisabledReason ?? t("botTypeAIHint")}
                  >
                    <span>
                      {t("botTypeAI")}
                      <small>{aiDisabledReason ?? t("botTypeAIHint")}</small>
                    </span>
                    <input
                      type="checkbox"
                      role="switch"
                      disabled={aiDisabledReason !== null}
                      checked={botType === "ai"}
                      onChange={(e) =>
                        setBotType(e.target.checked ? "ai" : "normal")
                      }
                    />
                  </label>
                </div>
              </details>
              <div className={ui.dialogActions}>
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  data-sfx="pong"
                  className={ui.secondary}
                >
                  {t("cancel")}
                </button>
                <button type="submit" data-sfx="pong" className={ui.primary}>
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
                data-sfx="back"
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
