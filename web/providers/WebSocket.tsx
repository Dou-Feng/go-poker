import { createContext, ReactChild, useEffect, useState, useContext } from "react";
import { AppContext } from "../providers/AppStore";
import { Message, Game, Log, TableInfo, PlayerStats, Profile, HistoryRecord } from "../interfaces";
import { loadSession, saveSession, saveUser } from "../lib/session";

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

        const wsUrl =
            process.env.NEXT_PUBLIC_WS_URL ??
            `${window.location.origin.replace("http", "ws")}/ws`;
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
                console.log("websocket connected");
                lastPongAt = Date.now();
                setSocket(ws);
            };
            ws.onclose = () => {
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
                        pots: event.game.pots,
                        minRaise: event.game.minRaise,
                        readyCount: event.game.readyCount,
                    };
                    dispatch({ type: "updateGame", payload: newGame });
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
                        saveUser(event.username);
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
                        saveUser(event.username);
                        dispatch({ type: "setUsername", payload: event.username });
                        dispatch({ type: "setAuthError", payload: null });
                    } else {
                        dispatch({
                            type: "setAuthError",
                            payload: event.message ?? "Invalid credentials",
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
                        dispatch({ type: "setChips", payload: event.chips ?? 0 });
                        dispatch({ type: "setAvatar", payload: event.avatar ?? "🙂" });
                        dispatch({ type: "setAvatarImage", payload: !!event.avatarImage });
                        dispatch({ type: "setFriends", payload: event.friends ?? [] });
                        dispatch({ type: "setStats", payload: stats });
                    } else {
                        const profile: Profile = {
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
                    dispatch({ type: "setAuthError", payload: event.message ?? "Something went wrong" });
                    return;
                case "history":
                    dispatch({
                        type: "setHistory",
                        payload: (event.history ?? []) as HistoryRecord[],
                    });
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

    return <SocketContext.Provider value={socket}>{props.children}</SocketContext.Provider>;
}
