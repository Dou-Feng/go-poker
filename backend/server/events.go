package server

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/evanofslack/go-poker/poker"
	"github.com/go-redis/redis/v8"
	"github.com/google/uuid"
)

const gameAdminName string = "system"

func handleJoinTable(c *Client, tablename string, password string, playerUUID string, reconnect bool) {
	// A join carrying a per-session player uuid is always a session replay:
	// the lobby never sends one. Treat it as a reconnect even when the client
	// did not set the flag, so a phone still running an older frontend bundle
	// cannot resurrect a recycled room.
	if reconnect || playerUUID != "" {
		handleReconnectTable(c, tablename, password, playerUUID)
		return
	}

	table, _ := c.hub.createTableIfAbsent(tablename, "")
	if table.password != "" && table.password != password {
		c.send <- createError("wrong password")
		return
	}
	c.table = table
	table.register <- c

	if c.username != "" {
		table.broadcast <- createNewMessage(gameAdminName, fmt.Sprintf("%s has joined", c.username))
	}
	c.send <- createUpdatedGame(c)
}

// handleReconnectTable replays a saved browser session. It must never create
// a room: when the room has been recycled (everyone offline for longer than
// emptyTableTTL) or the player's seat was released by the offline timeout,
// the client is told the session expired so it returns to the lobby instead
// of landing in an empty, un-joinable copy of the old room.
func handleReconnectTable(c *Client, tablename string, password string, playerUUID string) {
	table := c.hub.findTable(tablename)
	if table == nil {
		c.send <- createSessionExpired(tablename, "room closed")
		return
	}

	if playerUUID != "" {
		// A seated player reconnecting within the offline grace period gets
		// their seat back. They already passed the password check when they
		// first joined, so it is not required again.
		if !tableHasPlayer(table, playerUUID) {
			c.send <- createSessionExpired(tablename, "room closed")
			return
		}
		c.table = table
		table.register <- c
		if !reconnectPlayer(c, playerUUID) {
			// Seat released between the check and the restore: stay in the
			// room as a spectator rather than leaving the client stateless.
			c.send <- createUpdatedGame(c)
		}
		return
	}

	// A spectator reconnecting to a live room: rejoin as a spectator. The
	// saved session carries no password, so a locked room ends the session.
	if table.password != "" && table.password != password {
		c.send <- createSessionExpired(tablename, "room closed")
		return
	}
	c.table = table
	table.register <- c
	c.send <- createUpdatedGame(c)
}

// tableHasPlayer reports whether a player with the given per-session uuid is
// still seated at the table.
func tableHasPlayer(t *table, playerUUID string) bool {
	view := t.game.GenerateOmniView()
	for i := range view.Players {
		if view.Players[i].UUID == playerUUID {
			return true
		}
	}
	return false
}

// reconnectPlayer restores a client's seat and identity from a per-session
// player uuid. It reports whether the player was found at the table.
func reconnectPlayer(c *Client, playerUUID string) bool {
	view := c.table.game.GenerateOmniView()
	for i := range view.Players {
		if view.Players[i].UUID == playerUUID {
			c.uuid = playerUUID
			c.username = view.Players[i].Username
			c.accountUUID = view.Players[i].AccountUUID
			c.table.markPlayerOnline(playerUUID)
			c.send <- createUpdatedPlayerUUID(c)
			c.send <- createUpdatedGame(c)
			return true
		}
	}
	return false
}

func createSessionExpired(tablename string, message string) []byte {
	resp := sessionExpired{
		base{actionSessionExpired},
		tablename,
		message,
	}
	bytes, err := json.Marshal(resp)
	if err != nil {
		slog.Default().Warn("Marshal session expired", "error", err)
	}
	return bytes
}

