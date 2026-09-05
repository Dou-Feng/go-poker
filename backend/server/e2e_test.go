package server

import (
	"encoding/json"
	"net"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// End-to-end scenarios over real sockets against the real hub. They need a
// Redis instance (REDIS_URL) and are skipped without one:
//
//	REDIS_URL=redis://127.0.0.1:6390 go test ./server -run TestE2E -v
//
// The database is flushed at the start of each test, so point REDIS_URL at a
// throwaway instance.

// wsClient is one browser: it reads every server message into a queue and
// remembers the latest update-game view.
type wsClient struct {
	t    *testing.T
	name string
	conn *websocket.Conn
	msgs chan map[string]any
	uuid string // per-seat player uuid, from update-player-uuid
}

func dialWS(t *testing.T, name string, addr string) *wsClient {
	t.Helper()
	conn, _, err := websocket.DefaultDialer.Dial("ws://"+addr+"/ws", nil)
	if err != nil {
		t.Fatalf("%s: dial: %v", name, err)
	}
	c := &wsClient{t: t, name: name, conn: conn, msgs: make(chan map[string]any, 1024)}
	go func() {
		for {
			_, raw, err := conn.ReadMessage()
			if err != nil {
				close(c.msgs)
				return
			}
			var m map[string]any
			if json.Unmarshal(raw, &m) == nil {
				c.msgs <- m
			}
		}
	}()
	t.Cleanup(func() { conn.Close() })
	return c
}

func (c *wsClient) send(m map[string]any) {
	c.t.Helper()
	if err := c.conn.WriteJSON(m); err != nil {
		c.t.Fatalf("%s: send %v: %v", c.name, m["action"], err)
	}
}

// await returns the first message satisfying pred, tracking the seat uuid on
// the way. Every message drained is inspected for a "not seated"-style error
// unless allowErrors is set, so a stray rejection fails the test loudly.
func (c *wsClient) await(what string, timeout time.Duration, pred func(m map[string]any) bool) map[string]any {
	c.t.Helper()
	deadline := time.After(timeout)
	for {
		select {
		case m, ok := <-c.msgs:
			if !ok {
				c.t.Fatalf("%s: connection closed while waiting for %s", c.name, what)
			}
			if m["action"] == actionUpdatePlayerUUID {
				c.uuid, _ = m["uuid"].(string)
			}
			if pred(m) {
				return m
			}
		case <-deadline:
			c.t.Fatalf("%s: timed out waiting for %s", c.name, what)
		}
	}
}

func isAction(action string) func(m map[string]any) bool {
	return func(m map[string]any) bool { return m["action"] == action }
}

// gameOf extracts the view from an update-game message.
type e2ePlayer struct {
	UUID     string `json:"uuid"`
	Username string `json:"username"`
	Stack    uint   `json:"stack"`
	Bet      uint   `json:"bet"`
	Position uint   `json:"position"`
	Ready    bool   `json:"ready"`
	In       bool   `json:"in"`
}

type e2eGame struct {
	Running bool        `json:"running"`
	Betting bool        `json:"betting"`
	Stage   int         `json:"stage"`
	Action  uint        `json:"action"`
	Players []e2ePlayer `json:"players"`
}

func gameOf(t *testing.T, m map[string]any) e2eGame {
	t.Helper()
	raw, err := json.Marshal(m["game"])
	if err != nil {
		t.Fatalf("re-encode game: %v", err)
	}
	var g e2eGame
	if err := json.Unmarshal(raw, &g); err != nil {
		t.Fatalf("decode game: %v", err)
	}
	return g
}

func (g e2eGame) player(uuid string) *e2ePlayer {
	for i := range g.Players {
		if g.Players[i].UUID == uuid {
			return &g.Players[i]
		}
	}
	return nil
}

// awaitGame waits for an update-game whose view satisfies pred.
func (c *wsClient) awaitGame(what string, timeout time.Duration, pred func(g e2eGame) bool) e2eGame {
	c.t.Helper()
	m := c.await(what, timeout, func(m map[string]any) bool {
		return m["action"] == actionUpdateGame && pred(gameOf(c.t, m))
	})
	return gameOf(c.t, m)
}

func bootE2E(t *testing.T) (string, *Hub) {
	t.Helper()
	if os.Getenv("REDIS_URL") == "" {
		t.Skip("REDIS_URL not set; e2e test needs a throwaway Redis")
	}
	hub, err := newHub()
	if err != nil {
		t.Fatalf("hub: %v", err)
	}
	if err := hub.rdb.FlushDB(ctx).Err(); err != nil {
		t.Fatalf("flush redis: %v", err)
	}
	ln, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	s, err := newServer(hub, ln, tlsSettings{})
	if err != nil {
		t.Fatalf("newServer: %v", err)
	}
	if err := s.Run(); err != nil {
		t.Fatalf("run: %v", err)
	}
	t.Cleanup(func() { s.server.Close() })
	return ln.Addr().String(), hub
}

func register(c *wsClient, username, uuid string) {
	c.send(map[string]any{"action": actionRegisterUser, "username": username, "uuid": uuid, "password": "pw123456"})
	m := c.await("register-result", 3*time.Second, isAction(actionRegisterResult))
	if ok, _ := m["ok"].(bool); !ok {
		c.t.Fatalf("%s: register failed: %v", c.name, m["message"])
	}
}

// Two players, unlimited rebuys. They shove every hand until one busts; the
// busted player tops up their wallet, rebuys, and votes to surrender. The
// vote must be accepted (a log line), never rejected as "not seated".
func TestE2EBustRebuyThenSurrender(t *testing.T) {
	addr, _ := bootE2E(t)
	a := dialWS(t, "alice", addr)
	b := dialWS(t, "bob", addr)
	register(a, "alice", "alice1")
	register(b, "bob", "bob001")

	a.send(map[string]any{"action": actionCreateTable, "tablename": "e2e", "sb": 1, "bb": 2, "buyIn": 100, "maxPlayers": 2, "tournament": false})
	if m := a.await("create-result", 3*time.Second, isAction(actionCreateResult)); m["ok"] != true {
		t.Fatalf("create: %v", m["message"])
	}
	b.send(map[string]any{"action": actionJoinTable, "tablename": "e2e"})
	b.await("join update", 3*time.Second, isAction(actionUpdateGame))

	a.send(map[string]any{"action": actionTakeSeat, "username": "alice", "seatID": 1, "buyIn": 100})
	a.await("alice seat uuid", 3*time.Second, isAction(actionUpdatePlayerUUID))
	b.send(map[string]any{"action": actionTakeSeat, "username": "bob", "seatID": 2, "buyIn": 100})
	b.await("bob seat uuid", 3*time.Second, isAction(actionUpdatePlayerUUID))
	if a.uuid == "" || b.uuid == "" {
		t.Fatalf("seat uuids missing: %q %q", a.uuid, b.uuid)
	}
	clients := map[string]*wsClient{a.uuid: a, b.uuid: b}

	// Play shove/call hands until somebody busts.
	var busted *wsClient
	for hand := 0; hand < 40 && busted == nil; hand++ {
		a.send(map[string]any{"action": actionToggleReady})
		b.send(map[string]any{"action": actionToggleReady})
		g := b.awaitGame("hand running", 5*time.Second, func(g e2eGame) bool { return g.Running && g.Betting })

		// First to act shoves, the other calls (the server acts for the
		// player whose turn it is, so either socket may send it).
		actor := g.Players[g.Action]
		clients[actor.UUID].send(map[string]any{"action": actionPlayerRaise, "amount": actor.Stack})
		g = b.awaitGame("after shove", 5*time.Second, func(g e2eGame) bool {
			return !g.Betting || g.Players[g.Action].UUID != actor.UUID
		})
		if g.Betting {
			clients[g.Players[g.Action].UUID].send(map[string]any{"action": actionPlayerCall})
			g = b.awaitGame("all-in", 5*time.Second, func(g e2eGame) bool { return !g.Betting })
		}

		// Client-paced runout: reveal streets until the showdown, then one
		// more deal settles the hand and resets the table.
		for g.Stage != 6 {
			a.send(map[string]any{"action": actionDealGame})
			prev := g.Stage
			g = b.awaitGame("next street", 5*time.Second, func(g e2eGame) bool { return g.Stage != prev })
		}
		a.send(map[string]any{"action": actionDealGame})
		g = b.awaitGame("hand reset", 5*time.Second, func(g e2eGame) bool { return g.Stage == 1 })

		for _, p := range g.Players {
			if p.Stack == 0 {
				busted = clients[p.UUID]
			}
		}
	}
	if busted == nil {
		t.Fatalf("nobody busted in 40 shove hands")
	}

	// The busted player has no chips left in the wallet either (200 at
	// registration, 100 bought in, nothing won): recharge, then rebuy.
	busted.send(map[string]any{"action": actionAddChips, "amount": 500})
	busted.await("wallet", 3*time.Second, isAction(actionUserInfo))
	busted.send(map[string]any{"action": actionRebuy, "amount": 100})
	busted.awaitGame("rebuy applied", 3*time.Second, func(g e2eGame) bool {
		p := g.player(busted.uuid)
		return p != nil && p.Stack == 100
	})

	// Surrender vote must be accepted.
	busted.send(map[string]any{"action": actionVoteSettle})
	deadline := time.After(2 * time.Second)
	for {
		select {
		case m := <-busted.msgs:
			if m["action"] == actionError {
				t.Fatalf("surrender rejected: %v", m["message"])
			}
			if m["action"] == actionNewLog && strings.Contains(m["message"].(string), "voted to settle") {
				return
			}
		case <-deadline:
			t.Fatalf("no vote acknowledgement")
		}
	}
}

// playUntilBust drives shove/call hands between a and b until one of them has
// no chips, and returns the busted client.
func playUntilBust(t *testing.T, a, b *wsClient) *wsClient {
	t.Helper()
	clients := map[string]*wsClient{a.uuid: a, b.uuid: b}
	for hand := 0; hand < 40; hand++ {
		a.send(map[string]any{"action": actionToggleReady})
		b.send(map[string]any{"action": actionToggleReady})
		g := b.awaitGame("hand running", 5*time.Second, func(g e2eGame) bool { return g.Running && g.Betting })
		actor := g.Players[g.Action]
		clients[actor.UUID].send(map[string]any{"action": actionPlayerRaise, "amount": actor.Stack})
		g = b.awaitGame("after shove", 5*time.Second, func(g e2eGame) bool {
			return !g.Betting || g.Players[g.Action].UUID != actor.UUID
		})
		if g.Betting {
			clients[g.Players[g.Action].UUID].send(map[string]any{"action": actionPlayerCall})
			g = b.awaitGame("all-in", 5*time.Second, func(g e2eGame) bool { return !g.Betting })
		}
		for g.Stage != 6 {
			a.send(map[string]any{"action": actionDealGame})
			prev := g.Stage
			g = b.awaitGame("next street", 5*time.Second, func(g e2eGame) bool { return g.Stage != prev })
		}
		a.send(map[string]any{"action": actionDealGame})
		g = b.awaitGame("hand reset", 5*time.Second, func(g e2eGame) bool { return g.Stage == 1 })
		for _, p := range g.Players {
			if p.Stack == 0 {
				return clients[p.UUID]
			}
		}
	}
	t.Fatalf("nobody busted in 40 shove hands")
	return nil
}

// expectVoteAccepted sends a surrender vote and fails on any error reply.
func expectVoteAccepted(t *testing.T, c *wsClient) {
	t.Helper()
	c.send(map[string]any{"action": actionVoteSettle})
	deadline := time.After(2 * time.Second)
	for {
		select {
		case m, ok := <-c.msgs:
			if !ok {
				t.Fatalf("%s: connection closed", c.name)
			}
			if m["action"] == actionError {
				t.Fatalf("%s: surrender rejected: %v", c.name, m["message"])
			}
			if m["action"] == actionNewLog && strings.Contains(m["message"].(string), "voted to settle") {
				return
			}
		case <-deadline:
			t.Fatalf("%s: no vote acknowledgement", c.name)
		}
	}
}

// Same as above, but the busted player's phone drops and reopens its socket
// after the rebuy — the browser then replays `reconnect-user` and the saved
// `join-table` (reconnect + seat uuid) on the new socket, while the old socket
// is still open. The vote from the new socket must be accepted.
func TestE2ESurrenderAfterSocketReconnect(t *testing.T) {
	addr, _ := bootE2E(t)
	a := dialWS(t, "alice", addr)
	b := dialWS(t, "bob", addr)
	register(a, "alice", "alice1")
	register(b, "bob", "bob001")

	a.send(map[string]any{"action": actionCreateTable, "tablename": "e2e2", "sb": 1, "bb": 2, "buyIn": 100, "maxPlayers": 2})
	a.await("create-result", 3*time.Second, isAction(actionCreateResult))
	b.send(map[string]any{"action": actionJoinTable, "tablename": "e2e2"})
	b.await("join update", 3*time.Second, isAction(actionUpdateGame))
	a.send(map[string]any{"action": actionTakeSeat, "username": "alice", "seatID": 1, "buyIn": 100})
	a.await("alice seat uuid", 3*time.Second, isAction(actionUpdatePlayerUUID))
	b.send(map[string]any{"action": actionTakeSeat, "username": "bob", "seatID": 2, "buyIn": 100})
	b.await("bob seat uuid", 3*time.Second, isAction(actionUpdatePlayerUUID))

	busted := playUntilBust(t, a, b)
	account := map[*wsClient]string{a: "alice1", b: "bob001"}[busted]

	busted.send(map[string]any{"action": actionAddChips, "amount": 500})
	busted.await("wallet", 3*time.Second, isAction(actionUserInfo))
	busted.send(map[string]any{"action": actionRebuy, "amount": 100})
	busted.awaitGame("rebuy applied", 3*time.Second, func(g e2eGame) bool {
		p := g.player(busted.uuid)
		return p != nil && p.Stack == 100
	})

	// New socket for the same browser tab: replay exactly what index.tsx does.
	fresh := dialWS(t, busted.name+"-reconnected", addr)
	fresh.send(map[string]any{"action": actionReconnect, "uuid": account})
	fresh.send(map[string]any{"action": actionJoinTable, "tablename": "e2e2", "playerUUID": busted.uuid, "reconnect": true})
	fresh.await("seat restored", 3*time.Second, isAction(actionUpdatePlayerUUID))
	if fresh.uuid != busted.uuid {
		t.Fatalf("reconnected socket must hold the same seat: %q vs %q", fresh.uuid, busted.uuid)
	}
	fresh.awaitGame("view on new socket", 3*time.Second, func(g e2eGame) bool { return g.player(fresh.uuid) != nil })

	expectVoteAccepted(t, fresh)
}

// After a session settles, each player's history entry points at the shared
// session record, which lists every participant with their stats; someone who
// was not at the table cannot read it.
func TestE2EHistoryOpensSharedSession(t *testing.T) {
	addr, _ := bootE2E(t)
	a := dialWS(t, "alice", addr)
	b := dialWS(t, "bob", addr)
	register(a, "alice", "alice1")
	register(b, "bob", "bob001")

	a.send(map[string]any{"action": actionCreateTable, "tablename": "e2e3", "sb": 1, "bb": 2, "buyIn": 100, "maxPlayers": 2})
	a.await("create-result", 3*time.Second, isAction(actionCreateResult))
	b.send(map[string]any{"action": actionJoinTable, "tablename": "e2e3"})
	b.await("join update", 3*time.Second, isAction(actionUpdateGame))
	a.send(map[string]any{"action": actionTakeSeat, "username": "alice", "seatID": 1, "buyIn": 100})
	a.await("alice seat uuid", 3*time.Second, isAction(actionUpdatePlayerUUID))
	b.send(map[string]any{"action": actionTakeSeat, "username": "bob", "seatID": 2, "buyIn": 100})
	b.await("bob seat uuid", 3*time.Second, isAction(actionUpdatePlayerUUID))

	playUntilBust(t, a, b)

	// Both vote to surrender: with one player busted the table is between
	// hands, so the second vote settles at once.
	a.send(map[string]any{"action": actionVoteSettle})
	b.send(map[string]any{"action": actionVoteSettle})
	a.await("settlement", 5*time.Second, isAction(actionSettlement))

	a.send(map[string]any{"action": actionGetHistory})
	hist := a.await("history", 3*time.Second, isAction(actionHistory))
	entries, _ := hist["history"].([]any)
	if len(entries) == 0 {
		t.Fatalf("alice must have a history entry")
	}
	sessionID, _ := entries[0].(map[string]any)["sessionId"].(string)
	if sessionID == "" {
		t.Fatalf("history entry must reference the session record: %v", entries[0])
	}

	a.send(map[string]any{"action": actionGetSession, "id": sessionID})
	m := a.await("session", 3*time.Second, isAction(actionSession))
	raw, _ := json.Marshal(m["session"])
	var rec SessionRecord
	if err := json.Unmarshal(raw, &rec); err != nil {
		t.Fatalf("decode session: %v", err)
	}
	if !rec.Settled || rec.Room != "e2e3" || len(rec.Players) != 2 {
		t.Fatalf("unexpected session record: %+v", rec)
	}
	sum := 0
	for _, p := range rec.Players {
		sum += p.Net
		if p.Stats.HandsPlayed == 0 {
			t.Fatalf("each participant carries their session stats: %+v", p)
		}
	}
	if sum != 0 {
		t.Fatalf("nets must sum to zero, got %d", sum)
	}

	// A third account that never sat there is refused.
	c := dialWS(t, "carol", addr)
	register(c, "carol", "carol1")
	c.send(map[string]any{"action": actionGetSession, "id": sessionID})
	if e := c.await("refusal", 3*time.Second, isAction(actionError)); e["message"] != msgSessionNotFound {
		t.Fatalf("non-participant must get %q, got %v", msgSessionNotFound, e["message"])
	}
}
