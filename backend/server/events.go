package server

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/evanofslack/go-poker/poker"
	"github.com/google/uuid"
)

const gameAdminName string = "system"

func handleJoinTable(c *Client, tablename string, password string, playerUUID string) {
	table, _ := c.hub.createTableIfAbsent(tablename, "")
	if table.password != "" && table.password != password {
		c.send <- createError("wrong password")
		return
	}
	c.table = table
	table.register <- c

	// If the client is reconnecting with a known player id, restore their
	// seat and identity instead of joining as a spectator.
	if playerUUID != "" {
		reconnectPlayer(c, playerUUID)
		return
	}

	if c.username != "" {
		table.broadcast <- createNewMessage(gameAdminName, fmt.Sprintf("%s has joined", c.username))
	}
	c.send <- createUpdatedGame(c)
}

func reconnectPlayer(c *Client, playerUUID string) {
	view := c.table.game.GenerateOmniView()
	for i := range view.Players {
		if view.Players[i].UUID == playerUUID {
			c.uuid = playerUUID
			c.username = view.Players[i].Username
			c.table.markPlayerOnline(playerUUID)
			c.send <- createUpdatedPlayerUUID(c)
			c.send <- createUpdatedGame(c)
			return
		}
	}
}

func handleRegisterUser(c *Client, username string, password string) {
	if username == "" || password == "" {
		c.send <- createResult(actionRegisterResult, false, "username and password required", "")
		return
	}
	// Reject re-registration of an account that already exists in storage
	// (e.g. after a server restart clears the in-memory registry).
	if existing, err := loadUser(c.hub.rdb, username); err == nil && existing.PasswordHash != "" {
		c.send <- createResult(actionRegisterResult, false, "username already taken", "")
		return
	}
	if err := c.hub.registerUser(username); err != nil {
		c.send <- createResult(actionRegisterResult, false, err.Error(), "")
		return
	}

	hash, err := hashPassword(password)
	if err != nil {
		c.send <- createResult(actionRegisterResult, false, "could not hash password", "")
		return
	}
	user := &UserRecord{Username: username, PasswordHash: hash, Chips: initialChips, Avatar: "🙂"}
	if err := saveUser(c.hub.rdb, user); err != nil {
		c.send <- createResult(actionRegisterResult, false, "could not save user", "")
		return
	}

	c.username = username
	c.send <- createResult(actionRegisterResult, true, "", username)
	c.send <- createUserInfo(user, true)
}

func handleLogin(c *Client, username string, password string) {
	user, err := loadUser(c.hub.rdb, username)
	if err != nil || user.PasswordHash == "" || !verifyPassword(user.PasswordHash, password) {
		c.send <- createResult(actionLoginResult, false, "invalid username or password", "")
		return
	}
	c.username = username
	c.send <- createResult(actionLoginResult, true, "", username)
	c.send <- createUserInfo(user, true)
}

// handleReconnectUser re-associates a returning client (identified by their
// remembered username in localStorage) with their account. Passwords are only
// required at initial login/registration.
func handleReconnectUser(c *Client, username string) {
	if username == "" {
		return
	}
	c.username = username
	user, err := loadUser(c.hub.rdb, username)
	if err != nil {
		return
	}
	c.send <- createUserInfo(user, true)
}

func handleGetHistory(c *Client) {
	records, err := loadHistory(c.hub.rdb, c.username)
	if err != nil {
		c.send <- createError("could not load history")
		return
	}
	c.send <- createHistoryList(records)
}

func handleGetUser(c *Client, targetUsername string) {
	self := targetUsername == "" || targetUsername == c.username
	if !self {
		// viewing someone else's profile
		user, err := loadUser(c.hub.rdb, targetUsername)
		if err != nil {
			c.send <- createError("could not load user")
			return
		}
		user.Chips = 0
		c.send <- createUserInfo(user, false)
		return
	}
	user, err := loadUser(c.hub.rdb, c.username)
	if err != nil {
		c.send <- createError("could not load user")
		return
	}
	c.send <- createUserInfo(user, true)
}

func handleAddFriend(c *Client, friendUsername string) {
	if friendUsername == "" || friendUsername == c.username {
		c.send <- createError("invalid username")
		return
	}
	user, err := loadUser(c.hub.rdb, c.username)
	if err != nil {
		c.send <- createError("could not load user")
		return
	}
	for _, f := range user.Friends {
		if f == friendUsername {
			c.send <- createError("already friends")
			return
		}
	}
	user.Friends = append(user.Friends, friendUsername)
	if err := saveUser(c.hub.rdb, user); err != nil {
		c.send <- createError("could not save user")
		return
	}
	c.send <- createUserInfo(user, true)
}

func handleSetAvatar(c *Client, avatar string) {
	if avatar == "" {
		c.send <- createError("invalid avatar")
		return
	}
	user, err := loadUser(c.hub.rdb, c.username)
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
	c.send <- createUserInfo(user, true)
}

func handleAddChips(c *Client, amount uint) {
	if amount == 0 {
		c.send <- createError("amount must be positive")
		return
	}
	user, err := loadUser(c.hub.rdb, c.username)
	if err != nil {
		c.send <- createError("could not load user")
		return
	}
	user.Chips += amount
	if err := saveUser(c.hub.rdb, user); err != nil {
		c.send <- createError("could not save user")
		return
	}
	c.send <- createUserInfo(user, true)
}

