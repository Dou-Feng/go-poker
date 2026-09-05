package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/evanofslack/go-poker/poker"
	"github.com/go-redis/redis/v8"
)

// emptyTableTTL is how long a table lingers with no connected clients before
// it is recycled (change.md: no online players for more than 2 minutes). It
// doubles as the grace period for reconnects.
const emptyTableTTL = 2 * time.Minute

// offlineTimeout is how long a disconnected player is allowed to reconnect
// before their hand is folded and they are removed from the room (change.md
// 「离线状态」: 60 seconds). It is kept shorter than emptyTableTTL so players
// are flushed (stack returned to wallet, stats recorded) before the room dies.
const offlineTimeout = 60 * time.Second

// flushFunc persists one player's finished table session (see
// flushPlayerSession). It is a field on the table so tests can observe
// evictions without a Redis instance.
type flushFunc func(accountUUID string, room string, totalBuyIn uint, stack uint, stats poker.PlayerStats) (uint, error)

// table is a single table or game of poker
type table struct {
	name            string
	rdb             *redis.Client
	hub             *Hub
	clients         map[*Client]bool
	clientsMu       sync.Mutex
	register        chan *Client
	unregister      chan *Client
	broadcast       chan []byte
	game            *poker.Game
	password        string
	stop            chan struct{}
	stopOnce        sync.Once
	emptyTimer      *time.Timer
	offlineTimers   map[string]*time.Timer
	offlineMu       sync.Mutex
	offlineAfter    time.Duration // grace period before an offline player is evicted
	flush           flushFunc     // nil means flushPlayerSession against t.rdb
	waiting         map[*Client]bool
	waitingMu       sync.Mutex
	settleVotes     map[string]bool
	settleAfterHand bool
	settled         bool
	settleMu        sync.Mutex
	// ledger totals each account's buy-ins across the whole room session so
	// MaxBuy cannot be dodged by leaving and re-sitting (see scoreboard.go).
	ledger *sessionLedger
	// Server-played seats and their pacing timer (see bot.go).
	botState
}

// newTable creates a new table
func newTable(name string, redisClient *redis.Client, hub *Hub) *table {
	game := poker.NewGame()
	// Apply the default room config (SB 5 / BB 10, 6 players, buy-in 200 x2).
	poker.Configure(game, 5, 10, 200, 400, 6, 0)
	return &table{
		name:          name,
		rdb:           redisClient,
		hub:           hub,
		clients:       make(map[*Client]bool),
		register:      make(chan *Client, 32),
		unregister:    make(chan *Client, 32),
		broadcast:     make(chan []byte, 64),
		game:          game,
		stop:          make(chan struct{}),
		offlineTimers: make(map[string]*time.Timer),
		offlineAfter:  offlineTimeout,
		waiting:       make(map[*Client]bool),
		settleVotes:   make(map[string]bool),
		ledger:        newSessionLedger(),
		botState:      botState{botDelays: defaultBotDelays},
	}
}

// flushSession persists a player's session through the injected flushFunc,
// falling back to Redis.
func (t *table) flushSession(accountUUID string, totalBuyIn uint, stack uint, stats poker.PlayerStats) (uint, error) {
	if isBotAccount(accountUUID) {
		// Bots have no wallet, stats or history to persist.
		return stack, nil
	}
	if t.flush != nil {
		return t.flush(accountUUID, t.name, totalBuyIn, stack, stats)
	}
	return flushPlayerSession(t.rdb, accountUUID, t.name, totalBuyIn, stack, stats)
}

func (t *table) run() {
	go t.subscribeToMessages()

	for {
		select {
		case client := <-t.register:
			t.registerClient(client)
		case client := <-t.unregister:
			t.unregisterClient(client)
		case message := <-t.broadcast:
			t.publishMessages(message)
		case <-t.stop:
			return
		}
	}
}

func (t *table) shutdown() {
	t.stopOnce.Do(func() {
		t.offlineMu.Lock()
		for _, timer := range t.offlineTimers {
			timer.Stop()
		}
		t.offlineTimers = nil
		t.offlineMu.Unlock()

		t.stopBots()
		close(t.stop)
	})
}

// markPlayerOffline schedules the removal of a disconnected player.
func (t *table) markPlayerOffline(playerUUID string) {
	t.offlineMu.Lock()
	defer t.offlineMu.Unlock()
	if _, ok := t.offlineTimers[playerUUID]; ok {
		return
	}
	t.offlineTimers[playerUUID] = time.AfterFunc(t.offlineAfter, func() {
		t.offlineMu.Lock()
		delete(t.offlineTimers, playerUUID)
		t.offlineMu.Unlock()
		t.timeoutPlayer(playerUUID)
	})
}

