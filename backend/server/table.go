package server

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/evanofslack/go-poker/poker"
	"github.com/go-redis/redis/v8"
)

// emptyTableTTL is how long a table lingers after the last client leaves
// before it is destroyed. It doubles as the grace period for reconnects.
const emptyTableTTL = time.Minute

// offlineTimeout is how long a disconnected player is allowed to reconnect
// before their hand is folded and they are removed from the room. It is kept
// shorter than emptyTableTTL so players are flushed before the room dies.
const offlineTimeout = 55 * time.Second

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
	waiting         map[*Client]bool
	waitingMu       sync.Mutex
	settleVotes     map[string]bool
	settleAfterHand bool
	settled         bool
	settleMu        sync.Mutex
}

// newTable creates a new table
func newTable(name string, redisClient *redis.Client, hub *Hub) *table {
	game := poker.NewGame()
	// Apply the default room config (SB 1 / BB 2, 6 players, buy-in 200 x2).
	poker.Configure(game, 1, 2, 200, 400, 6, 0)
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
		waiting:       make(map[*Client]bool),
		settleVotes:   make(map[string]bool),
	}
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
	t.offlineTimers[playerUUID] = time.AfterFunc(offlineTimeout, func() {
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

// timeoutPlayer folds a disconnected player out of the current hand, removes
// them from the room, and persists their session stats and remaining stack.
func (t *table) timeoutPlayer(playerUUID string) {
	view := t.game.GenerateOmniView()
	position := -1
	for i := range view.Players {
		if view.Players[i].UUID == playerUUID {
			position = i
			break
		}
	}
	if position < 0 {
		return
	}

	if err := poker.SitOut(t.game, uint(position), 0); err != nil {
		slog.Default().Warn("Timeout sit out", "error", err)
	}

	// Settle the timed-out player's session with the post-fold state.
	after := t.game.GenerateOmniView()
	for j := range after.Players {
		if after.Players[j].UUID == playerUUID {
			if _, err := flushPlayerSession(t.rdb, after.Players[j].Username, t.name, after.Players[j].TotalBuyIn, after.Players[j].Stack, after.Players[j].Stats); err != nil {
				slog.Default().Warn("Timeout flush", "error", err)
			}
			break
		}
	}

	// Kick the player out and put the room back into the ready phase: every
	// remaining player becomes not-ready, the game returns to the initial
	// state, and stacks are preserved so players can rebuy without losing
	// their chips.
	poker.ResetToReadyPhase(t.game)

	t.broadcastGame()
}

func (t *table) registerClient(client *Client) {
	t.clientsMu.Lock()
	t.clients[client] = true
	t.clientsMu.Unlock()

	if t.emptyTimer != nil {
		t.emptyTimer.Stop()
		t.emptyTimer = nil
	}
}

func (t *table) unregisterClient(client *Client) {
	t.waitingMu.Lock()
	delete(t.waiting, client)
	t.waitingMu.Unlock()

	t.clientsMu.Lock()
	if _, ok := t.clients[client]; ok {
		delete(t.clients, client)
	}
	empty := len(t.clients) == 0
	t.clientsMu.Unlock()

	if empty && t.emptyTimer == nil {
		t.emptyTimer = time.AfterFunc(emptyTableTTL, func() {
			if t.hub != nil {
				t.hub.destroyTable(t)
			}
		})
	}
}

func (t *table) broadcastToClients(message []byte) {
	t.clientsMu.Lock()
	defer t.clientsMu.Unlock()
	for client := range t.clients {
		select {
		case client.send <- message:
		default:
			close(client.send)
			delete(t.clients, client)
		}
	}
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
	if view.Stage != poker.PreDeal {
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

	user, err := loadUser(t.rdb, c.username)
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

	if err := poker.SetUsername(t.game, position, c.username); err != nil {
		slog.Default().Warn("Set username", "error", err)
	}
	if err := poker.SetAvatar(t.game, position, user.Avatar, user.AvatarImage); err != nil {
		slog.Default().Warn("Set avatar", "error", err)
	}
	if err := poker.BuyIn(t.game, position, amount); err != nil {
		slog.Default().Warn("Buy in", "error", err)
	}
	// Ready before SetSeatID re-sorts players, so the position index stays
	// valid. Blinds are recomputed when the next hand is dealt.
	if err := poker.ToggleReady(t.game, position, 0); err != nil {
		slog.Default().Warn("Toggle ready", "error", err)
	}
	if err := poker.SetSeatID(t.game, position, seatID); err != nil {
		slog.Default().Warn("Set seat id", "error", err)
	}

	c.send <- createUserInfo(user, true)
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
	if view.Stage != poker.PreDeal {
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

	results := make([]settlementPlayer, 0, len(view.Players))
	for _, p := range view.Players {
		results = append(results, settlementPlayer{
			Username:    p.Username,
			Avatar:      p.Avatar,
			AvatarImage: p.AvatarImage,
			BuyIn:       p.TotalBuyIn,
			Net:         int(p.Stack) - int(p.TotalBuyIn),
		})
	}

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
		if _, err := flushPlayerSession(t.rdb, p.Username, t.name, p.TotalBuyIn, p.Stack, p.Stats); err != nil {
			slog.Default().Warn("Settle flush", "error", err)
		}
	}

	t.broadcast <- createSettlement(results, biggestWinner, view.BiggestPotAmt)
	t.game.Reset()
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
	seatedCount := len(view.Players)
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
	if c.spectateReserved && view.Stage == poker.PreDeal {
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
	if _, err := flushPlayerSession(t.rdb, pre.Username, t.name, pre.TotalBuyIn, pre.Stack, stats); err != nil {
		slog.Default().Warn("Spectate flush", "error", err)
	}

	c.uuid = ""
	c.spectateReserved = false
	c.send <- createUpdatedPlayerUUID(c)

	if len(t.game.GenerateOmniView().Players) == 0 {
		t.game.Reset()
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
		if view.Stage != poker.PreDeal {
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
		if view.Running || view.Stage != poker.PreDeal {
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
		if _, err := flushPlayerSession(t.rdb, p.Username, t.name, p.TotalBuyIn, p.Stack, p.Stats); err != nil {
			slog.Default().Warn("Auto spectate flush", "error", err)
		}
		t.clearClientUUID(p.UUID)
		if err := poker.RemovePlayer(t.game, uint(pos)); err != nil {
			slog.Default().Warn("Auto spectate remove", "error", err)
		}
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
			client.send <- createUpdatedPlayerUUID(client)
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
