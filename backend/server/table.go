package server

import (
	"context"
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
	name          string
	rdb           *redis.Client
	hub           *Hub
	clients       map[*Client]bool
	clientsMu     sync.Mutex
	register      chan *Client
	unregister    chan *Client
	broadcast     chan []byte
	game          *poker.Game
	password      string
	stop          chan struct{}
	stopOnce      sync.Once
	emptyTimer    *time.Timer
	offlineTimers map[string]*time.Timer
	offlineMu     sync.Mutex
}

// newTable creates a new table
func newTable(name string, redisClient *redis.Client, hub *Hub) *table {
	game := poker.NewGame()
	// Apply the default room config (SB 1 / BB 2, 6 players, buy-in 200 x2).
	poker.Configure(game, 1, 2, 200, 400, 6)
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

	if _, err := flushPlayerSession(
		t.rdb,
		view.Players[position].Username,
		t.name,
		view.Players[position].TotalBuyIn,
		view.Players[position].Stack,
		view.Players[position].Stats,
	); err != nil {
		slog.Default().Warn("Timeout flush", "error", err)
	}

	t.broadcast <- createUpdatedGameBytes(t)
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
