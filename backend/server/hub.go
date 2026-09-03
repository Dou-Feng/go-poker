package server

import (
	"errors"
	"sync"

	"github.com/go-redis/redis/v8"
)

// Hub maintains the set of active clients and broadcasts messages to the
// clients.
type Hub struct {
	rdb        *redis.Client
	clients    map[*Client]bool
	broadcast  chan []byte
	register   chan *Client
	unregister chan *Client
	tables     map[*table]bool
	tablesMu   sync.Mutex
	users      map[string]bool
	usersMu    sync.Mutex
}

func newHub() (*Hub, error) {
	redis, err := newRedisClient()
	if err != nil {
		return nil, err
	}
	hub := &Hub{
		rdb:        redis,
		clients:    make(map[*Client]bool),
		broadcast:  make(chan []byte),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		tables:     make(map[*table]bool),
		users:      make(map[string]bool),
	}
	return hub, nil
}

func (h *Hub) run() {
	for {
		select {
		case client := <-h.register:
			h.registerClient(client)
		case client := <-h.unregister:
			h.unregisterClient(client)
		case message := <-h.broadcast:
			h.broadcastToClients(message)
		}
	}
}

func (h *Hub) registerClient(client *Client) {
	h.clients[client] = true
}

func (h *Hub) unregisterClient(client *Client) {
	if _, ok := h.clients[client]; ok {
		delete(h.clients, client)
		close(client.send)
	}
}

func (h *Hub) broadcastToClients(message []byte) {
	for client := range h.clients {
		select {
		case client.send <- message:
		default:
			close(client.send)
			delete(h.clients, client)
		}
	}
}

// createTableIfAbsent returns the table with the given name, creating it if it
// does not already exist. The second return value reports whether the table
// was newly created. The password is only applied to newly created tables.
func (h *Hub) createTableIfAbsent(name string, password string) (*table, bool) {
	h.tablesMu.Lock()
	defer h.tablesMu.Unlock()
	for t := range h.tables {
		if t.name == name {
			return t, false
		}
	}
	t := newTable(name, h.rdb, h)
	t.password = password
	go t.run()
	h.tables[t] = true
	return t, true
}

// registerUser reserves an account uuid for the lifetime of the server. It
// returns an error if the uuid is empty or already taken.
func (h *Hub) registerUser(uuid string) error {
	if uuid == "" {
		return errors.New("uuid cannot be empty")
	}
	h.usersMu.Lock()
	defer h.usersMu.Unlock()
	if _, ok := h.users[uuid]; ok {
		return errors.New("uuid already taken")
	}
	h.users[uuid] = true
	return nil
}

// unregisterUser releases an account uuid reservation.
func (h *Hub) unregisterUser(uuid string) {
	if uuid == "" {
		return
	}
	h.usersMu.Lock()
	delete(h.users, uuid)
	h.usersMu.Unlock()
}

// listTables returns a snapshot of all live tables.
func (h *Hub) listTables() []tableInfo {
	h.tablesMu.Lock()
	defer h.tablesMu.Unlock()
	infos := make([]tableInfo, 0, len(h.tables))
	for t := range h.tables {
		infos = append(infos, t.info())
	}
	return infos
}

// destroyTable removes a table from the hub and stops its goroutines.
func (h *Hub) destroyTable(t *table) {
	h.tablesMu.Lock()
	if _, ok := h.tables[t]; ok {
		delete(h.tables, t)
	}
	h.tablesMu.Unlock()

	t.shutdown()
}