// markPlayerOnline cancels a pending removal when the player reconnects.
func (t *table) markPlayerOnline(playerUUID string) {
	t.offlineMu.Lock()
	if timer, ok := t.offlineTimers[playerUUID]; ok {
		timer.Stop()
		delete(t.offlineTimers, playerUUID)
	}
	t.offlineMu.Unlock()
}

// seatHasClient reports whether any connected client currently holds the seat
// with the given per-session player uuid.
func (t *table) seatHasClient(playerUUID string) bool {
	t.clientsMu.Lock()
	defer t.clientsMu.Unlock()
	for c := range t.clients {
		if c.uuid == playerUUID {
			return true
		}
	}
	return false
}

// timeoutPlayer evicts a player whose connection has been gone for longer
// than the offline grace period. It behaves exactly like the player pressing
// "leave" (see evictPlayer): between hands they are removed at once; during a
// hand they are folded when the action reaches them (an all-in player stays
// in for the showdown) and dropped when the hand ends, so the pot in play is
// never destroyed. Their remaining stack is returned to their wallet.
func (t *table) timeoutPlayer(playerUUID string) {
	// A live client holds the seat (e.g. a session takeover transferred it to
	// a new connection): the timer that fired is stale, never evict. This
	// recheck bounds every race between the grace-period timers and seat
	// transfers.
	if t.seatHasClient(playerUUID) {
		return
	}
	username, ok := t.evictPlayer(playerUUID)
	if !ok {
		return
	}
	if username != "" {
		t.broadcast <- createNewLog(fmt.Sprintf("%s timed out and left the table", username))
	}
	t.broadcastGame()
}

// evictPlayer removes the seated player identified by their per-session uuid
// from the game, settling their session (stats merged, remaining stack back
// to the wallet, history entry) at that moment. It is the single leave path
// shared by an explicit "leave", the offline timeout, and any future kick.
//
// Between hands (stage NotReady) the player is removed immediately and the
// remaining players are put back into the ready phase. During a hand the
// player is marked as left: they fold when the action reaches them (or right
// away if it is their turn), an all-in player is shown down instead, and the
// seat is released when the hand ends (resetForNextHand). The player's
// username is returned along with whether they were seated at all.
func (t *table) evictPlayer(playerUUID string) (string, bool) {
	view := t.game.GenerateOmniView()
	pos := -1
	for i := range view.Players {
		if view.Players[i].UUID == playerUUID {
			pos = i
			break
		}
	}
	if pos < 0 {
		return "", false
	}

	// Snapshot the player before folding so the session can be settled even
	// when the fold immediately ends the hand and drops the player.
	pre := view.Players[pos]

	// Mark the player as left; they fold on their turn (or immediately if
	// it is already their turn).
	if err := poker.LeaveHand(t.game, uint(pos)); err != nil {
		slog.Default().Warn("Leave hand", "error", err)
	}

	// Settle the session with the stack as it stood when they left. The fold
	// is counted here even if it happens later, when the action reaches the
	// departed player. An all-in player who leaves is shown down instead of
	// folded, so no fold is counted for them.
	stats := pre.Stats
	if pre.In && pre.Stack > 0 {
		stats.Folds++
	}
	if _, err := t.flushSession(pre.AccountUUID, pre.TotalBuyIn, pre.Stack, stats); err != nil {
		slog.Default().Warn("Flush player", "error", err)
	}

	// Remove the player from the room once no hand is active. If they
	// folded mid-hand they are dropped when the hand ends.
	after := t.game.GenerateOmniView()
	if after.Stage == poker.NotReady {
		for j := range after.Players {
			if after.Players[j].UUID == playerUUID {
				if err := poker.RemovePlayer(t.game, uint(j)); err != nil {
					slog.Default().Warn("Remove player", "error", err)
				}
				break
			}
		}
	}

	// If the room is now empty, reset the game so a re-entering player sees
	// a fresh table instead of a stale running flag. If a player left between
	// hands, put the room back into the ready phase so the next hand waits
	// for everyone to ready up.
	remaining := t.game.GenerateOmniView()
	if len(remaining.Players) == 0 {
		t.game.Reset()
		t.resetSession()
	} else if remaining.Stage == poker.NotReady {
		poker.Pause(t.game)
	}

	return pre.Username, true
}