func handleRegisterUser(c *Client, username string, accountUUID string, password string, avatar string) {
	if username == "" || accountUUID == "" || password == "" {
		c.send <- createResult(actionRegisterResult, false, "username and password required", "")
		return
	}
	if !validUUID(accountUUID) {
		c.send <- createResult(actionRegisterResult, false, "invalid uuid", "")
		return
	}
	// Reject re-registration of an account that already exists in storage
	// (e.g. after a server restart clears the in-memory registry).
	if existing, err := loadUser(c.hub.rdb, accountUUID); err == nil && existing.PasswordHash != "" {
		c.send <- createResult(actionRegisterResult, false, "uuid already taken", "")
		return
	}
	if err := c.hub.registerUser(accountUUID); err != nil {
		c.send <- createResult(actionRegisterResult, false, err.Error(), "")
		return
	}

	hash, err := hashPassword(password)
	if err != nil {
		c.hub.unregisterUser(accountUUID)
		c.send <- createResult(actionRegisterResult, false, "could not hash password", "")
		return
	}
	if avatar == "" {
		avatar = "🙂"
	}
	user := &UserRecord{UUID: accountUUID, Username: username, PasswordHash: hash, Chips: initialChips, Avatar: avatar}
	if err := saveUser(c.hub.rdb, user); err != nil {
		c.hub.unregisterUser(accountUUID)
		c.send <- createResult(actionRegisterResult, false, "could not save user", "")
		return
	}
	if err := indexUsername(c.hub.rdb, username, accountUUID); err != nil {
		slog.Default().Warn("Index username", "error", err)
	}

	c.username = username
	c.accountUUID = accountUUID
	c.send <- createResultWithUUID(actionRegisterResult, true, "", username, accountUUID)
	c.send <- createUserInfo(c.hub.rdb, user, true)
}

// handleLogin authenticates by account UUID first, then by username when the
// username is unique across accounts.
func handleLogin(c *Client, identifier string, password string) {
	if identifier == "" || password == "" {
		c.send <- createResult(actionLoginResult, false, "invalid username or password", "")
		return
	}

	var user *UserRecord
	if candidate, err := loadUser(c.hub.rdb, identifier); err == nil && candidate.PasswordHash != "" {
		user = candidate
	} else {
		candidate, err := loadUserByUsername(c.hub.rdb, identifier)
		if err == ErrUsernameNotUnique {
			c.send <- createResult(actionLoginResult, false, "username not unique", "")
			return
		}
		if err != nil {
			c.send <- createResult(actionLoginResult, false, "invalid username or password", "")
			return
		}
		user = candidate
	}

	if user.PasswordHash == "" || !verifyPassword(user.PasswordHash, password) {
		c.send <- createResult(actionLoginResult, false, "invalid username or password", "")
		return
	}
	c.username = user.Username
	c.accountUUID = user.UUID
	c.send <- createResultWithUUID(actionLoginResult, true, "", user.Username, user.UUID)
	c.send <- createUserInfo(c.hub.rdb, user, true)
}

// handleReconnectUser re-associates a returning client (identified by their
// remembered account UUID in localStorage) with their account. Passwords are
// only required at initial login/registration.
func handleReconnectUser(c *Client, accountUUID string) {
	if accountUUID == "" {
		return
	}
	user, err := loadUser(c.hub.rdb, accountUUID)
	if err != nil || user.PasswordHash == "" {
		return
	}
	c.username = user.Username
	c.accountUUID = user.UUID
	c.send <- createUserInfo(c.hub.rdb, user, true)
}

func handleGetHistory(c *Client) {
	records, err := loadHistory(c.hub.rdb, c.accountUUID)
	if err != nil {
		c.send <- createError("could not load history")
		return
	}
	c.send <- createHistoryList(records)
}

func handleGetUser(c *Client, targetUUID string) {
	self := targetUUID == "" || targetUUID == c.accountUUID
	if !self {
		// viewing someone else's profile by account UUID
		user, err := loadUser(c.hub.rdb, targetUUID)
		if err != nil || user.PasswordHash == "" {
			c.send <- createError("could not load user")
			return
		}
		user.Chips = 0
		c.send <- createUserInfo(c.hub.rdb, user, false)
		return
	}
	user, err := loadUser(c.hub.rdb, c.accountUUID)
	if err != nil {
		c.send <- createError("could not load user")
		return
	}
	c.send <- createUserInfo(c.hub.rdb, user, true)
}

