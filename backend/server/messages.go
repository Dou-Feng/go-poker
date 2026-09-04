package server

import (
	"github.com/evanofslack/go-poker/poker"
)

// inbound (client) actions
const (
	actionJoinTable      string = "join-table"
	actionLeaveTable     string = "leave-table"
	actionSendMessage    string = "send-message"
	actionSendLog        string = "send-log"
	actionNewPlayer      string = "new-player"
	actionTakeSeat       string = "take-seat"
	actionStartGame      string = "start-game"
	actionDealGame       string = "deal-game"
	actionResetGame      string = "reset-game"
	actionPlayerCall     string = "player-call"
	actionPlayerCheck    string = "player-check"
	actionPlayerRaise    string = "player-raise"
	actionPlayerFold     string = "player-fold"
	actionRegisterUser   string = "register-user"
	actionListTables     string = "list-tables"
	actionCreateTable    string = "create-table"
	actionAddChips       string = "add-chips"
	actionRebuy          string = "rebuy"
	actionUndoBuyIn      string = "undo-buyin"
	actionGetUser        string = "get-user"
	actionLogin          string = "login"
	actionAddFriend      string = "add-friend"
	actionSetAvatar      string = "set-avatar"
	actionReconnect      string = "reconnect-user"
	actionGetHistory     string = "get-history"
	actionToggleReady    string = "toggle-ready"
	actionQueueNext      string = "queue-next"
	actionMoveSeat       string = "move-seat"
	actionVoteSettle     string = "vote-settle"
	actionShowHand       string = "show-hand"
	actionSpectate       string = "spectate"
	actionPing           string = "ping"
	actionChangeUsername string = "change-username"
)

type base struct {
	// allows for correctly identifying messages
	Action string `json:"action"`
}

type joinTable struct {
	base              // actionJoinTable
	Tablename  string `json:"tablename"`
	PlayerUUID string `json:"playerUUID,omitempty"`
	Password   string `json:"password,omitempty"`
	// Reconnect marks a join replayed from a saved browser session (page
	// reload / socket reconnect) rather than a deliberate lobby join. A
	// reconnect never creates a room: if the room is gone or the seat was
	// lost, the server answers with actionSessionExpired instead.
	Reconnect bool `json:"reconnect,omitempty"`
}

type leaveTable struct {
	base             // actionLeaveTable
	Tablename string `json:"tablename"`
}

type sendMessage struct {
	base            // actionSendMessage
	Username string `json:"username"`
	Message  string `json:"message"`
}

type sendLog struct {
	base           // actionSendLog
	Message string `json:"message"`
}

type newPlayer struct {
	base            // actionNewPlayer
	Username string `json:"username"`
}

type takeSeat struct {
	base            // actionTakeSeat
	Username string `json:"username"`
	SeatID   uint   `json:"seatID"`
	BuyIn    uint   `json:"buyIn"`
}

type startGame struct {
	base // actionStartGame
}

type resetGame struct {
	base // actionResetGame
}

type dealGame struct {
	base // actionDealGame
}

type playerCall struct {
	base // actionPlayerCall
}

type playerCheck struct {
	base // actionPlayerCheck
}

type playerRaise struct {
	base        // actionPlayerRaise
	Amount uint `json:"amount"`
}

type playerFold struct {
	base // actionPlayerFold
}

type registerUser struct {
	base            // actionRegisterUser
	Username string `json:"username"`
	UUID     string `json:"uuid"`
	Password string `json:"password"`
	Avatar   string `json:"avatar,omitempty"`
}

type login struct {
	base              // actionLogin
	Identifier string `json:"identifier"`
	Password   string `json:"password"`
}

type addFriend struct {
	base        // actionAddFriend
	UUID string `json:"uuid"`
}

type setAvatar struct {
	base          // actionSetAvatar
	Avatar string `json:"avatar"`
}

type reconnectUser struct {
	base        // actionReconnect
	UUID string `json:"uuid"`
}

type listTables struct {
	base // actionListTables
}

type createTable struct {
	base              // actionCreateTable
	Tablename  string `json:"tablename"`
	Password   string `json:"password,omitempty"`
	SB         uint   `json:"sb"`
	BB         uint   `json:"bb"`
	BuyIn      uint   `json:"buyIn"`
	MaxBuy     uint   `json:"maxBuy"`
	MaxPlayers uint   `json:"maxPlayers"`
	HandsLimit uint   `json:"handsLimit"`
}

type addChips struct {
	base        // actionAddChips
	Amount uint `json:"amount"`
}

