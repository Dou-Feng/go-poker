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
} from "../interfaces";
import {
  clearSession,
  clearUser,
  loadSession,
  saveSession,
  saveUser,
  saveUsername,
} from "../lib/session";
import { emitFx } from "../lib/fxBus";

/*  
WebSocket context creates a single connection to the server per client. 
It handles opening, closing, and error handling of the websocket. It also
dispatches websocket messages to update the central state store. 
*/

export const SocketContext = createContext<WebSocket | null>(null);

type SocketProviderProps = {
  children: ReactChild;
};

export function SocketProvider(props: SocketProviderProps) {
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const { dispatch } = useContext(AppContext);

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
    let ws: WebSocket | null = null;
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let lastPongAt = 0;

    const scheduleReconnect = () => {
      if (disposed) {
        return;
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      reconnectTimer = setTimeout(connect, 1000);
    };

    const connect = () => {
      if (disposed) {
        return;
      }
      console.log("websocket url: ", wsUrl);
      ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        // A stale socket from a previous effect pass (React StrictMode
        // mounts twice in dev) may still be draining; only the live one
        // updates state.
        if (disposed) {
          ws?.close();
          return;
        }
        console.log("websocket connected");
        lastPongAt = Date.now();
        setSocket(ws);
      };
      ws.onclose = () => {
        // StrictMode's first-pass socket is closed intentionally by the
        // cleanup; that close must not trigger a reconnect (the second
        // mount owns the connection now).
        if (disposed) {
          console.log("websocket closed (stale)");
          return;
        }
        console.log("websocket disconnected");
        setSocket(null);
        scheduleReconnect();
      };
      ws.onerror = (error) => {
        console.error("websocket error: ", error);
      };
      ws.onmessage = (e) => {
        const event = JSON.parse(e.data);
        if (event.action === "pong") {
          lastPongAt = Date.now();
          return;
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
              waiting: event.waiting ?? [],
              settleVotes: event.settleVotes ?? [],
              handsPlayed: event.game.handsPlayed ?? 0,
              biggestPotAmt: event.game.biggestPotAmt ?? 0,
              biggestPotWinners: event.game.biggestPotWinners ?? [],
            };
            dispatch({ type: "updateGame", payload: newGame });
            emitFx(newGame);
            return;
          case "update-player-uuid":
            dispatch({ type: "updatePlayerID", payload: event.uuid });
            {
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
                dispatch({ type: "setUuid", payload: event.uuid });
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
                dispatch({ type: "setUuid", payload: event.uuid });
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
            };
            if (event.self) {
              saveUser(event.uuid);
              dispatch({ type: "setUuid", payload: event.uuid ?? null });
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
            // No tablename means the account itself is gone (e.g. the
            // server's Redis was reset): forget the login and return to the
            // register screen instead of showing a lobby with no account.
            if (!event.tablename) {
              clearUser();
              clearSession();
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
            throw new Error();
        }
      };
    };

    const sendPing = () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ action: "ping" }));
        } catch {
          try {
            ws.close();
          } catch {
            // ignore
          }
          scheduleReconnect();
        }
      }
    };

    // Detect silently-dead connections. This is common on iOS when the
    // page is backgrounded: the socket is killed without onclose firing.
    heartbeatTimer = setInterval(() => {
      sendPing();
      if (Date.now() - lastPongAt > 45000) {
        try {
          ws?.close();
        } catch {
          // ignore
        }
        scheduleReconnect();
      }
    }, 15000);

    const handleVisibility = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        scheduleReconnect();
        return;
      }
      // The socket may have been killed while backgrounded even though
      // the browser still reports it as open. Probe it and reconnect if
      // the server does not answer.
      const before = lastPongAt;
      sendPing();
      setTimeout(() => {
        if (!disposed && lastPongAt === before) {
          try {
            ws?.close();
          } catch {
            // ignore
          }
          scheduleReconnect();
        }
      }, 2500);
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleVisibility);
    window.addEventListener("pageshow", handleVisibility);

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleVisibility);
      window.removeEventListener("pageshow", handleVisibility);
      ws?.close();
    };
  }, [dispatch]);

  return (
    <SocketContext.Provider value={socket}>
      {props.children}
    </SocketContext.Provider>
  );
}