func handleAddFriend(c *Client, friendUUID string) {
	if friendUUID == "" || friendUUID == c.accountUUID {
		c.send <- createError("invalid uuid")
		return
	}
	user, err := loadUser(c.hub.rdb, c.accountUUID)
	if err != nil {
		c.send <- createError("could not load user")
		return
	}
	// The friend must be an existing account.
	friend, err := loadUser(c.hub.rdb, friendUUID)
	if err != nil || friend.PasswordHash == "" {
		c.send <- createError("could not load user")
		return
	}
	for _, f := range user.Friends {
		if f == friendUUID {
			c.send <- createError("already friends")
			return
		}
	}
	user.Friends = append(user.Friends, friendUUID)
	if err := saveUser(c.hub.rdb, user); err != nil {
		c.send <- createError("could not save user")
		return
	}
	c.send <- createUserInfo(c.hub.rdb, user, true)
}

func handleSetAvatar(c *Client, avatar string) {
	if avatar == "" {
		c.send <- createError("invalid avatar")
		return
	}
	user, err := loadUser(c.hub.rdb, c.accountUUID)
	if err != nil {
		c.send <- createError("could not load user")
		return
	}
	user.Avatar = avatar
	// Choosing an emoji replaces any uploaded image avatar.
	user.AvatarImage = false
	if err := saveUser(c.hub.rdb, user); err != nil {
		c.send <- createError("could not save user")
		return
	}
	c.send <- createUserInfo(c.hub.rdb, user, true)
}

// handleChangeUsername updates the account's display name. Usernames are only
// aliases, so no storage keys need to be migrated. It is rejected while the
// client is at a table.
func handleChangeUsername(c *Client, newUsername string) {
	if c.accountUUID == "" {
		c.send <- createError("not logged in")
		return
	}
	if c.table != nil {
		c.send <- createError("game already running")
		return
	}
	if newUsername == "" || newUsername == c.username {
		c.send <- createResult(actionChangeUsernameResult, false, "invalid username", c.username)
		return
	}

	user, err := loadUser(c.hub.rdb, c.accountUUID)
	if err != nil {
		c.send <- createResult(actionChangeUsernameResult, false, "could not load user", c.username)
		return
	}
	oldUsername := user.Username
	user.Username = newUsername
	if err := saveUser(c.hub.rdb, user); err != nil {
		c.send <- createResult(actionChangeUsernameResult, false, "could not save user", oldUsername)
		return
	}
	_ = unindexUsername(c.hub.rdb, oldUsername, c.accountUUID)
	if err := indexUsername(c.hub.rdb, newUsername, c.accountUUID); err != nil {
		slog.Default().Warn("Index username", "error", err)
	}

	c.username = newUsername
	c.send <- createResultWithUUID(actionChangeUsernameResult, true, "", newUsername, c.accountUUID)
	c.send <- createUserInfo(c.hub.rdb, user, true)
}

func handleAddChips(c *Client, amount uint) {
	if amount == 0 {
		c.send <- createError("amount must be positive")
		return
	}
	user, err := loadUser(c.hub.rdb, c.accountUUID)
	if err != nil {
		c.send <- createError("could not load user")
		return
	}
	user.Chips += amount
	if err := saveUser(c.hub.rdb, user); err != nil {
		c.send <- createError("could not save user")
		return
	}
	c.send <- createUserInfo(c.hub.rdb, user, true)
}

func handleListTables(c *Client) {
	c.send <- createTableList(c.hub.listTables())
}

func handleCreateTable(c *Client, tablename string, password string, sb uint, bb uint, buyIn uint, maxBuy uint, maxPlayers uint, handsLimit uint) {
	table, created := c.hub.createTableIfAbsent(tablename, password)
	if !created {
		c.send <- createResult(actionCreateResult, false, "room already exists", "")
		return
	}

	if sb == 0 {
		sb = 1
	}
	if bb == 0 {
		bb = 2
	}
	if buyIn == 0 {
		buyIn = 200
	}
	if maxBuy == 0 {
		maxBuy = buyIn * 2
	}
	if maxPlayers == 0 {
		maxPlayers = 6
	}
	poker.Configure(table.game, sb, bb, buyIn, maxBuy, maxPlayers, handsLimit)

	c.table = table
	table.register <- c

	if c.username != "" {
		table.broadcast <- createNewMessage(gameAdminName, fmt.Sprintf("%s has joined", c.username))
	}
	c.send <- createUpdatedGame(c)
	c.send <- createResult(actionCreateResult, true, "", "")
}

