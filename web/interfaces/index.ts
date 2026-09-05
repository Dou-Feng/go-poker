export type Message = {
  name: string;
  message: string;
  timestamp: string;
};

export type Log = {
  message: string;
  timestamp: string;
};

export type Friend = {
  uuid: string;
  username: string;
  avatar: string;
  avatarImage: boolean;
};

export type AppState = {
  messages: Message[];
  logs: Log[];
  username: string | null;
  uuid: string | null;
  clientID: string | null;
  table: string | null;
  game: Game | null;
  tables: TableInfo[];
  authError: string | null;
  chips: number | null;
  avatar: string | null;
  avatarImage: boolean;
  avatarVersion: number;
  friends: Friend[];
  stats: PlayerStats | null;
  profile: Profile | null;
  history: HistoryRecord[];
  settlement: Settlement | null;
  language: "en" | "zh";
};

export type TableInfo = {
  name: string;
  players: number;
  running: boolean;
  spectators: number;
  locked: boolean;
  tournament: boolean;
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
  uuid?: string;
  username: string;
  avatar: string;
  avatarImage: boolean;
  chips: number;
  friends: Friend[];
  stats: PlayerStats;
  buyIn?: number;
  net?: number;
};

export type HistoryRecord = {
  room: string;
  username: string;
  uuid?: string;
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
  accountUuid: string;
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
  revealed: boolean;
  bestHand: string;
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
  departedPlayers: Player[];
  pots: Pot[];
  minRaise: number;
  readyCount: number;
  waiting: string[];
  settleVotes: string[];
  handsPlayed: number;
  biggestPotAmt: number;
  biggestPotWinners: number[];
};

export type Config = {
  maxBuy: number;
  bb: number;
  sb: number;
  buyIn: number;
  maxPlayers: number;
  handsLimit: number;
};

export type Pot = {
  topShare: number;
  amount: number;
  eligiblePlayerNums: number[];
  winningPlayerNums: number[];
  winningHand: Card[];
  winningScore: number;
};

export type SettlementPlayer = {
  username: string;
  uuid: string;
  avatar: string;
  avatarImage: boolean;
  buyIn: number;
  net: number;
};

export type Settlement = {
  players: SettlementPlayer[];
  biggestPotWinner: string;
  biggestPotAmount: number;
};