type rebuy struct {
	base        // actionRebuy
	Amount uint `json:"amount"`
}

type undoBuyIn struct {
	base // actionUndoBuyIn
}

type getUser struct {
	base        // actionGetUser
	UUID string `json:"uuid,omitempty"`
}

type getHistory struct {
	base // actionGetHistory
}

type toggleReady struct {
	base // actionToggleReady
}

type queueNext struct {
	base // actionQueueNext
}

type moveSeat struct {
	base        // actionMoveSeat
	SeatID uint `json:"seatID"`
}
type voteSettle struct {
	base // actionVoteSettle
}

type showHand struct {
	base // actionShowHand
}
type spectate struct {
	base // actionSpectate
}
type ping struct {
	base // actionPing
}

type changeUsername struct {
	base               // actionChangeUsername
	NewUsername string `json:"newUsername"`
}

// outbound (server) actions
const (
	actionNewMessage           string = "new-message"
	actionNewLog               string = "new-log"
	actionUpdateGame           string = "update-game"
	actionUpdatePlayerUUID     string = "update-player-uuid"
	actionRegisterResult       string = "register-result"
	actionTableList            string = "table-list"
	actionCreateResult         string = "create-result"
	actionUserInfo             string = "user-info"
	actionError                string = "error"
	actionLoginResult          string = "login-result"
	actionHistory              string = "history"
	actionSettlement           string = "settlement"
	actionChangeUsernameResult string = "change-username-result"
	actionPong                 string = "pong"
	actionSessionExpired       string = "session-expired"
)

// sessionExpired tells a reconnecting client that its saved room/seat no
// longer exists (room recycled or player timed out), so it should drop the
// saved session and return to the lobby.
type sessionExpired struct {
	base             // actionSessionExpired
	Tablename string `json:"tablename"`
	Message   string `json:"message"`
}

type newMessage struct {
	base             // actionNewMessage
	Id        string `json:"uuid"`
	Message   string `json:"message"`
	Username  string `json:"username"`
	Timestamp string `json:"timestamp"`
}

type newLog struct {
	base             // actionNewLog
	Id        string `json:"uuid"`
	Message   string `json:"message"`
	Timestamp string `json:"timestamp"`
}

type updateGame struct {
	base                        // actionUpdateGame
	Game        *poker.GameView `json:"game"`
	Waiting     []string        `json:"waiting"`
	SettleVotes []string        `json:"settleVotes"`
}

type updatePlayerUUID struct {
	base        //actionUpdatePlayerUUID
	Uuid string `json:"uuid"`
}

type result struct {
	base            // actionRegisterResult or actionCreateResult
	Ok       bool   `json:"ok"`
	Message  string `json:"message"`
	Username string `json:"username,omitempty"`
	UUID     string `json:"uuid,omitempty"`
}

type tableInfo struct {
	Name       string `json:"name"`
	Players    int    `json:"players"`
	Running    bool   `json:"running"`
	Spectators int    `json:"spectators"`
	Locked     bool   `json:"locked"`
}

type tableList struct {
	base               // actionTableList
	Tables []tableInfo `json:"tables"`
}

type friendInfo struct {
	UUID        string `json:"uuid"`
	Username    string `json:"username"`
	Avatar      string `json:"avatar"`
	AvatarImage bool   `json:"avatarImage"`
}

type userInfo struct {
	base                          // actionUserInfo
	UUID        string            `json:"uuid"`
	Username    string            `json:"username"`
	Chips       uint              `json:"chips"`
	Avatar      string            `json:"avatar"`
	AvatarImage bool              `json:"avatarImage"`
	Friends     []friendInfo      `json:"friends"`
	Stats       poker.PlayerStats `json:"stats"`
	Self        bool              `json:"self"`
}

type historyList struct {
	base                    // actionHistory
	History []HistoryRecord `json:"history"`
}

type settlementPlayer struct {
	Username    string `json:"username"`
	UUID        string `json:"uuid"`
	Avatar      string `json:"avatar"`
	AvatarImage bool   `json:"avatarImage"`
	BuyIn       uint   `json:"buyIn"`
	Net         int    `json:"net"`
}

type settlement struct {
	base                                // actionSettlement
	Players          []settlementPlayer `json:"players"`
	BiggestPotWinner string             `json:"biggestPotWinner"`
	BiggestPotAmount uint               `json:"biggestPotAmount"`
}

type errorMessage struct {
	base           // actionError
	Message string `json:"message"`
}