func handleLeaveTable(c *Client, tablename string) {
	if c.table == nil {
		return
	}

	// Snapshot the player before folding so the session can be settled even
	// when the fold immediately ends the hand and drops the player.
	view := c.table.game.GenerateOmniView()
	pos := -1
	for i := range view.Players {
		if view.Players[i].UUID == c.uuid {
			pos = i
			break
		}
	}

	if pos >= 0 {
		pre := view.Players[pos]

		// Mark the player as left; they fold on their turn (or immediately if
		// it is already their turn).
		if err := poker.LeaveHand(c.table.game, uint(pos)); err != nil {
			slog.Default().Warn("Leave table", "error", err)
		}

		// Settle the session: merge stats, return the remaining stack to the
		// wallet, and append a history entry. The fold is counted here even if
		// it happens later, when the action reaches the departed player. An
		// all-in player who leaves is shown down instead of folded, so no fold
		// is counted for them.
		stats := pre.Stats
		if pre.In && pre.Stack > 0 {
			stats.Folds++
		}
		after := c.table.game.GenerateOmniView()
		stillSeated := -1
		for j := range after.Players {
			if after.Players[j].UUID == c.uuid {
				stillSeated = j
				break
			}
		}
		if _, err := flushPlayerSession(c.hub.rdb, pre.AccountUUID, c.table.name, pre.TotalBuyIn, pre.Stack, stats); err != nil {
			slog.Default().Warn("Flush player", "error", err)
		}

		// Remove the player from the room once no hand is active. If they
		// folded mid-hand they are dropped when the hand ends.
		if stillSeated >= 0 && after.Stage == poker.NotReady {
			if err := poker.RemovePlayer(c.table.game, uint(stillSeated)); err != nil {
				slog.Default().Warn("Remove player", "error", err)
			}
		}
	}

	// If the room is now empty, reset the game so a re-entering player sees
	// a fresh table instead of a stale running flag.
	remaining := c.table.game.GenerateOmniView()
	if len(remaining.Players) == 0 {
		c.table.game.Reset()
	} else if remaining.Stage == poker.NotReady {
		// A player left between hands: put the room back into the ready phase
		// so the next hand waits for everyone to ready up.
		poker.Pause(c.table.game)
	}

	// Detach the client from the departed player so re-joining is treated as
	// a fresh spectator rather than re-seating them.
	c.uuid = ""

	c.table.broadcastGame()
	c.table.unregister <- c
	c.table = nil
}

func handleSendMessage(c *Client, username string, message string) {
	c.table.broadcast <- createNewMessage(username, message)
}

func handleSendLog(c *Client, message string) {
	c.table.broadcast <- createNewLog(message)
}

func handleNewPlayer(c *Client, username string) {
	c.username = username
	c.send <- createUpdatedGame(c)
	c.table.broadcast <- createNewMessage(gameAdminName, fmt.Sprintf("%s has joined", username))
}

func handleTakeSeat(c *Client, username string, seatID uint, buyIn uint) {
	view := c.table.game.GenerateOmniView()

	// New players can't sit down while a hand is in progress: they queue up
	// and are seated at the start of the next hand instead.
	if view.Running {
		c.send <- createError("game already running")
		return
	}

	// Reject if this account is already seated at the table.
	for i := range view.Players {
		if view.Players[i].AccountUUID == c.accountUUID {
			c.send <- createError("already seated")
			return
		}
	}

	// Respect the table's max-player limit.
	if view.Config.MaxPlayers != 0 && uint(len(view.Players)) >= view.Config.MaxPlayers {
		c.send <- createError("table is full")
		return
	}

	// Use the room's fixed buy-in when one is configured.
	amount := view.Config.BuyIn
	if amount == 0 {
		amount = buyIn
	}

	// Deduct the buy-in from the user's account balance before seating.
	user, err := loadUser(c.hub.rdb, c.accountUUID)
	if err != nil {
		c.send <- createError("could not load user")
		return
	}
	if user.Chips < amount {
		c.send <- createError("not enough chips")
		return
	}
	user.Chips -= amount
	if err := saveUser(c.hub.rdb, user); err != nil {
		c.send <- createError("could not save user")
		return
	}

	position := c.table.game.AddPlayer()
	c.uuid = c.table.game.GenerateOmniView().Players[position].UUID
	c.send <- createUpdatedPlayerUUID(c)
	err = poker.SetAccountUUID(c.table.game, position, c.accountUUID)
	if err != nil {
		slog.Default().Warn("Set account uuid", "error", err)
	}
	err = poker.SetUsername(c.table.game, position, username)
	if err != nil {
		slog.Default().Warn("Set username", "error", err)
	}
	err = poker.SetAvatar(c.table.game, position, user.Avatar, user.AvatarImage)
	if err != nil {
		slog.Default().Warn("Set avatar", "error", err)
	}

	err = poker.BuyIn(c.table.game, position, amount)
	if err != nil {
		slog.Default().Warn("Buy in", "error", err)
	}

	err = poker.SetSeatID(c.table.game, position, seatID)
	if err != nil {
		slog.Default().Warn("Set seat id", "error", err)
	}
	c.table.broadcastGame()
	c.send <- createUserInfo(c.hub.rdb, user, true)
}

