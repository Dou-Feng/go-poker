import { createContext, useReducer, ReactChild } from "react";
import { AppState, Message, Game, Log, TableInfo, PlayerStats, Profile, HistoryRecord } from "../interfaces";
import { Language } from "../lib/translations";
import { initialLanguage } from "../lib/language";

const initialState: AppState = {
    messages: [],
    logs: [],
    username: null,
    clientID: null,
    table: null,
    game: null,
    tables: [],
    authError: null,
    chips: null,
    avatar: null,
    avatarImage: false,
    friends: [],
    stats: null,
    profile: null,
    history: [],
    language: initialLanguage(),
};

type ACTIONTYPE =
    | { type: "addMessage"; payload: Message }
    | { type: "addLog"; payload: Log }
    | { type: "setUsername"; payload: string }
    | { type: "updateGame"; payload: Game }
    | { type: "resetGame" }
    | { type: "leaveRoom" }
    | { type: "updatePlayerID"; payload: string }
    | { type: "setTablename"; payload: string }
    | { type: "setTables"; payload: TableInfo[] }
    | { type: "setAuthError"; payload: string | null }
    | { type: "setChips"; payload: number }
    | { type: "setAvatar"; payload: string }
    | { type: "setAvatarImage"; payload: boolean }
    | { type: "setFriends"; payload: string[] }
    | { type: "setStats"; payload: PlayerStats }
    | { type: "setProfile"; payload: Profile | null }
    | { type: "setHistory"; payload: HistoryRecord[] }
    | { type: "setLanguage"; payload: Language };

function reducer(state: AppState, action: ACTIONTYPE) {
    switch (action.type) {
        case "addMessage":
            return { ...state, messages: [...state.messages, action.payload] };
        case "addLog":
            return { ...state, logs: [...state.logs, action.payload] };
        case "setUsername":
            return { ...state, username: action.payload };
        case "updateGame":
            return { ...state, game: action.payload };
        case "resetGame":
            return { ...state, clientID: null, username: null, game: null, table: null };
        case "leaveRoom":
            return { ...state, clientID: null, game: null, table: null };
        case "updatePlayerID":
            return { ...state, clientID: action.payload };
        case "setTablename":
            return { ...state, table: action.payload };
        case "setTables":
            return { ...state, tables: action.payload };
        case "setAuthError":
            return { ...state, authError: action.payload };
        case "setChips":
            return { ...state, chips: action.payload };
        case "setAvatar":
            return { ...state, avatar: action.payload };
        case "setAvatarImage":
            return { ...state, avatarImage: action.payload };
        case "setFriends":
            return { ...state, friends: action.payload };
        case "setStats":
            return { ...state, stats: action.payload };
        case "setProfile":
            return { ...state, profile: action.payload };
        case "setHistory":
            return { ...state, history: action.payload };
        case "setLanguage":
            return { ...state, language: action.payload };
        default:
            throw new Error();
    }
}

export const AppContext = createContext<{
    appState: AppState;
    dispatch: React.Dispatch<any>;
}>({ appState: initialState, dispatch: () => null });

type StoreProviderProps = {
    children: ReactChild;
};

export function AppStoreProvider(props: StoreProviderProps) {
    const [appState, dispatch] = useReducer(reducer, initialState);

    return (
        <AppContext.Provider value={{ appState, dispatch }}>{props.children}</AppContext.Provider>
    );
}
