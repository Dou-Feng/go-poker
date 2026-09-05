// send safely queues messages when the socket is still connecting and drops
// them once the socket is closed, avoiding "Still in CONNECTING state" errors.
function send(socket: WebSocket | null | undefined, payload: object) {
  if (!socket) {
    return;
  }
  const data = JSON.stringify(payload);
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(data);
  } else if (socket.readyState === WebSocket.CONNECTING) {
    socket.addEventListener("open", () => socket.send(data), { once: true });
  }
}

// joinTable joins a room. Pass reconnect=true when replaying a saved session
// (page reload / socket reconnect): the server then never creates the room and
// answers with "session-expired" if the room or seat is gone.
export function joinTable(
  socket: WebSocket,
  tablename: string,
  playerUUID?: string,
  password?: string,
  reconnect?: boolean
) {
  send(socket, {
    action: "join-table",
    tablename: tablename,
    ...(playerUUID ? { playerUUID } : {}),
    ...(password ? { password } : {}),
    ...(reconnect ? { reconnect: true } : {}),
  });
}

export function leaveTable(socket: WebSocket, tablename: string) {
  send(socket, {
    action: "leave-table",
    tablename: tablename,
  });
}

export function sendMessage(
  socket: WebSocket,
  username: string,
  message: string
) {
  send(socket, {
    action: "send-message",
    username: username,
    message: message,
  });
}

export function sendLog(socket: WebSocket, message: string) {
  send(socket, {
    action: "send-log",
    message: message,
  });
}

export function takeSeat(
  socket: WebSocket,
  username: string,
  seatID: number,
  buyIn: number
) {
  send(socket, {
    action: "take-seat",
    username: username,
    seatID: seatID,
    buyIn: buyIn,
  });
}

export function startGame(socket: WebSocket) {
  send(socket, {
    action: "start-game",
  });
}

export function resetGame(socket: WebSocket) {
  send(socket, {
    action: "reset-game",
  });
}

export function dealGame(socket: WebSocket) {
  send(socket, {
    action: "deal-game",
  });
}

export function newPlayer(socket: WebSocket, username: string) {
  send(socket, {
    action: "new-player",
    username: username,
  });
}

export function registerUser(
  socket: WebSocket,
  username: string,
  uuid: string,
  password: string,
  avatar: string
) {
  send(socket, {
    action: "register-user",
    username: username,
    uuid: uuid,
    password: password,
    avatar: avatar,
  });
}

export function login(socket: WebSocket, identifier: string, password: string) {
  send(socket, {
    action: "login",
    identifier: identifier,
    password: password,
  });
}

export function addFriend(socket: WebSocket, uuid: string) {
  send(socket, {
    action: "add-friend",
    uuid: uuid,
  });
}

export function setAvatar(socket: WebSocket, avatar: string) {
  send(socket, {
    action: "set-avatar",
    avatar: avatar,
  });
}

export function reconnectUser(socket: WebSocket, uuid: string) {
  send(socket, {
    action: "reconnect-user",
    uuid: uuid,
  });
}

export function changeUsername(socket: WebSocket, newUsername: string) {
  send(socket, {
    action: "change-username",
    newUsername: newUsername,
  });
}

export function listTables(socket: WebSocket) {
  send(socket, {
    action: "list-tables",
  });
}

export type CreateTableOptions = {
  password?: string;
  sb?: number;
  bb?: number;
  buyIn?: number;
  maxBuy?: number;
  maxPlayers?: number;
  handsLimit?: number;
  /** Enforce the buy-in cap (maxBuy); off = unlimited rebuys. */
  tournament?: boolean;
};

export function createTable(
  socket: WebSocket,
  tablename: string,
  options?: CreateTableOptions
) {
  send(socket, {
    action: "create-table",
    tablename: tablename,
    ...(options ?? {}),
  });
}

export function addChips(socket: WebSocket, amount: number) {
  send(socket, {
    action: "add-chips",
    amount: amount,
  });
}

export function rebuy(socket: WebSocket, amount: number) {
  send(socket, {
    action: "rebuy",
    amount: amount,
  });
}

export function undoBuyIn(socket: WebSocket) {
  send(socket, {
    action: "undo-buyin",
  });
}

export function getUser(socket: WebSocket, uuid?: string) {
  send(socket, {
    action: "get-user",
    ...(uuid ? { uuid } : {}),
  });
}

export function getHistory(socket: WebSocket) {
  send(socket, {
    action: "get-history",
  });
}

// Fetch the shared scoreboard of a past room session (a history entry's
// sessionId). Only its participants may read it.
export function getSession(socket: WebSocket, id: string) {
  send(socket, {
    action: "get-session",
    id,
  });
}

export function toggleReady(socket: WebSocket) {
  send(socket, {
    action: "toggle-ready",
  });
}

export function queueNext(socket: WebSocket) {
  send(socket, {
    action: "queue-next",
  });
}

export function moveSeat(socket: WebSocket, seatID: number) {
  send(socket, {
    action: "move-seat",
    seatID: seatID,
  });
}

export function voteSettle(socket: WebSocket) {
  send(socket, {
    action: "vote-settle",
  });
}

export function showHand(socket: WebSocket) {
  send(socket, {
    action: "show-hand",
  });
}

export function spectate(socket: WebSocket) {
  send(socket, {
    action: "spectate",
  });
}

export function playerCall(socket: WebSocket) {
  send(socket, {
    action: "player-call",
  });
}

export function playerCheck(socket: WebSocket) {
  send(socket, {
    action: "player-check",
  });
}

export function playerRaise(socket: WebSocket, amount: number) {
  send(socket, {
    action: "player-raise",
    amount: amount,
  });
}

export function playerFold(socket: WebSocket) {
  send(socket, {
    action: "player-fold",
  });
}

// Seat a server-played bot between hands at seatID (0 = first free) / remove
// one (the given seat, or the last added). Host only.
export function addBot(socket: WebSocket, seatID?: number) {
  send(socket, { action: "add-bot", ...(seatID ? { seatID } : {}) });
}

export function removeBot(socket: WebSocket, uuid?: string) {
  send(socket, { action: "remove-bot", ...(uuid ? { uuid } : {}) });
}

// Ask for the STUN/TURN servers (and short-lived TURN credentials) to use for
// voice chat. `host` is the page's hostname, used by the server when TURN_HOST
// is not configured (coturn runs next to the game server).
export function getIceServers(socket: WebSocket, host: string) {
  send(socket, {
    action: "get-ice-servers",
    ...(host ? { host } : {}),
  });
}

// Voice-chat signalling. The server relays the message to the account named
// by `to` (or to everyone else in the room when `to` is empty) and stamps it
// with our account UUID; see backend/server/voice.go.
export type VoiceSignalKind =
  | "join"
  | "leave"
  | "state"
  | "offer"
  | "answer"
  | "ice";

export function sendVoiceSignal(
  socket: WebSocket,
  to: string | null,
  kind: VoiceSignalKind,
  payload?: unknown
) {
  send(socket, {
    action: "voice-signal",
    ...(to ? { to } : {}),
    kind,
    ...(payload !== undefined ? { payload } : {}),
  });
}