func handleRebuy(c *Client, amount uint) {
	if c.table == nil {
		c.send <- createError("not in a room")
		return
	}

	if amount == 0 {
		c.send <- createError("amount must be positive")
		return
	}

	view := c.table.game.GenerateOmniView()

	position := -1
	for i := range view.Players {
		if view.Players[i].UUID == c.uuid {
			position = i
			break
		}
	}
	if position < 0 {
		c.send <- createError("you are not seated")
		return
	}

	// Refuse a rebuy that would push the player past the room's maximum
	// buy-in cap, instead of silently draining their wallet.
	if view.Config.MaxBuy != 0 && view.Players[position].TotalBuyIn+amount > view.Config.MaxBuy {
		c.send <- createError("max buy-in reached")
		return
	}

	user, err := loadUser(c.hub.rdb, c.accountUUID)
	if err != nil {
		c.send <- createError("could not load user")
		return
	}
	if user.Chips < amount {
		c.send <- createError("not enough chips")
		return
	}
	user.Chips -= amount
	if err := saveUser(c.hub.rdb, user); err != nil {
		c.send <- createError("could not save user")
		return
	}

	if err := poker.BuyIn(c.table.game, uint(position), amount); err != nil {
		slog.Default().Warn("Rebuy", "error", err)
	}
	// Buying in never changes the player's ready state: they stay not-ready
	// and must explicitly tap their avatar to get ready.
	autoStartIfReady(c.table)
	c.table.broadcastGame()
	c.send <- createUserInfo(c.hub.rdb, user, true)
}

func handleUndoRebuy(c *Client) {
	if c.table == nil {
		c.send <- createError("not in a room")
		return
	}

	view := c.table.game.GenerateOmniView()
	amount := view.Config.BuyIn
	if amount == 0 {
		c.send <- createError("amount must be positive")
		return
	}

	position := -1
	for i := range view.Players {
		if view.Players[i].UUID == c.uuid {
			position = i
			break
		}
	}
	if position < 0 {
		c.send <- createError("you are not seated")
		return
	}
	if view.Players[position].In {
		c.send <- createError("cannot undo during a hand")
		return
	}
	if view.Players[position].Ready {
		c.send <- createError("cannot undo after ready")
		return
	}
	if view.Players[position].Stack < amount {
		c.send <- createError("not enough chips")
		return
	}

	user, err := loadUser(c.hub.rdb, c.accountUUID)
	if err != nil {
		c.send <- createError("could not load user")
		return
	}
	user.Chips += amount
	if err := saveUser(c.hub.rdb, user); err != nil {
		c.send <- createError("could not save user")
		return
	}

	if err := poker.UndoBuyIn(c.table.game, uint(position), amount); err != nil {
		slog.Default().Warn("Undo buy in", "error", err)
	}

	c.table.broadcastGame()
	c.send <- createUserInfo(c.hub.rdb, user, true)
}

func handleStartGame(c *Client) {
	err := c.table.game.Start()
	if err != nil {
		fmt.Println(err)
		return
	}
	c.table.startNewSession()
	broadcastDeal(c.table)
	c.table.broadcastGame()
}

func handleToggleReady(c *Client) {
	view := c.table.game.GenerateOmniView()
	position := -1
	for i := range view.Players {
		if view.Players[i].UUID == c.uuid {
			position = i
			break
		}
	}
	if position < 0 {
		c.send <- createError("you are not seated")
		return
	}
	if err := poker.ToggleReady(c.table.game, uint(position), 0); err != nil {
		slog.Default().Warn("Toggle ready", "error", err)
		return
	}
	autoStartIfReady(c.table)
	c.table.broadcastGame()
}