func (t *table) registerClient(client *Client) {
	t.clientsMu.Lock()
	t.clients[client] = true
	t.clientsMu.Unlock()

	// Only a real connection keeps the room alive; bots do not.
	if !client.isBot && t.emptyTimer != nil {
		t.emptyTimer.Stop()
		t.emptyTimer = nil
	}
}

func (t *table) unregisterClient(client *Client) {
	t.waitingMu.Lock()
	delete(t.waiting, client)
	t.waitingMu.Unlock()

	t.clientsMu.Lock()
	_, wasMember := t.clients[client]
	if wasMember {
		delete(t.clients, client)
	}
	// A room holding only bots is empty: it is recycled like any other, and
	// the bots go with it.
	empty := t.humanCount() == 0
	hostChanged := wasMember && client.accountUUID != "" && t.reassignHostIfGoneLocked()
	t.clientsMu.Unlock()

	if hostChanged {
		// Let everyone's UI pick up the new host (this runs on the table's
		// own goroutine, so the broadcast must not block on its own channel).
		go t.broadcastGame()
	}

	if wasMember {
		t.announceVoiceLeave(client)
	}

	if empty && t.emptyTimer == nil {
		t.emptyTimer = time.AfterFunc(emptyTableTTL, func() {
			if t.hub != nil {
				t.hub.destroyTable(t)
			}
		})
	}
}

// broadcastToClients fans one Redis-consumed message out to every connected
// client. update-game payloads carry the uncensored view (the Redis channel is
// internal); here, at the last hop, each client gets its own copy with every
// hole card it is not entitled to see removed — the censoring works from the
// snapshot inside the payload, not the live game, so clients always see
// exactly the state as it was broadcast.
func (t *table) broadcastToClients(message []byte) {
	t.clientsMu.Lock()
	defer t.clientsMu.Unlock()

	var game *updateGame
	var header base
	if err := json.Unmarshal(message, &header); err == nil && header.Action == actionUpdateGame {
		var g updateGame
		if err := json.Unmarshal(message, &g); err == nil && g.Game != nil {
			game = &g
		}
	}

	for client := range t.clients {
		out := message
		if game != nil {
			out = game.censoredFor(client.uuid)
			if out == nil {
				// Marshal failure: skip rather than fall back to the
				// uncensored payload.
				continue
			}
		}
		if !client.trySend(out) {
			// Queue full (or connection already gone): drop the client.
			client.closeSend()
			delete(t.clients, client)
		}
	}
}

// censoredFor rewrites the update-game message's view for one viewer, hiding
// every hole card they may not see (see GameView.CensorFor). It returns nil if
// the personalized copy cannot be marshaled.
func (m *updateGame) censoredFor(viewerUUID string) []byte {
	game := updateGame{
		base:        m.base,
		Game:        m.Game.CensorFor(m.Game.ViewerNum(viewerUUID)),
		Waiting:     m.Waiting,
		SettleVotes: m.SettleVotes,
		Host:        m.Host,
	}

	resp, err := json.Marshal(game)
	if err != nil {
		slog.Default().Warn("Marshal censored update game", "error", err)
		return nil
	}
	return resp
}

// info returns a lightweight description of the table for the lobby.
func (t *table) info() tableInfo {
	view := t.game.GenerateOmniView()

	seated := make(map[string]bool, len(view.Players))
	for _, p := range view.Players {
		seated[p.UUID] = true
	}

	spectators := 0
	t.clientsMu.Lock()
	for c := range t.clients {
		if !seated[c.uuid] {
			spectators++
		}
	}
	t.clientsMu.Unlock()

	return tableInfo{
		Name:       t.name,
		Players:    len(view.Players),
		Running:    view.Running,
		Spectators: spectators,
		Locked:     t.password != "",
		Tournament: view.Config.MaxBuy > 0,
	}
}

// waitingUsernames returns the usernames of clients queued to join the next
// hand, for display in the game view.
func (t *table) waitingUsernames() []string {
	t.waitingMu.Lock()
	defer t.waitingMu.Unlock()
	names := make([]string, 0, len(t.waiting))
	for c := range t.waiting {
		if c.username != "" {
			names = append(names, c.username)
		}
	}
	return names
}

// settleVoteList returns the usernames of seated players who have voted to
// settle the current session.
func (t *table) settleVoteList() []string {
	t.settleMu.Lock()
	defer t.settleMu.Unlock()
	names := make([]string, 0, len(t.settleVotes))
	for name := range t.settleVotes {
		names = append(names, name)
	}
	return names
}

