export function joinTable(
    socket: WebSocket,
    tablename: string,
    playerUUID?: string,
    password?: string
) {
    socket.send(
        JSON.stringify({
            action: "join-table",
            tablename: tablename,
            ...(playerUUID ? { playerUUID } : {}),
            ...(password ? { password } : {}),
        })
    );
}

export function leaveTable(socket: WebSocket, tablename: string) {
    socket.send(
        JSON.stringify({
            action: "leave-table",
            tablename: tablename,
        })
    );
}

export function sendMessage(socket: WebSocket, username: string, message: string) {
    socket.send(
        JSON.stringify({
            action: "send-message",
            username: username,
            message: message,
        })
    );
}

export function sendLog(socket: WebSocket, message: string) {
    socket.send(
        JSON.stringify({
            action: "send-log",
            message: message,
        })
    );
}

export function takeSeat(socket: WebSocket, username: string, seatID: number, buyIn: number) {
    socket.send(
        JSON.stringify({
            action: "take-seat",
            username: username,
            seatID: seatID,
            buyIn: buyIn,
        })
    );
}

export function startGame(socket: WebSocket) {
    socket.send(
        JSON.stringify({
            action: "start-game",
        })
    );
}

export function resetGame(socket: WebSocket) {
    socket.send(
        JSON.stringify({
            action: "reset-game",
        })
    );
}

export function dealGame(socket: WebSocket) {
    socket.send(
        JSON.stringify({
            action: "deal-game",
        })
    );
}

export function newPlayer(socket: WebSocket, username: string) {
    socket?.send(
        JSON.stringify({
            action: "new-player",
            username: username,
        })
    );
}

export function registerUser(socket: WebSocket, username: string, password: string, avatar: string) {
    socket.send(
        JSON.stringify({
            action: "register-user",
            username: username,
            password: password,
            avatar: avatar,
        })
    );
}

export function login(socket: WebSocket, username: string, password: string) {
    socket.send(
        JSON.stringify({
            action: "login",
            username: username,
            password: password,
        })
    );
}

export function addFriend(socket: WebSocket, username: string) {
    socket.send(
        JSON.stringify({
            action: "add-friend",
            username: username,
        })
    );
}

export function setAvatar(socket: WebSocket, avatar: string) {
    socket.send(
        JSON.stringify({
            action: "set-avatar",
            avatar: avatar,
        })
    );
}

export function reconnectUser(socket: WebSocket, username: string) {
    socket.send(
        JSON.stringify({
            action: "reconnect-user",
            username: username,
        })
    );
}

export function listTables(socket: WebSocket) {
    socket.send(
        JSON.stringify({
            action: "list-tables",
        })
    );
}

export type CreateTableOptions = {
    password?: string;
    sb?: number;
    bb?: number;
    buyIn?: number;
    maxBuyIns?: number;
    maxPlayers?: number;
};

export function createTable(socket: WebSocket, tablename: string, options?: CreateTableOptions) {
    socket.send(
        JSON.stringify({
            action: "create-table",
            tablename: tablename,
            ...(options ?? {}),
        })
    );
}

export function addChips(socket: WebSocket, amount: number) {
    socket.send(
        JSON.stringify({
            action: "add-chips",
            amount: amount,
        })
    );
}

export function rebuy(socket: WebSocket, amount: number) {
    socket.send(
        JSON.stringify({
            action: "rebuy",
            amount: amount,
        })
    );
}

export function getUser(socket: WebSocket, username?: string) {
    socket.send(
        JSON.stringify({
            action: "get-user",
            ...(username ? { username } : {}),
        })
    );
}

export function getHistory(socket: WebSocket) {
    socket.send(
        JSON.stringify({
            action: "get-history",
        })
    );
}

export function playerCall(socket: WebSocket) {
    socket?.send(
        JSON.stringify({
            action: "player-call",
        })
    );
}

export function playerCheck(socket: WebSocket) {
    socket?.send(
        JSON.stringify({
            action: "player-check",
        })
    );
}

export function playerRaise(socket: WebSocket, amount: number) {
    socket?.send(
        JSON.stringify({
            action: "player-raise",
            amount: amount,
        })
    );
}

export function playerFold(socket: WebSocket) {
    socket?.send(
        JSON.stringify({
            action: "player-fold",
        })
    );
}