// handleQueueNext lets a spectator reserve a seat for the next hand. It acts
// as a toggle: queued clients are seated automatically between hands, and
// sending it again while queued cancels the reservation.
func handleQueueNext(c *Client) {
	if c.table == nil {
		c.send <- createError("not in a room")
		return
	}
	if c.username == "" {
		c.send <- createError("not logged in")
		return
	}

	view := c.table.game.GenerateOmniView()
	if !view.Running {
		c.send <- createError("game not running")
		return
	}

	// Already seated players have nothing to queue for.
	for i := range view.Players {
		if view.Players[i].UUID == c.uuid {
			c.send <- createError("already seated")
			return
		}
	}

	if view.Config.MaxPlayers != 0 && uint(len(view.Players)) >= view.Config.MaxPlayers {
		c.send <- createError("table is full")
		return
	}

	// Validate the buy-in up front for immediate feedback. The final check
	// happens again when the seat is actually assigned.
	if view.Config.BuyIn == 0 {
		c.send <- createError("amount must be positive")
		return
	}
	user, err := loadUser(c.hub.rdb, c.accountUUID)
	if err != nil {
		c.send <- createError("could not load user")
		return
	}
	if user.Chips < view.Config.BuyIn {
		c.send <- createError("not enough chips")
		return
	}

	c.table.toggleQueue(c)
	c.table.broadcastGame()
}

func handleMoveSeat(c *Client, seatID uint) {
	if seatID == 0 {
		c.send <- createError("invalid seat")
		return
	}
	view := c.table.game.GenerateOmniView()
	position := -1
	for i := range view.Players {
		if view.Players[i].UUID == c.uuid {
			position = i
			break
		}
	}
	if position < 0 {
		c.send <- createError("you are not seated")
		return
	}
	if view.Players[position].Ready {
		c.send <- createError("cannot move while ready")
		return
	}
	if err := poker.SetSeatID(c.table.game, uint(position), seatID); err != nil {
		slog.Default().Warn("Move seat", "error", err)
		c.send <- createError("seat is taken")
		return
	}
	c.table.broadcastGame()
}

// autoStartIfReady starts the game once at least two seated players are ready.
// It returns true when the game was started.
func autoStartIfReady(t *table) bool {
	view := t.game.GenerateOmniView()
	if view.Running {
		return false
	}
	active := 0
	for i := range view.Players {
		if view.Players[i].Left {
			continue
		}
		active++
		if !view.Players[i].Ready {
			return false
		}
	}
	if active < 2 {
		return false
	}
	if err := t.game.Start(); err != nil {
		slog.Default().Warn("Auto start", "error", err)
		return false
	}
	t.startNewSession()
	broadcastDeal(t)
	return true
}

func handleResetGame(c *Client) {
	c.table.game.Reset()
	c.table.broadcastGame()
}

func handleDealGame(c *Client) {
	if c.table == nil {
		return
	}
	view := c.table.game.GenerateOmniView()

	// The client's showdown display (hand types → toast) has finished: close
	// the showdown, reset the table, and deal the next hand.
	if view.Stage == poker.Showdown {
		if err := poker.SettleShowdown(c.table.game); err != nil {
			slog.Default().Warn("Settle showdown", "error", err)
		}
		// Apply any queued spectate moves before deciding how to continue.
		c.table.applySpectateReservations()

		// Honour an early-settle vote or a reached hand limit first: the
		// session ends instead of automatically dealing another hand.
		if c.table.maybeSettleAfterHand() {
			return
		}
		if c.table.maybeSettle() {
			return
		}

		// Everyone is still ready: auto-start the next hand. Otherwise
		// broadcast the ready phase and wait for players to re-ready.
		if autoStartIfReady(c.table) {
			c.table.broadcastGame()
			return
		}
		c.table.broadcastGame()
		return
	}

	// All-in runout: reveal the board one card at a time and resolve at the
	// river. Betting is off and the board is incomplete in this state.
	if !view.Betting && view.Stage >= poker.PreFlop && view.Stage <= poker.River {
		if err := poker.RunoutNext(c.table.game); err != nil {
			slog.Default().Warn("Runout next", "error", err)
		}
		c.table.broadcastGame()
		return
	}

	// Apply pending spectate reservations before dealing the next hand. This
	// lets the previous hand's settlement animation play out first.
	c.table.applySpectateReservations()

	// If the room paused (e.g. a player just moved to spectate) or no longer
	// has enough players, broadcast the paused state instead of dealing.
	view = c.table.game.GenerateOmniView()
	if !view.Running || len(view.Players) < 2 {
		c.table.broadcastGame()
		return
	}

	// Normal flow: deal the next hand (PreDeal) or next street.
	broadcastDeal(c.table)
	err := poker.Deal(c.table.game, view.DealerNum, 0)
	if err != nil {
		slog.Default().Warn("Deal table", "error", err)
	}
	c.table.broadcastGame()
}

