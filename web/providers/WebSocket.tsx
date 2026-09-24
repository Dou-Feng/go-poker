import {
  createContext,
  ReactChild,
  useEffect,
  useState,
  useContext,
} from "react";
import { AppContext } from "../providers/AppStore";
import {
  Message,
  Game,
  Log,
  TableInfo,
  PlayerStats,
  Profile,
  HistoryRecord,
  SessionRecord,
} from "../interfaces";
import {
  clearSession,
  clearTabAuth,
  clearUser,
  loadSession,
  loadUsername,
  markTabAuth,
  saveSession,
  saveToken,
  saveUser,
  saveUsername,
  loadUser,
  loadToken,
  tabAuthAccount,
} from "../lib/session";
import {
  createSocketConnection,
  ConnectionStatus,
} from "../lib/socketConnection";
import { emitFx } from "../lib/fxBus";
import { voice } from "../lib/voice";
import {
  applyAccountSettings,
  hasStoredSettings,
  pushSettingsNow,
  setSettingsAccount,
  setSettingsSocket,
} from "../lib/settings";

/*  
WebSocket context creates a single connection to the server per client. 
It handles opening, closing, and error handling of the websocket. It also
dispatches websocket messages to update the central state store. 
*/

export const SocketContext = createContext<WebSocket | null>(null);
export const ConnectionContext = createContext<ConnectionStatus>("connecting");

type SocketProviderProps = {
  children: ReactChild;
};

