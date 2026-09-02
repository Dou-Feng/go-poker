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
import { saveSession, clearSession, clearUser } from "../lib/session";
import Settings from "./Settings";
import Avatar from "./Avatar";
import History from "./History";
import WalletButton from "./WalletButton";
import Recharge from "./Recharge";
import { useTranslation } from "../hooks/useTranslation";

const BLINDS_PRESETS: [string, number, number][] = [
  ["1/2", 1, 2],
  ["10/20", 10, 20],
  ["25/50", 25, 50],
  ["50/100", 50, 100],
  ["100/200", 100, 200],
];
const BUYIN_PRESETS = [200, 500, 1000, 5000];
const BUYINS_PRESETS = [1, 2, 3, 5];
const PLAYERS_PRESETS = [2, 3, 4, 5, 6, 7, 8];
const HANDS_PRESETS = [10, 20, 50];

export default function Lobby() {
  const socket = useSocket();
  const { appState, dispatch } = useContext(AppContext);
  const [newRoom, setNewRoom] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [joinTarget, setJoinTarget] = useState<string | null>(null);
  const [joinPassword, setJoinPassword] = useState("");
  const [friendName, setFriendName] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [showRecharge, setShowRecharge] = useState(false);
  const [sb, setSb] = useState(1);
  const [bb, setBb] = useState(2);
  const [buyIn, setBuyIn] = useState(200);
  const [maxBuyIns, setMaxBuyIns] = useState(2);
  const [maxPlayers, setMaxPlayers] = useState(6);
  const [handsLimit, setHandsLimit] = useState(0);
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

  const create = () => {
    if (!socket || newRoom == "") {
      return;
    }
    dispatch({ type: "setAuthError", payload: null });
    dispatch({ type: "clearGame" });
    dispatch({ type: "setTablename", payload: newRoom });
    saveSession({
      username: appState.username ?? "",
      table: newRoom,
      clientID: null,
    });
    createTable(socket, newRoom, {
      password: newPassword || undefined,
      sb,
      bb,
      buyIn,
      maxBuyIns,
      maxPlayers,
      handsLimit,
    });
  };

  const logout = () => {
    clearUser();
    clearSession();
    dispatch({ type: "resetGame" });
  };

  const viewSelf = () => {
    dispatch({
      type: "setProfile",
      payload: {
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
    if (socket && friendName != "") {
      dispatch({ type: "setAuthError", payload: null });
      addFriend(socket, friendName);
      setFriendName("");
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex w-full flex-row items-center justify-between px-4 py-2">
        <div className="flex flex-row items-center gap-3">
          <button onClick={viewSelf} className="text-3xl" title={t("myStats")}>
            <Avatar
              username={appState.username ?? ""}
              emoji={appState.avatar ?? "🙂"}
              hasImage={appState.avatarImage}
              size={32}
              version={appState.avatarVersion}
            />
          </button>
          <div className="flex flex-col items-start gap-1">
            <p className="text-white">{appState.username}</p>
            <WalletButton onOpen={() => setShowRecharge(true)} />
          </div>
        </div>
        <div className="flex flex-row flex-wrap items-center gap-2">
          <button
            onClick={() => {
              setShowHistory(!showHistory);
              if (socket) {
                getHistory(socket);
              }
            }}
            className="rounded-sm border border-neutral-600 px-3 py-1 text-sm text-neutral-400 hover:text-neutral-200"
          >
            {t("history")}
          </button>
          <Settings />
          <button
            onClick={logout}
            className="rounded-sm border border-neutral-600 px-3 py-1 text-sm text-neutral-400 hover:text-neutral-200"
          >
            {t("logout")}
          </button>
        </div>
      </div>

      <div className="flex flex-grow flex-col items-center px-4">
        <h1 className="mb-8 mt-4 text-4xl font-semibold text-white">
          {t("lobby")}
        </h1>

        <div className="mb-4 flex w-full max-w-md flex-col gap-2">
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
            <button
              onClick={create}
              disabled={newRoom == ""}
              className="rounded-sm bg-cyan-900 px-4 py-2 text-white hover:bg-cyan-800 disabled:opacity-40"
            >
              {t("create")}
            </button>
          </div>

          <div className="flex flex-row flex-wrap items-center gap-2 rounded-sm bg-neutral-800 px-3 py-2 text-xs">
            <span className="text-neutral-500">{t("blinds")}</span>
            {BLINDS_PRESETS.map(([label, s, b]) => (
              <button
                key={label}
                onClick={() => {
                  setSb(s);
                  setBb(b);
                }}
                className={`rounded-sm px-2 py-1 ${
                  sb === s && bb === b
                    ? "bg-cyan-900 text-white"
                    : "bg-neutral-700 text-neutral-300 hover:bg-neutral-600"
                }`}
              >
                {label}
              </button>
            ))}
            <span className="ml-2 flex flex-row items-center gap-1">
              <input
                type="number"
                min={1}
                value={sb}
                onChange={(e) => setSb(Math.max(1, Number(e.target.value)))}
                className="w-12 rounded-sm bg-neutral-700 px-1 py-0.5 text-white focus:outline-none"
              />
              <span className="text-neutral-500">/</span>
              <input
                type="number"
                min={2}
                value={bb}
                onChange={(e) => setBb(Math.max(2, Number(e.target.value)))}
                className="w-12 rounded-sm bg-neutral-700 px-1 py-0.5 text-white focus:outline-none"
              />
            </span>
          </div>

          <div className="flex flex-row flex-wrap items-center gap-2 rounded-sm bg-neutral-800 px-3 py-2 text-xs">
            <span className="text-neutral-500">{t("buyIn")}</span>
            {BUYIN_PRESETS.map((v) => (
              <button
                key={v}
                onClick={() => setBuyIn(v)}
                className={`rounded-sm px-2 py-1 ${
                  buyIn === v
                    ? "bg-cyan-900 text-white"
                    : "bg-neutral-700 text-neutral-300 hover:bg-neutral-600"
                }`}
              >
                {v}
              </button>
            ))}
            <input
              type="number"
              min={1}
              value={buyIn}
              onChange={(e) => setBuyIn(Math.max(1, Number(e.target.value)))}
              className="ml-2 w-16 rounded-sm bg-neutral-700 px-1 py-0.5 text-white focus:outline-none"
            />
          </div>

          <div className="flex flex-row flex-wrap items-center gap-2 rounded-sm bg-neutral-800 px-3 py-2 text-xs">
            <span className="text-neutral-500">{t("buyIns")}</span>
            {BUYINS_PRESETS.map((v) => (
              <button
                key={v}
                onClick={() => setMaxBuyIns(v)}
                className={`rounded-sm px-2 py-1 ${
                  maxBuyIns === v
                    ? "bg-cyan-900 text-white"
                    : "bg-neutral-700 text-neutral-300 hover:bg-neutral-600"
                }`}
              >
                {v}
              </button>
            ))}
            <input
              type="number"
              min={1}
              value={maxBuyIns}
              onChange={(e) =>
                setMaxBuyIns(Math.max(1, Number(e.target.value)))
              }
              className="ml-2 w-12 rounded-sm bg-neutral-700 px-1 py-0.5 text-white focus:outline-none"
            />
            <span className="ml-2 text-neutral-500">{t("maxPlayers")}</span>
            {PLAYERS_PRESETS.map((v) => (
              <button
                key={v}
                onClick={() => setMaxPlayers(v)}
                className={`rounded-sm px-2 py-1 ${
                  maxPlayers === v
                    ? "bg-cyan-900 text-white"
                    : "bg-neutral-700 text-neutral-300 hover:bg-neutral-600"
                }`}
              >
                {v}
              </button>
            ))}
            <input
              type="number"
              min={2}
              max={8}
              value={maxPlayers}
              onChange={(e) =>
                setMaxPlayers(Math.min(8, Math.max(2, Number(e.target.value))))
              }
              className="ml-2 w-12 rounded-sm bg-neutral-700 px-1 py-0.5 text-white focus:outline-none"
            />
          </div>

          <div className="flex flex-row flex-wrap items-center gap-2 rounded-sm bg-neutral-800 px-3 py-2 text-xs">
            <span className="text-neutral-500">{t("hands")}</span>
            <button
              onClick={() => setHandsLimit(0)}
              className={`rounded-sm px-2 py-1 ${
                handsLimit === 0
                  ? "bg-cyan-900 text-white"
                  : "bg-neutral-700 text-neutral-300 hover:bg-neutral-600"
              }`}
            >
              {t("unlimited")}
            </button>
            {HANDS_PRESETS.map((v) => (
              <button
                key={v}
                onClick={() => setHandsLimit(v)}
                className={`rounded-sm px-2 py-1 ${
                  handsLimit === v
                    ? "bg-cyan-900 text-white"
                    : "bg-neutral-700 text-neutral-300 hover:bg-neutral-600"
                }`}
              >
                {v}
              </button>
            ))}
            <input
              type="number"
              min={0}
              value={handsLimit}
              onChange={(e) =>
                setHandsLimit(Math.max(0, Number(e.target.value)))
              }
              className="ml-2 w-14 rounded-sm bg-neutral-700 px-1 py-0.5 text-white focus:outline-none"
            />
          </div>
        </div>

        <div className="flex w-full max-w-md flex-col gap-4">
          {" "}
          <div className="flex flex-col gap-2">
            <div className="flex flex-row items-center justify-between">
              <p className="text-sm text-neutral-500">{t("rooms")}</p>
              <button
                onClick={() => socket && listTables(socket)}
                className="text-xs text-neutral-500 hover:text-neutral-300"
              >
                {t("refresh")}
              </button>
            </div>
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
          <div className="flex flex-col gap-2">
            <p className="text-sm text-neutral-500">{t("friends")}</p>
            <div className="flex flex-row items-center gap-2">
              <input
                className="flex-1 rounded-sm bg-neutral-700 py-2 pl-4 text-white focus:outline-none"
                type="text"
                value={friendName}
                placeholder={t("friendName")}
                maxLength={20}
                onChange={(e) => setFriendName(e.target.value)}
              />
              <button
                onClick={onAddFriend}
                disabled={friendName == ""}
                className="rounded-sm bg-neutral-700 px-4 py-2 text-white hover:bg-neutral-600 disabled:opacity-40"
              >
                {t("add")}
              </button>
            </div>
            {appState.friends.length === 0 && (
              <p className="text-sm text-neutral-600">{t("noFriends")}</p>
            )}
            {appState.friends.map((f) => (
              <div
                key={f}
                className="flex flex-row items-center justify-between rounded-sm bg-neutral-800 px-4 py-2"
              >
                <p className="text-white">{f}</p>
                <button
                  onClick={() => socket && getUser(socket, f)}
                  className="text-xs text-neutral-500 hover:text-neutral-300"
                >
                  {t("viewStats")}
                </button>
              </div>
            ))}
          </div>
          {showRecharge && <Recharge onClose={() => setShowRecharge(false)} />}
          {showHistory && <History onClose={() => setShowHistory(false)} />}
        </div>
      </div>
      <Footer />
    </div>
  );
}