func handleCall(c *Client) {
	view := c.table.game.GenerateOmniView()
	if len(view.Players) == 0 {
		return
	}
	pn := view.ActionNum
	if pn >= uint(len(view.Players)) {
		return
	}
	currentPlayer := view.Players[pn]

	// compute amount needed to call
	maxBet := view.Players[0].TotalBet
	for _, p := range view.Players {
		if p.TotalBet > maxBet {
			maxBet = p.TotalBet
		}
	}
	callAmount := maxBet - currentPlayer.TotalBet

	// if player must go all in to call
	if callAmount >= currentPlayer.Stack {
		callAmount = currentPlayer.Stack
	}

	err := poker.Bet(c.table.game, pn, callAmount)
	if err != nil {
		slog.Default().Warn("Handle call", "error", err)
	}
	c.table.broadcastGame()
}

func handleRaise(c *Client, raise uint) {
	view := c.table.game.GenerateOmniView()
	pn := view.ActionNum
	if pn >= uint(len(view.Players)) {
		return
	}
	err := poker.Bet(c.table.game, pn, raise)
	if err != nil {
		slog.Default().Warn("Handle raise", "error", err)
	}

	c.table.broadcastGame()
}

func handleCheck(c *Client) {
	view := c.table.game.GenerateOmniView()
	pn := view.ActionNum
	if pn >= uint(len(view.Players)) {
		return
	}
	err := poker.Bet(c.table.game, pn, 0)
	if err != nil {
		slog.Default().Warn("Handle check", "error", err)
	}
	c.table.broadcastGame()
}

func handleFold(c *Client) {
	view := c.table.game.GenerateOmniView()
	pn := view.ActionNum
	if pn >= uint(len(view.Players)) {
		return
	}
	err := poker.Fold(c.table.game, pn, 0)
	if err != nil {
		slog.Default().Warn("Handle fold", "error", err)
		return
	}
	c.table.broadcastGame()
}

// handleVoteSettle registers a vote to settle the current session early.
func handleVoteSettle(c *Client) {
	if c.table == nil {
		c.send <- createError("not in a room")
		return
	}
	c.table.voteSettle(c)
}

// handleShowHand reveals a player's hole cards at showdown.
func handleShowHand(c *Client) {
	if c.table == nil {
		c.send <- createError("not in a room")
		return
	}
	view := c.table.game.GenerateOmniView()
	position := -1
	for i := range view.Players {
		if view.Players[i].UUID == c.uuid {
			position = i
			break
		}
	}
	if position < 0 {
		c.send <- createError("you are not seated")
		return
	}
	if err := poker.ShowHand(c.table.game, uint(position), 0); err != nil {
		slog.Default().Warn("Show hand", "error", err)
		return
	}
	c.table.broadcastGame()
}

// handleSpectate removes a seated player and turns their client into a
// spectator.
func handleSpectate(c *Client) {
	if c.table == nil {
		c.send <- createError("not in a room")
		return
	}
	c.table.toggleSpectate(c)
}

func createSettlement(players []settlementPlayer, biggestWinner string, biggestAmount uint) []byte {
	resp := settlement{
		base{actionSettlement},
		players,
		biggestWinner,
		biggestAmount,
	}
	bytes, err := json.Marshal(resp)
	if err != nil {
		slog.Default().Warn("Marshal settlement", "error", err)
	}
	return bytes
}