// toggleQueue adds or removes a client from the queue for the next hand,
// reporting whether the client is now queued.
func (t *table) toggleQueue(c *Client) bool {
	t.waitingMu.Lock()
	defer t.waitingMu.Unlock()
	if _, ok := t.waiting[c]; ok {
		delete(t.waiting, c)
		return false
	}
	t.waiting[c] = true
	return true
}

// seatWaitingPlayers seats every queued spectator into the game. It only does
// so while the game is between hands (stage PreDeal), so queued players join
// at the start of the following hand.
func (t *table) seatWaitingPlayers() {
	t.waitingMu.Lock()
	defer t.waitingMu.Unlock()

	if len(t.waiting) == 0 {
		return
	}

	view := t.game.GenerateOmniView()
	if view.Stage != poker.NotReady {
		return
	}

	for c := range t.waiting {
		if c.username == "" {
			continue
		}
		seated, err := t.seatQueuedClient(c)
		if err != nil {
			slog.Default().Warn("Seat queued player", "error", err)
			continue
		}
		if seated {
			delete(t.waiting, c)
		}
	}
}

// seatQueuedClient buys a queued client into the game at the first free seat
// and readies them so they are dealt into the next hand. It assumes the
// table's waiting mutex is held.
func (t *table) seatQueuedClient(c *Client) (bool, error) {
	view := t.game.GenerateOmniView()

	// Already seated (e.g. the client was seated between the queue check and
	// now, or reconnected with a seat).
	for i := range view.Players {
		if view.Players[i].UUID == c.uuid {
			return false, nil
		}
	}

	// Respect the table's max-player limit.
	if view.Config.MaxPlayers != 0 && uint(len(view.Players)) >= view.Config.MaxPlayers {
		return false, errors.New("table is full")
	}

	amount := view.Config.BuyIn
	if amount == 0 {
		return false, errors.New("amount must be positive")
	}
	// The account's buy-ins for the whole session count, not just this seat.
	if !t.canBuyIn(c.accountUUID, amount) {
		c.send <- createError(msgNoBuyInsLeft)
		return false, errors.New(msgNoBuyInsLeft)
	}

	user, err := loadUser(t.rdb, c.accountUUID)
	if err != nil {
		return false, err
	}
	if user.Chips < amount {
		return false, errors.New("not enough chips")
	}
	user.Chips -= amount
	if err := saveUser(t.rdb, user); err != nil {
		return false, err
	}

	// Pick the first free seat id.
	seatID := uint(1)
	for {
		used := false
		for _, p := range view.Players {
			if p.SeatID == seatID {
				used = true
				break
			}
		}
		if !used {
			break
		}
		seatID++
	}

	position := t.game.AddPlayer()
	c.uuid = t.game.GenerateOmniView().Players[position].UUID
	c.send <- createUpdatedPlayerUUID(c)

	if err := poker.SetAccountUUID(t.game, position, c.accountUUID); err != nil {
		slog.Default().Warn("Set account uuid", "error", err)
	}
	if err := poker.SetUsername(t.game, position, c.username); err != nil {
		slog.Default().Warn("Set username", "error", err)
	}
	if err := poker.SetAvatar(t.game, position, user.Avatar, user.AvatarImage); err != nil {
		slog.Default().Warn("Set avatar", "error", err)
	}
	if err := poker.BuyIn(t.game, position, amount); err != nil {
		slog.Default().Warn("Buy in", "error", err)
	} else {
		t.ledger.add(c.accountUUID, amount)
	}
	// Ready before SetSeatID re-sorts players, so the position index stays
	// valid. Blinds are recomputed when the next hand is dealt.
	if err := poker.ToggleReady(t.game, position, 0); err != nil {
		slog.Default().Warn("Toggle ready", "error", err)
	}
	if err := poker.SetSeatID(t.game, position, seatID); err != nil {
		slog.Default().Warn("Set seat id", "error", err)
	}

	c.send <- createUserInfo(t.rdb, user, true)
	return true, nil
}

// broadcastGame seats any queued spectators, settles the session if the hand
// limit has been reached or a settle vote passed, then pushes the current game
// state to everyone.
func (t *table) broadcastGame() {
	t.seatWaitingPlayers()
	if t.maybeSettleAfterHand() {
		return
	}
	if t.maybeSettle() {
		return
	}
	t.autoSpectateBusted()
	t.broadcast <- createUpdatedGameBytes(t)
	t.scheduleBots()
}

