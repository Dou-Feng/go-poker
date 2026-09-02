export type Message = {
    name: string;
    message: string;
    timestamp: string;
};

export type Log = {
    message: string;
    timestamp: string;
};

export type AppState = {
    messages: Message[];
    logs: Log[];
    username: string | null;
    clientID: string | null;
    table: string | null;
    game: Game | null;
    tables: TableInfo[];
    authError: string | null;
    chips: number | null;
    avatar: string | null;
    avatarImage: boolean;
    avatarVersion: number;
    friends: string[];
    stats: PlayerStats | null;
    profile: Profile | null;
    history: HistoryRecord[];
    language: "en" | "zh";
};

export type TableInfo = {
    name: string;
    players: number;
    running: boolean;
    spectators: number;
    locked: boolean;
};

export type PlayerStats = {
    handsPlayed: number;
    handsWon: number;
    folds: number;
    calls: number;
    raises: number;
    threeBets: number;
    maxPotWon: number;
    vpip: number;
    vpipByPos: number[];
};

export type Profile = {
    username: string;
    avatar: string;
    avatarImage: boolean;
    chips: number;
    friends: string[];
    stats: PlayerStats;
    buyIn?: number;
    net?: number;
};

export type HistoryRecord = {
    room: string;
    username: string;
    time: string;
    buyIn: number;
    net: number;
    avatar: string;
    avatarImage: boolean;
    stats: PlayerStats;
};

export type Card = string;

export type Player = {
    username: string;
    uuid: string;
    position: number;
    seatID: number;
    ready: boolean;
    in: boolean;
    called: boolean;
    left: boolean;
    totalBuyIn: number;
    stack: number;
    bet: number;
    totalBet: number;
    cards: Card[];
    stats: PlayerStats;
    avatar: string;
    avatarImage: boolean;
};

export type Game = {
    running: boolean;
    dealer: number;
    action: number;
    utg: number;
    sb: number;
    bb: number;
    communityCards: Card[];
    stage: number;
    betting: boolean;
    config: Config;
    players: Player[];
    pots: Pot[];
    minRaise: number;
    readyCount: number;
};

export type Config = {
    maxBuy: number;
    bb: number;
    sb: number;
    buyIn: number;
    maxPlayers: number;
};

export type Pot = {
    topShare: number;
    amount: number;
    eligiblePlayerNums: number[];
    winningPlayerNums: number[];
    winningHand: Card[];
    winningScore: number;
};