func createNewMessage(username string, message string) []byte {
	new := newMessage{
		base{actionNewMessage},
		uuid.New().String(),
		message,
		username,
		currentTime(),
	}
	resp, err := json.Marshal(new)
	if err != nil {
		slog.Default().Warn("Marshal new message", "error", err)
	}
	return resp
}

func createResult(action string, ok bool, message string, username string) []byte {
	return createResultWithUUID(action, ok, message, username, "")
}

func createResultWithUUID(action string, ok bool, message string, username string, accountUUID string) []byte {
	resp := result{
		base{action},
		ok,
		message,
		username,
		accountUUID,
	}
	bytes, err := json.Marshal(resp)
	if err != nil {
		slog.Default().Warn("Marshal result", "error", err)
	}
	return bytes
}

func createTableList(tables []tableInfo) []byte {
	resp := tableList{
		base{actionTableList},
		tables,
	}
	bytes, err := json.Marshal(resp)
	if err != nil {
		slog.Default().Warn("Marshal table list", "error", err)
	}
	return bytes
}

func createHistoryList(records []HistoryRecord) []byte {
	resp := historyList{
		base{actionHistory},
		records,
	}
	bytes, err := json.Marshal(resp)
	if err != nil {
		slog.Default().Warn("Marshal history", "error", err)
	}
	return bytes
}

func createUserInfo(rdb *redis.Client, u *UserRecord, self bool) []byte {
	friends := make([]friendInfo, 0)
	if self {
		for _, friendUUID := range u.Friends {
			friend, err := loadUser(rdb, friendUUID)
			if err != nil || friend.PasswordHash == "" {
				continue
			}
			friends = append(friends, friendInfo{
				UUID:        friend.UUID,
				Username:    friend.Username,
				Avatar:      friend.Avatar,
				AvatarImage: friend.AvatarImage,
			})
		}
	}
	resp := userInfo{
		base{actionUserInfo},
		u.UUID,
		u.Username,
		u.Chips,
		u.Avatar,
		u.AvatarImage,
		friends,
		u.Stats,
		self,
	}
	bytes, err := json.Marshal(resp)
	if err != nil {
		slog.Default().Warn("Marshal user info", "error", err)
	}
	return bytes
}

func createError(message string) []byte {
	resp := errorMessage{
		base{actionError},
		message,
	}
	bytes, err := json.Marshal(resp)
	if err != nil {
		slog.Default().Warn("Marshal error", "error", err)
	}
	return bytes
}

func createPong() []byte {
	return []byte(`{"action":"pong"}`)
}

func createNewLog(message string) []byte {
	log := newLog{
		base{actionNewLog},
		uuid.New().String(),
		message,
		currentTime(),
	}
	resp, err := json.Marshal(log)
	if err != nil {
		slog.Default().Warn("Marshal new log", "error", err)
	}
	return resp
}

func createUpdatedGame(c *Client) []byte {
	return createUpdatedGameBytes(c.table)
}

func createUpdatedGameBytes(t *table) []byte {
	game := updateGame{
		base{actionUpdateGame},
		t.game.GenerateOmniView(),
		t.waitingUsernames(),
		t.settleVoteList(),
	}

	resp, err := json.Marshal(game)
	if err != nil {
		slog.Default().Warn("Marshal update game", "error", err)
	}
	return resp
}

func createUpdatedPlayerUUID(c *Client) []byte {
	uuid := updatePlayerUUID{
		base{actionUpdatePlayerUUID},
		c.uuid,
	}
	resp, err := json.Marshal(uuid)
	if err != nil {
		slog.Default().Warn("Marshal player uuid", "error", err)
	}
	return resp
}

func broadcastDeal(table *table) {
	view := table.game.GenerateOmniView()

	startMsg := "starting new hand"
	table.broadcast <- createNewLog(startMsg)

	sbUser := view.Players[view.SBNum].Username
	sb := view.Config.SmallBlind
	sbMsg := fmt.Sprintf("%s is small blind (%d)", sbUser, sb)
	table.broadcast <- createNewLog(sbMsg)

	bbUser := view.Players[view.BBNum].Username
	bb := view.Config.BigBlind
	bbMsg := fmt.Sprintf("%s is big blind (%d)", bbUser, bb)
	table.broadcast <- createNewLog(bbMsg)
}

func currentTime() string {
	return fmt.Sprintf("%d:%02d", time.Now().Hour(), time.Now().Minute())
}