// maybeSettleAfterHand settles a session once a majority has voted to settle
// and the hand in progress has finished (back to PreDeal). It reports whether
// a settlement was triggered (and therefore already broadcast).
func (t *table) maybeSettleAfterHand() bool {
	t.settleMu.Lock()
	if t.settled || !t.settleAfterHand {
		t.settleMu.Unlock()
		return false
	}
	view := t.game.GenerateOmniView()
	if view.Stage != poker.NotReady {
		t.settleMu.Unlock()
		return false
	}
	t.settled = true
	t.settleAfterHand = false
	t.settleMu.Unlock()

	t.settle()
	return true
}

// maybeSettle ends the session once a fixed hand limit has been reached. It
// reports whether a settlement was triggered (and therefore already broadcast).
func (t *table) maybeSettle() bool {
	t.settleMu.Lock()
	if t.settled {
		t.settleMu.Unlock()
		return false
	}
	view := t.game.GenerateOmniView()
	if view.Config.HandsLimit == 0 || view.HandsPlayed < view.Config.HandsLimit {
		t.settleMu.Unlock()
		return false
	}
	t.settled = true
	t.settleMu.Unlock()

	t.settle()
	return true
}

// settle flushes every seated player's session, broadcasts the settlement
// screen, and resets the table for a fresh session.
func (t *table) settle() {
	t.settleMu.Lock()
	t.settleVotes = make(map[string]bool)
	t.settleAfterHand = false
	t.settleMu.Unlock()

	view := t.game.GenerateOmniView()

	// One row per account. Departed players already had their session flushed
	// when they left, so they are only added to the display (not settled
	// again); without them the nets would not sum to zero. A player who left
	// and sat down again is merged into a single row (see settlementRows).
	results := settlementRows(view)

	biggestWinner := ""
	for _, p := range view.Players {
		for _, num := range view.BiggestPotWinners {
			if p.Position == num {
				biggestWinner = p.Username
				break
			}
		}
		if biggestWinner != "" {
			break
		}
	}

	// Record each player's session (history + lifetime stats + chips back).
	for _, p := range view.Players {
		if _, err := t.flushSession(p.AccountUUID, p.TotalBuyIn, p.Stack, p.Stats); err != nil {
			slog.Default().Warn("Settle flush", "error", err)
		}
	}

	t.broadcast <- createSettlement(results, biggestWinner, view.BiggestPotAmt)
	t.game.Reset()
	t.resetSession()
	t.broadcast <- createUpdatedGameBytes(t)
}

// voteSettle toggles a seated player's vote to settle the session early. Once
// more than half of the seated players have voted, the session is settled at
// the end of the current hand.
func (t *table) voteSettle(c *Client) {
	if c.table == nil || c.username == "" {
		c.send <- createError("not in a room")
		return
	}

	view := t.game.GenerateOmniView()
	seated := false
	for _, p := range view.Players {
		if p.UUID == c.uuid {
			seated = true
			break
		}
	}
	if !seated {
		c.send <- createError("you are not seated")
		return
	}

	t.settleMu.Lock()
	if t.settled {
		t.settleMu.Unlock()
		return
	}
	voted := t.settleVotes[c.username]
	if voted {
		delete(t.settleVotes, c.username)
	} else {
		t.settleVotes[c.username] = true
	}
	votes := len(t.settleVotes)
	// Bots never vote and never block a vote: the majority is over humans.
	seatedCount := 0
	for _, p := range view.Players {
		if !isBotAccount(p.AccountUUID) {
			seatedCount++
		}
	}
	approved := seatedCount > 0 && votes > seatedCount/2
	t.settleAfterHand = approved
	t.settleMu.Unlock()

	switch {
	case voted:
		t.broadcast <- createNewLog(fmt.Sprintf("%s cancelled their settle vote (%d/%d)", c.username, votes, seatedCount))
	case approved:
		t.broadcast <- createNewLog("early settlement approved — will settle after this hand")
	default:
		t.broadcast <- createNewLog(fmt.Sprintf("%s voted to settle (%d/%d)", c.username, votes, seatedCount))
	}

	t.broadcastGame()
}

// toggleSpectate toggles a player's reservation to move to the spectator side.
// Between hands the reservation is applied immediately; during a hand it is
// applied once the hand ends.
func (t *table) toggleSpectate(c *Client) {
	if c.uuid == "" {
		return
	}

	c.spectateReserved = !c.spectateReserved

	view := t.game.GenerateOmniView()
	if c.spectateReserved && view.Stage == poker.NotReady {
		t.applySpectate(c)
	}
	t.broadcastGame()
}