export function SocketProvider(props: SocketProviderProps) {
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const { dispatch } = useContext(AppContext);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");

  useEffect(() => {
    // WebSocket api is browser side only.
    const isBrowser = typeof window !== "undefined";
    if (!isBrowser) {
      return;
    }

    // Production serves the static bundle and the socket from the same Go
    // binary. Over https the socket is wss on the page's own host (the TLS
    // listener, 443 by default); over plain http the backend listens on
    // 8080, which is also where `next dev` on :3000 finds it.
    const wsUrl =
      process.env.NEXT_PUBLIC_WS_URL ??
      (window.location.protocol === "https:"
        ? `wss://${window.location.host}/ws`
        : `ws://${window.location.hostname}:8080/ws`);
    let abandonedRoom = false;
    const connection = createSocketConnection({
      url: wsUrl,
      onStatus: setStatus,
      onOpen: (ws) => {
        setSocket(ws);
        voice.setSocket(ws);
        voice.onSocketConnected();
        setSettingsSocket(ws);
      },
      onDisconnect: () => {
        setSocket(null);
        voice.setSocket(null);
        setSettingsSocket(null);
      },
      onTimeout: () => {
        const wasInRoom = !!loadSession()?.table;
        abandonedRoom = true;
        clearSession();
        voice.leaveRoom();
        dispatch({ type: "leaveRoom" });
        dispatch({ type: "setSettlement", payload: null });
        dispatch({ type: "setProfile", payload: null });
        dispatch({ type: "setSessionView", payload: null });
        if (wasInRoom) {
          dispatch({ type: "setNotice", payload: "connectionLost" });
        }
      },
      onMessage: (e, ws) => {
        const event = JSON.parse(e.data);
        if (event.action === "pong") {
          if (!loadUser() || !loadToken() || tabAuthAccount() !== loadUser())
            connection.ready();
          return;
        }
        // Authentication can restore an orphaned seat automatically. After
        // giving up on that room, release it instead of pulling the user
        // straight back from the lobby. A deliberate new join ends this guard.
        if (abandonedRoom) {
          if (
            (event.action === "join-result" ||
              event.action === "create-result") &&
            event.ok
          ) {
            abandonedRoom = false;
          } else if (event.action === "update-player-uuid") {
            if (event.tablename) {
              ws.send(
                JSON.stringify({
                  action: "leave-table",
                  tablename: event.tablename,
                })
              );
            }
            return;
          } else if (
            event.action === "update-game" ||
            event.action === "settlement"
          ) {
            return;
          }
        }
        switch (event.action) {
          case "new-message":
            let newMessage: Message = {
              name: event.username,
              message: event.message,
              timestamp: event.timestamp,
            };
            dispatch({ type: "addMessage", payload: newMessage });
            return;
          case "new-log":
            let newLog: Log = {
              message: event.message,
              timestamp: event.timestamp,
            };
            dispatch({ type: "addLog", payload: newLog });
            return;
          case "update-game":
            let newGame: Game = {
              running: event.game.running,
              dealer: event.game.dealer,
              action: event.game.action,
              utg: event.game.utg,
              sb: event.game.sb,
              bb: event.game.bb,
              communityCards: event.game.communityCards,
              stage: event.game.stage,
              betting: event.game.betting,
              config: event.game.config,
              players: event.game.players,
              departedPlayers: event.game.departedPlayers ?? [],
              pots: event.game.pots,
              minRaise: event.game.minRaise,
              readyCount: event.game.readyCount,
              reserved: event.reserved ?? [],
              spectators: event.spectators ?? [],
              settleVotes: event.settleVotes ?? [],
              host: event.host ?? "",
              busted: event.busted ?? false,
              actionTimeout: event.actionTimeout ?? 0,
              locked: event.locked ?? false,
              createdAt: event.createdAt ?? 0,
              botType: event.botType ?? "normal",
              // The server sends time *left*, so a phone whose clock is off
              // by minutes still counts down correctly.
              actionDeadline:
                event.actionRemainingMs != null && event.actionRemainingMs > 0
                  ? Date.now() + event.actionRemainingMs
                  : null,
              handsPlayed: event.game.handsPlayed ?? 0,
              biggestPotAmt: event.game.biggestPotAmt ?? 0,
              biggestPotWinners: event.game.biggestPotWinners ?? [],
            };
            dispatch({ type: "updateGame", payload: newGame });
            connection.ready();
            emitFx(newGame);
            return;
          case "update-player-uuid":
            dispatch({ type: "updatePlayerID", payload: event.uuid });
            if (event.tablename) {
              // The server handed us a seat we did not join ourselves (a
              // session takeover or an orphaned-seat claim): own the room in
              // the app state and persist the session so a refresh restores
              // it.
              dispatch({ type: "setTablename", payload: event.tablename });
              const existing = loadSession();
              saveSession({
                username: existing?.username ?? loadUsername() ?? "",
                table: event.tablename,
                clientID: event.uuid,
              });
            } else {
              const existing = loadSession();
              if (existing) {
                saveSession({ ...existing, clientID: event.uuid });
              }
            }
            return;
          case "register-result":
            if (event.ok) {
              if (event.uuid) {
                saveUser(event.uuid);
                markTabAuth(event.uuid);
                dispatch({ type: "setUuid", payload: event.uuid });
              }
              if (event.token) {
                saveToken(event.token);
              }
              saveUsername(event.username);
              dispatch({ type: "setUsername", payload: event.username });
              dispatch({ type: "setAuthError", payload: null });
            } else {
              dispatch({
                type: "setAuthError",
                payload: event.message ?? "Username unavailable",
              });
            }
            return;
          case "login-result":
            if (event.ok) {
              if (event.uuid) {
                saveUser(event.uuid);
                markTabAuth(event.uuid);
                dispatch({ type: "setUuid", payload: event.uuid });
              }
              if (event.token) {
                saveToken(event.token);
              }
              saveUsername(event.username);
              dispatch({ type: "setUsername", payload: event.username });
              dispatch({ type: "setAuthError", payload: null });
            } else {
              dispatch({
                type: "setAuthError",
                payload: event.message ?? "Invalid credentials",
              });
            }
            return;
          case "change-username-result":
            if (event.ok) {
              if (event.uuid) {
                saveUser(event.uuid);
                dispatch({ type: "setUuid", payload: event.uuid });
              }
              saveUsername(event.username);
              dispatch({ type: "setUsername", payload: event.username });
              dispatch({ type: "setProfile", payload: null });
              const existing = loadSession();
              if (existing) {
                saveSession({ ...existing, username: event.username });
              }
            } else {
              dispatch({
                type: "setAuthError",
                payload: event.message ?? "could not save user",
              });
            }
            return;
          case "table-list":
            dispatch({
              type: "setTables",
              payload: (event.tables ?? []) as TableInfo[],
            });
            dispatch({
              type: "setAIAvailable",
              payload: !!event.aiAvailable,
            });
            return;
          case "create-result":
            if (!event.ok) {
              dispatch({ type: "leaveRoom" });
              dispatch({
                type: "setAuthError",
                payload: event.message ?? "Could not create room",
              });
            }
            return;
          case "join-result":
            if (event.ok) {
              dispatch({ type: "clearGame" });
              dispatch({ type: "setTablename", payload: event.tablename });
              saveSession({
                username: loadUsername() ?? "",
                table: event.tablename,
                clientID: null,
              });
              dispatch({ type: "setAuthError", payload: null });
            } else {
              dispatch({
                type: "setAuthError",
                payload: event.message ?? "Could not join room",
              });
            }
            return;
          case "user-info": {
            const stats: PlayerStats = event.stats ?? {
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
            };
            if (event.self) {
              if (!loadSession()?.table) connection.ready();
              saveUser(event.uuid);
              dispatch({ type: "setUuid", payload: event.uuid ?? null });
              // Preferences stored on the account follow the player across
              // devices. The account wins once it has any; an account that
              // has never synced (new player, or from before this feature)
              // adopts what this browser already had, so nobody loses their
              // setup. See lib/settings.ts.
              const stored = hasStoredSettings(event.settings);
              if (stored) {
                const lang = applyAccountSettings(event.settings);
                if (lang) {
                  dispatch({ type: "setLanguage", payload: lang });
                }
              }
              // Preferences may only be pushed for a signed-in account, and
              // an account that has never synced adopts this browser's setup
              // so nobody loses what they had. See lib/settings.ts.
              setSettingsAccount(event.uuid ?? null);
              if (!stored) {
                pushSettingsNow();
              }
              // The server's record is authoritative for the display name:
              // after a refresh the client only has the cached username (or
              // nothing) until this reply arrives.
              if (event.username) {
                saveUsername(event.username);
                dispatch({ type: "setUsername", payload: event.username });
                const existing = loadSession();
                if (existing && existing.username !== event.username) {
                  saveSession({ ...existing, username: event.username });
                }
              }
              dispatch({ type: "setChips", payload: event.chips ?? 0 });
              dispatch({ type: "setAvatar", payload: event.avatar ?? "🙂" });
              dispatch({
                type: "setAvatarImage",
                payload: !!event.avatarImage,
              });
              dispatch({ type: "setFriends", payload: event.friends ?? [] });
              dispatch({ type: "setStats", payload: stats });
            } else {
              const profile: Profile = {
                uuid: event.uuid,
                username: event.username,
                avatar: event.avatar ?? "🙂",
                avatarImage: !!event.avatarImage,
                chips: event.chips ?? 0,
                friends: event.friends ?? [],
                stats,
              };
              dispatch({ type: "setProfile", payload: profile });
            }
            return;
          }
          case "error":
            dispatch({
              type: "setAuthError",
              payload: event.message ?? "Something went wrong",
            });
            return;
          case "session-expired": {
            connection.ready();
            // No tablename means the account-level session is over (another
            // device logged in, or the server's Redis was reset): forget the
            // login and return to the register screen instead of showing a
            // lobby with no account.
            if (!event.tablename) {
              clearUser();
              clearSession();
              clearTabAuth();
              // Signed out: stop mirroring preferences to the account.
              setSettingsAccount(null);
              dispatch({ type: "resetGame" });
              dispatch({
                type: "setAuthError",
                payload: event.message ?? "login expired",
              });
              return;
            }
            // The saved room was recycled or our seat was released while we
            // were away: forget the session and go back to the lobby instead
            // of showing a dead room.
            const existing = loadSession();
            if (!existing || existing.table === event.tablename) {
              clearSession();
            }
            dispatch({ type: "leaveRoom" });
            dispatch({
              type: "setAuthError",
              payload: event.message ?? "room closed",
            });
            return;
          }
          case "history":
            dispatch({
              type: "setHistory",
              payload: (event.history ?? []) as HistoryRecord[],
            });
            return;
          case "session":
            dispatch({
              type: "setSessionView",
              payload: (event.session ?? null) as SessionRecord | null,
            });
            return;
          case "livekit-token":
            // LiveKit access token for in-room voice chat; it never touches
            // the app store (see lib/voice.ts and backend/server/livekit.go).
            voice.setLiveKitToken(
              event.url ?? "",
              event.token ?? "",
              event.ttl ?? 0
            );
            return;
          case "settings-result":
            // Ack for a preference push; nothing to do unless it failed, and
            // failures arrive separately as an `error` message.
            return;
          case "settlement":
            dispatch({
              type: "setSettlement",
              payload: {
                players: event.players ?? [],
                biggestPotWinner: event.biggestPotWinner ?? "",
                biggestPotAmount: event.biggestPotAmount ?? 0,
              },
            });
            dispatch({ type: "clearGame" });
            // Refresh the wallet balance after the session has been flushed.
            ws?.send(JSON.stringify({ action: "get-user" }));
            return;
          default:
            console.warn("unknown websocket action", event.action);
            return;
        }
      },
    });
    return () => connection.dispose();
  }, [dispatch]);

  return (
    <ConnectionContext.Provider value={status}>
      <SocketContext.Provider value={socket}>
        {props.children}
      </SocketContext.Provider>
    </ConnectionContext.Provider>
  );
}
