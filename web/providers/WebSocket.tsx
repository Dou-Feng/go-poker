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

        const wsUrl = `${window.location.origin.replace("http", "ws")}/ws`;
        console.log("websocket url: ", wsUrl);

        const ws = new WebSocket(wsUrl);
        ws.onopen = () => {
            console.log("websocket connected");
        };
        ws.onclose = () => {
            console.log("websocket disconnected");
        };
        ws.onerror = (error) => {
            console.error("websocket error: ", error);
        };
        ws.onmessage = (e) => {
            let event = JSON.parse(e.data);
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

        setSocket(ws);

        return () => {
            ws.close();
        };
    }, [dispatch]);

    return <SocketContext.Provider value={socket}>{props.children}</SocketContext.Provider>;
}