func handleListTables(c *Client) {
	c.send <- createTableList(c.hub.listTables())
}

func handleCreateTable(c *Client, tablename string, password string, sb uint, bb uint, buyIn uint, maxBuyIns uint, maxPlayers uint) {
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
	if maxBuyIns == 0 {
		maxBuyIns = 2
	}
	if maxPlayers == 0 {
		maxPlayers = 6
	}
	poker.Configure(table.game, sb, bb, buyIn, buyIn*maxBuyIns, maxPlayers)

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

		// Fold the player out (if in a hand) and mark them as left.
		if err := poker.SitOut(c.table.game, uint(pos), 0); err != nil {
			slog.Default().Warn("Leave table", "error", err)
		}

		// Settle the session: merge stats, return the remaining stack to the
		// wallet, and append a history entry. Prefer the post-fold snapshot,
		// but fall back to the pre-fold one if the hand already ended and the
		// player was dropped from the game.
		stats := pre.Stats
		if pre.In {
			stats.Folds++
		}
		after := c.table.game.GenerateOmniView()
		stillSeated := -1
		for j := range after.Players {
			if after.Players[j].UUID == c.uuid {
				stillSeated = j
				stats = after.Players[j].Stats
				break
			}
		}
		if _, err := flushPlayerSession(c.hub.rdb, pre.Username, c.table.name, pre.TotalBuyIn, pre.Stack, stats); err != nil {
			slog.Default().Warn("Flush player", "error", err)
		}

		// Remove the player from the room once no hand is active. If they
		// folded mid-hand they are dropped when the hand ends.
		if stillSeated >= 0 && after.Stage == poker.PreDeal {
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
	}

	c.table.broadcast <- createUpdatedGame(c)
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

	// Reject if this user is already seated at the table.
	for i := range view.Players {
		if view.Players[i].Username == username {
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
	user, err := loadUser(c.hub.rdb, username)
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
	c.table.broadcast <- createUpdatedGame(c)
	c.send <- createUserInfo(user, true)
}

func handleRebuy(c *Client, amount uint) {
	if c.table == nil {
		c.send <- createError("not in a room")
		return
	}

	view := c.table.game.GenerateOmniView()

	// Use the room's fixed buy-in amount when one is configured.
	amount = view.Config.BuyIn
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
		c.send <- createError("cannot rebuy during a hand")
		return
	}

	// Refuse a rebuy that would push the player past the room's maximum
	// buy-in cap, instead of silently draining their wallet.
	if view.Config.MaxBuy != 0 && view.Players[position].TotalBuyIn+amount > view.Config.MaxBuy {
		c.send <- createError("max buy-in reached")
		return
	}

	user, err := loadUser(c.hub.rdb, c.username)
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
	c.table.broadcast <- createUpdatedGame(c)
	c.send <- createUserInfo(user, true)
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

	user, err := loadUser(c.hub.rdb, c.username)
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

	c.table.broadcast <- createUpdatedGame(c)
	c.send <- createUserInfo(user, true)
}

func handleStartGame(c *Client) {
	err := c.table.game.Start()
	if err != nil {
		fmt.Println(err)
	}
	broadcastDeal(c.table)
	c.table.broadcast <- createUpdatedGame(c)
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
	c.table.broadcast <- createUpdatedGame(c)
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
	c.table.broadcast <- createUpdatedGame(c)
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
	broadcastDeal(t)
	return true
}

func handleResetGame(c *Client) {
	c.table.game.Reset()
	c.table.broadcast <- createUpdatedGame(c)
}

func handleDealGame(c *Client) {
	broadcastDeal(c.table)

	view := c.table.game.GenerateOmniView()
	err := poker.Deal(c.table.game, view.DealerNum, 0)
	if err != nil {
		slog.Default().Warn("Deal table", "error", err)
	}
	c.table.broadcast <- createUpdatedGame(c)
}

func handleCall(c *Client) {
	view := c.table.game.GenerateOmniView()
	pn := view.ActionNum
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
	c.table.broadcast <- createUpdatedGame(c)
}

func handleRaise(c *Client, raise uint) {
	view := c.table.game.GenerateOmniView()
	pn := view.ActionNum
	err := poker.Bet(c.table.game, pn, raise)
	if err != nil {
		slog.Default().Warn("Handle raise", "error", err)
	}

	c.table.broadcast <- createUpdatedGame(c)
}

func handleCheck(c *Client) {
	view := c.table.game.GenerateOmniView()
	pn := view.ActionNum
	err := poker.Bet(c.table.game, pn, 0)
	if err != nil {
		slog.Default().Warn("Handle check", "error", err)
	}
	c.table.broadcast <- createUpdatedGame(c)
}

func handleFold(c *Client) {
	view := c.table.game.GenerateOmniView()
	pn := view.ActionNum
	err := poker.Fold(c.table.game, pn, 0)
	if err != nil {
		slog.Default().Warn("Handle fold", "error", err)
		return
	}
	c.table.broadcast <- createUpdatedGame(c)
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
	resp := result{
		base{action},
		ok,
		message,
		username,
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

func createUserInfo(u *UserRecord, self bool) []byte {
	resp := userInfo{
		base{actionUserInfo},
		u.Username,
		u.Chips,
		u.Avatar,
		u.AvatarImage,
		u.Friends,
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