// applySpectate removes a reserved player from the game and turns their client
// into a spectator. It reports whether the player was removed.
func (t *table) applySpectate(c *Client) bool {
	if c.uuid == "" {
		return false
	}

	view := t.game.GenerateOmniView()
	pos := -1
	for i := range view.Players {
		if view.Players[i].UUID == c.uuid {
			pos = i
			break
		}
	}
	if pos < 0 {
		return false
	}

	pre := view.Players[pos]
	stats := pre.Stats
	if pre.In {
		stats.Folds++
	}

	if err := poker.RemovePlayer(t.game, uint(pos)); err != nil {
		slog.Default().Warn("Spectate remove", "error", err)
	}
	if _, err := t.flushSession(pre.AccountUUID, pre.TotalBuyIn, pre.Stack, stats); err != nil {
		slog.Default().Warn("Spectate flush", "error", err)
	}

	c.uuid = ""
	c.spectateReserved = false
	c.send <- createUpdatedPlayerUUID(c)

	if len(t.game.GenerateOmniView().Players) == 0 {
		t.game.Reset()
		t.resetSession()
	} else {
		// A seated player moved to the spectator side between hands: put the
		// room back into the ready phase (clearing the previous hand's result)
		// so the remaining players can ready up again.
		poker.Pause(t.game)
	}
	return true
}

// applySpectateReservations moves every player who reserved spectate to the
// spectator side, between hands.
func (t *table) applySpectateReservations() {
	for {
		view := t.game.GenerateOmniView()
		if view.Stage != poker.NotReady {
			return
		}

		t.clientsMu.Lock()
		var target *Client
		for client := range t.clients {
			if client.spectateReserved && client.uuid != "" {
				target = client
				break
			}
		}
		t.clientsMu.Unlock()

		if target == nil {
			return
		}
		if !t.applySpectate(target) {
			target.spectateReserved = false
		}
	}
}

// autoSpectateBusted moves players who are busted with no remaining buy-ins to
// the spectator side, between hands.
func (t *table) autoSpectateBusted() {
	for {
		view := t.game.GenerateOmniView()
		if view.Running || view.Stage != poker.NotReady {
			return
		}
		pos := -1
		for i := range view.Players {
			p := view.Players[i]
			if p.Stack == 0 && view.Config.MaxBuy > 0 && p.TotalBuyIn >= view.Config.MaxBuy {
				pos = i
				break
			}
		}
		if pos < 0 {
			return
		}

		p := view.Players[pos]
		if _, err := t.flushSession(p.AccountUUID, p.TotalBuyIn, p.Stack, p.Stats); err != nil {
			slog.Default().Warn("Auto spectate flush", "error", err)
		}
		t.clearClientUUID(p.UUID)
		if err := poker.RemovePlayer(t.game, uint(pos)); err != nil {
			slog.Default().Warn("Auto spectate remove", "error", err)
		}
		// Tell the player why they are suddenly watching; the ledger keeps
		// them from taking a seat again this session (no buy-ins left).
		t.notifyAccount(p.AccountUUID, createError(msgBustedOut))
		t.broadcast <- createNewLog(fmt.Sprintf("%s is out of chips and moves to the spectators", p.Username))
	}
}

// clearClientUUID detaches the client seated as the given player so they become
// a spectator.
func (t *table) clearClientUUID(uuid string) {
	t.clientsMu.Lock()
	defer t.clientsMu.Unlock()
	for client := range t.clients {
		if client.uuid == uuid {
			client.uuid = ""
			client.trySend(createUpdatedPlayerUUID(client))
		}
	}
}

// startNewSession clears settlement state when players begin a new game.
func (t *table) startNewSession() {
	t.settleMu.Lock()
	t.settled = false
	t.settleAfterHand = false
	t.settleVotes = make(map[string]bool)
	t.settleMu.Unlock()
}

var ctx = context.Background()

func (t *table) publishMessages(message []byte) {
	err := t.rdb.Publish(ctx, t.name, message).Err()
	if err != nil {
		fmt.Println(err)
	}
}

func (t *table) subscribeToMessages() {
	pubsub := t.rdb.Subscribe(ctx, t.name)
	defer pubsub.Close()
	ch := pubsub.Channel()

	for {
		select {
		case msg, ok := <-ch:
			if !ok {
				return
			}
			t.broadcastToClients([]byte(msg.Payload))
		case <-t.stop:
			return
		}
	}
}
