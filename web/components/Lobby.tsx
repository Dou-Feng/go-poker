import { useContext, useEffect, useState } from "react";
import { useSocket } from "../hooks/useSocket";
import { AppContext } from "../providers/AppStore";
import Footer from "./Footer";
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
import WalletButton from "./WalletButton";
import Recharge from "./Recharge";
import { useTranslation } from "../hooks/useTranslation";
import { FiUsers, FiClock, FiLogOut } from "react-icons/fi";

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
  const [sb, setSb] = useState("1");
  const [bb, setBb] = useState("2");
  const [buyIn, setBuyIn] = useState("200");
  const [maxBuy, setMaxBuy] = useState("600");
  const [maxPlayers, setMaxPlayers] = useState("6");
  const [handsLimit, setHandsLimit] = useState("20");
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
      sb: parseNumber(sb, 1, 1),
      bb: parseNumber(bb, 2, 2),
      buyIn: buyInNum,
      maxBuy: parseNumber(maxBuy, Math.max(600, buyInNum), buyInNum),
      maxPlayers: parseNumber(maxPlayers, 6, 2, 8),
      handsLimit: parseNumber(handsLimit, 20, 0),
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
    <div className="app-screen flex flex-col overflow-hidden">
      <div className="flex w-full flex-row items-center justify-between px-4 py-2">
        <div className="flex flex-row items-center gap-3">
          <button onClick={viewSelf} className="text-3xl" title={t("myStats")}>
            <Avatar
              username={appState.username ?? ""}
              uuid={appState.uuid ?? ""}
              emoji={appState.avatar ?? "🙂"}
              hasImage={appState.avatarImage}
              size={32}
              version={appState.avatarVersion}
            />
          </button>
          <div className="flex flex-col items-center gap-1">
            <WalletButton onOpen={() => setShowRecharge(true)} />
            <p className="text-sm text-white">{appState.username}</p>
          </div>
        </div>
        <div className="flex flex-row items-center gap-2">
          <button
            onClick={() => setShowFriends(true)}
            title={t("friends")}
            className="rounded-sm border border-neutral-600 px-2 py-1 text-xs text-neutral-400 hover:text-neutral-200"
          >
            <FiUsers size="1rem" />
          </button>
          <button
            onClick={() => {
              setShowHistory(!showHistory);
              if (socket) {
                getHistory(socket);
              }
            }}
            title={t("history")}
            className="rounded-sm border border-neutral-600 px-2 py-1 text-xs text-neutral-400 hover:text-neutral-200"
          >
            <FiClock size="1rem" />
          </button>
          <Settings />
          <button
            onClick={logout}
            title={t("logout")}
            className="rounded-sm border border-neutral-600 px-2 py-1 text-xs text-neutral-400 hover:text-neutral-200"
          >
            <FiLogOut size="1rem" />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center px-4">
        <h1 className="mb-6 mt-4 text-4xl font-semibold text-white">
          {t("lobby")}
        </h1>

        <div className="mb-4 flex w-full max-w-md flex-row items-center justify-between">
          <button
            onClick={() => socket && listTables(socket)}
            className="rounded-sm border border-neutral-600 px-4 py-1.5 text-sm text-neutral-300 hover:bg-neutral-700"
          >
            {t("refresh")}
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="rounded-sm bg-cyan-900 px-4 py-1.5 text-sm text-white hover:bg-cyan-800"
          >
            {t("newRoom")}
          </button>
        </div>

        <div className="flex min-h-0 w-full max-w-md flex-1 flex-col gap-4 overflow-y-auto pb-4">
          <div className="flex flex-col gap-2">
            <p className="text-sm text-neutral-500">{t("rooms")}</p>
            {appState.tables.length === 0 && (
              <p className="text-sm text-neutral-600">{t("noRooms")}</p>
            )}
            {appState.tables.map((room) => (
              <div
                key={room.name}
                className="flex flex-col rounded-sm bg-neutral-800 px-4 py-3"
              >
                <div className="flex flex-row items-center justify-between">
                  <div className="flex flex-col">
                    <p className="text-white">
                      {room.name}
                      {room.locked && (
                        <span className="ml-2 text-sm text-neutral-500">
                          🔒
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {room.players} {t("players")}
                      {" · "}
                      {room.spectators} {t("watching")}
                      {room.running ? " · " + t("running") : ""}
                    </p>
                  </div>
                  <button
                    onClick={() => onJoinClick(room)}
                    className="rounded-sm bg-neutral-700 px-4 py-1.5 text-white hover:bg-neutral-600"
                  >
                    {t("join")}
                  </button>
                </div>
                {joinTarget === room.name && (
                  <div className="mt-2 flex flex-row items-center gap-2">
                    <input
                      autoFocus
                      className="flex-1 rounded-sm bg-neutral-700 py-1.5 pl-3 text-white focus:outline-none"
                      type="password"
                      value={joinPassword}
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
                      className="text-xs text-neutral-500 hover:text-neutral-300"
                    >
                      {t("cancel")}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {showCreate && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
              <div className="flex max-h-[85vh] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-lg bg-zinc-800 p-6 shadow-2xl">
                <div className="flex flex-row items-center justify-between">
                  <p className="text-lg font-semibold text-white">
                    {t("newRoom")}
                  </p>
                  <button
                    onClick={() => setShowCreate(false)}
                    className="text-neutral-400 hover:text-white"
                  >
                    ✕
                  </button>
                </div>

                <div className="flex flex-row items-center gap-2">
                  <input
                    className="flex-1 rounded-sm bg-neutral-700 py-2 pl-4 text-white focus:outline-none"
                    type="text"
                    value={newRoom}
                    placeholder={t("newRoomName")}
                    maxLength={20}
                    onChange={(e) => setNewRoom(e.target.value)}
                  />
                  <input
                    className="w-32 rounded-sm bg-neutral-700 py-2 pl-4 text-white focus:outline-none"
                    type="password"
                    value={newPassword}
                    placeholder={t("password")}
                    maxLength={20}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </div>

                <div className="flex flex-row items-center gap-2 rounded-sm bg-neutral-700 px-3 py-2 text-xs">
                  <span className="w-16 shrink-0 text-neutral-400">
                    {t("blinds")}
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={sb}
                    onChange={(e) => setSb(e.target.value)}
                    className="w-20 flex-1 rounded-sm bg-neutral-600 px-2 py-1 text-white focus:outline-none"
                  />
                  <span className="text-neutral-400">/</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={bb}
                    onChange={(e) => setBb(e.target.value)}
                    className="w-20 flex-1 rounded-sm bg-neutral-600 px-2 py-1 text-white focus:outline-none"
                  />
                </div>

                <div className="flex flex-row items-center gap-2 rounded-sm bg-neutral-700 px-3 py-2 text-xs">
                  <span className="w-16 shrink-0 text-neutral-400">
                    {t("buyIn")}
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={buyIn}
                    onChange={(e) => setBuyIn(e.target.value)}
                    className="flex-1 rounded-sm bg-neutral-600 px-2 py-1 text-white focus:outline-none"
                  />
                </div>

                <div className="flex flex-row items-center gap-2 rounded-sm bg-neutral-700 px-3 py-2 text-xs">
                  <span className="w-16 shrink-0 text-neutral-400">
                    {t("maxBuy")}
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={maxBuy}
                    onChange={(e) => setMaxBuy(e.target.value)}
                    className="flex-1 rounded-sm bg-neutral-600 px-2 py-1 text-white focus:outline-none"
                  />
                </div>

                <div className="flex flex-row items-center gap-2 rounded-sm bg-neutral-700 px-3 py-2 text-xs">
                  <span className="w-16 shrink-0 text-neutral-400">
                    {t("maxPlayers")}
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={maxPlayers}
                    onChange={(e) => setMaxPlayers(e.target.value)}
                    className="flex-1 rounded-sm bg-neutral-600 px-2 py-1 text-white focus:outline-none"
                  />
                </div>

                <div className="flex flex-row items-center gap-2 rounded-sm bg-neutral-700 px-3 py-2 text-xs">
                  <span className="w-16 shrink-0 text-neutral-400">
                    {t("hands")}
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={handsLimit}
                    onChange={(e) => setHandsLimit(e.target.value)}
                    className="flex-1 rounded-sm bg-neutral-600 px-2 py-1 text-white focus:outline-none"
                  />
                  <span className="shrink-0 text-neutral-500">
                    0 = {t("unlimited")}
                  </span>
                </div>

                <div className="mt-2 flex flex-row justify-end gap-2">
                  <button
                    onClick={() => setShowCreate(false)}
                    className="rounded-sm border border-neutral-600 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-700"
                  >
                    {t("cancel")}
                  </button>
                  <button
                    onClick={create}
                    className="rounded-sm bg-cyan-900 px-4 py-2 text-sm text-white hover:bg-cyan-800"
                  >
                    {t("create")}
                  </button>
                </div>
              </div>
            </div>
          )}
          {showFriends && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
              <div className="w-full max-w-md rounded-lg bg-zinc-800 p-6 shadow-2xl">
                <div className="mb-4 flex flex-row items-center justify-between">
                  <p className="text-lg font-semibold text-white">
                    {t("friends")}
                  </p>
                  <button
                    onClick={() => setShowFriends(false)}
                    className="text-neutral-400 hover:text-white"
                  >
                    ✕
                  </button>
                </div>
                <div className="flex flex-row items-center gap-2">
                  <input
                    className="flex-1 rounded-sm bg-neutral-700 py-2 pl-4 text-white focus:outline-none"
                    type="text"
                    value={friendUuid}
                    placeholder={t("friendUuid")}
                    maxLength={32}
                    onChange={(e) => setFriendUuid(e.target.value)}
                  />
                  <button
                    onClick={onAddFriend}
                    disabled={friendUuid == ""}
                    className="rounded-sm bg-neutral-600 px-4 py-2 text-white hover:bg-neutral-500 disabled:opacity-40"
                  >
                    {t("add")}
                  </button>
                </div>
                {appState.friends.length === 0 && (
                  <p className="mt-3 text-sm text-neutral-500">
                    {t("noFriends")}
                  </p>
                )}
                <div className="mt-2 flex flex-col gap-2">
                  {appState.friends.map((f) => (
                    <div
                      key={f.uuid}
                      className="flex flex-row items-center justify-between rounded-sm bg-neutral-700 px-4 py-2"
                    >
                      <div className="flex flex-row items-center gap-2">
                        <Avatar
                          username={f.username}
                          uuid={f.uuid}
                          emoji={f.avatar || "🙂"}
                          hasImage={f.avatarImage}
                          size={24}
                        />
                        <p className="text-white">{f.username}</p>
                      </div>
                      <button
                        onClick={() => socket && getUser(socket, f.uuid)}
                        className="text-xs text-neutral-400 hover:text-neutral-200"
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
        </div>
      </div>
      <Footer />
    </div>
  );
}
