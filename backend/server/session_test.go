package server

import (
	"encoding/json"
	"testing"
	"time"
)

// Tests for the single-session-per-account rules in session.go: a second
// login kicks the previous connection (session-expired notice and close frame
// in one kickRequest) and the account's seat transfers to the new connection
// at once, bypassing the offline eviction.

// newSessionHub builds a hub literal whose tables/sessions maps are ready for
// bindSession, with no Redis and no guard. The tables are wired back to the
// hub so eviction-time table destruction would find it.
func newSessionHub(tbls ...*table) *Hub {
	hub := &Hub{
		tables:   make(map[*table]bool),
		clients:  make(map[*Client]bool),
		sessions: make(map[string]*Client),
	}
	for _, tbl := range tbls {
		hub.tables[tbl] = true
		tbl.hub = hub
	}
	return hub
}

// newTestClient builds a client literal safe for the session code paths (the
// kick channel must be real for kickClient's non-blocking send).
func newTestClient(hub *Hub, accountUUID string) *Client {
	return &Client{
		hub:         hub,
		send:        make(chan []byte, 16),
		kick:        make(chan kickRequest, 1),
		accountUUID: accountUUID,
	}
}

// A seated connection is kicked when the same account logs in elsewhere, and
// its seat — mid-grace-period timer included — transfers to the newcomer.
func TestBindSessionKicksOldClientAndTransfersSeat(t *testing.T) {
	tbl, rec := newTestTable(t)
	a := seat(t, tbl, "acc-a", 1, true)
	seat(t, tbl, "acc-b", 2, false)

	hub := newSessionHub(tbl)

	old := newTestClient(hub, "acc-a")
	old.table = tbl
	old.uuid = a
	hub.bindSession(old)

	// Arm the offline timer as if the old connection had also just dropped:
	// the takeover must cancel it, not let it evict the seat 60s later.
	tbl.markPlayerOffline(a)

	fresh := newTestClient(hub, "acc-a")
	hub.bindSession(fresh)

	// The registry now points at the new connection.
	hub.sessionsMu.Lock()
	holder := hub.sessions["acc-a"]
	hub.sessionsMu.Unlock()
	if holder != fresh {
		t.Fatalf("session registry should point at the new client")
	}

	// The old connection was kicked: notice first, close frame with it.
	if !old.kicked.Load() {
		t.Fatalf("the previous connection must be marked kicked")
	}
	select {
	case req := <-old.kick:
		var notice sessionExpired
		if err := json.Unmarshal(req.notice, &notice); err != nil {
			t.Fatalf("decode notice: %v", err)
		}
		if notice.Action != actionSessionExpired || notice.Tablename != "" || notice.Message != msgSessionTakenover {
			t.Fatalf("unexpected kick notice: %+v", notice)
		}
	default:
		t.Fatalf("expected a kick request for the old connection")
	}

	// The seat transferred: same table, same per-session uuid.
	if fresh.table != tbl || fresh.uuid != a || fresh.accountUUID != "acc-a" {
		t.Fatalf("seat should transfer to the new connection: table=%v uuid=%q account=%q", fresh.table == tbl, fresh.uuid, fresh.accountUUID)
	}
	select {
	case registered := <-tbl.register:
		if registered != fresh {
			t.Fatalf("the new connection should be registered at the table")
		}
	default:
		t.Fatalf("expected the new connection to register at the table")
	}

	// The new holder is told its uuid (with the room name) and the game.
	select {
	case raw := <-fresh.send:
		var msg updatePlayerUUID
		if err := json.Unmarshal(raw, &msg); err != nil {
			t.Fatalf("decode update-player-uuid: %v", err)
		}
		if msg.Action != actionUpdatePlayerUUID || msg.Uuid != a || msg.Tablename != tbl.name {
			t.Fatalf("unexpected update-player-uuid: %+v", msg)
		}
	default:
		t.Fatalf("expected update-player-uuid after the takeover")
	}
	if got := readAction(t, fresh.send); got != actionUpdateGame {
		t.Fatalf("expected %s after the takeover, got %s", actionUpdateGame, got)
	}

	// The armed offline timer was cancelled, nothing was flushed.
	tbl.offlineMu.Lock()
	_, pending := tbl.offlineTimers[a]
	tbl.offlineMu.Unlock()
	if pending {
		t.Fatalf("the takeover must cancel the pending offline timer")
	}

	// The old connection's teardown must not evict the transferred seat.
	old.detachTable()
	time.Sleep(4 * tbl.offlineAfter)
	view := tbl.game.GenerateOmniView()
	pos, ok := findPlayer(view, a)
	if !ok {
		t.Fatalf("the transferred seat must survive the old connection's teardown")
	}
	if view.Players[pos].AccountUUID != "acc-a" {
		t.Fatalf("the seat must still belong to acc-a")
	}
	if calls := rec.snapshot(); len(calls) != 0 {
		t.Fatalf("no session may be flushed on a takeover, got %+v", calls)
	}
}

// A spectator connection is kicked too, but there is no seat to hand over.
func TestBindSessionSpectatorKickWithoutSeatTransfer(t *testing.T) {
	tbl, rec := newTestTable(t)
	hub := newSessionHub(tbl)

	old := newTestClient(hub, "acc-a")
	old.table = tbl // spectator: seated nowhere, uuid empty
	hub.bindSession(old)

	fresh := newTestClient(hub, "acc-a")
	hub.bindSession(fresh)

	if !old.kicked.Load() {
		t.Fatalf("a spectator connection must still be kicked on takeover")
	}
	if fresh.table != nil {
		t.Fatalf("no seat to transfer: the new client must stay in the lobby")
	}
	select {
	case raw := <-fresh.send:
		t.Fatalf("no game message expected, got %s", raw)
	default:
	}
	select {
	case <-tbl.register:
		t.Fatalf("the new client must not be registered at the table")
	default:
	}
	if calls := rec.snapshot(); len(calls) != 0 {
		t.Fatalf("no session may be flushed, got %+v", calls)
	}
}

// A kicked connection's teardown skips the offline timer; a normally
// disconnected player still arms it.
func TestKickedDetachTableSkipsOfflineTimer(t *testing.T) {
	tbl, _ := newTestTable(t)
	a := seat(t, tbl, "acc-a", 1, true)
	b := seat(t, tbl, "acc-b", 2, false)

	kicked := newTestClient(nil, "acc-a")
	kicked.table = tbl
	kicked.uuid = a
	kicked.kicked.Store(true)
	kicked.detachTable()

	tbl.offlineMu.Lock()
	_, pendingA := tbl.offlineTimers[a]
	tbl.offlineMu.Unlock()
	if pendingA {
		t.Fatalf("a kicked connection must not arm the offline timer")
	}

	live := newTestClient(nil, "acc-b")
	live.table = tbl
	live.uuid = b
	live.detachTable()

	tbl.offlineMu.Lock()
	_, pendingB := tbl.offlineTimers[b]
	tbl.offlineMu.Unlock()
	if !pendingB {
		t.Fatalf("a normally disconnected player must still arm the offline timer")
	}
	tbl.markPlayerOnline(b)
}

// A stale offline timer must not evict a seat that a live connection holds
// (e.g. after a session takeover moved the seat to a new connection).
func TestTimeoutPlayerSkipsSeatWithLiveClient(t *testing.T) {
	tbl, rec := newTestTable(t)
	a := seat(t, tbl, "acc-a", 1, true)
	seat(t, tbl, "acc-b", 2, false)

	holder := newTestClient(nil, "acc-a")
	holder.table = tbl
	holder.uuid = a
	tbl.clientsMu.Lock()
	tbl.clients[holder] = true
	tbl.clientsMu.Unlock()

	tbl.timeoutPlayer(a)

	if _, seated := findPlayer(tbl.game.GenerateOmniView(), a); !seated {
		t.Fatalf("a seat held by a live connection must not be evicted by a stale timer")
	}
	if calls := rec.snapshot(); len(calls) != 0 {
		t.Fatalf("no session may be flushed while the seat is held, got %+v", calls)
	}

	// Once nobody holds the seat, the eviction runs as before.
	tbl.clientsMu.Lock()
	delete(tbl.clients, holder)
	tbl.clientsMu.Unlock()
	tbl.timeoutPlayer(a)
	waitFor(t, "player a to be evicted", func() bool {
		_, seated := findPlayer(tbl.game.GenerateOmniView(), a)
		return !seated
	})
	if calls := rec.snapshot(); len(calls) != 1 {
		t.Fatalf("expected exactly one flush after eviction, got %+v", calls)
	}
}

// With no previous connection (the holder went offline within the grace
// period), a login instantly claims the account's orphaned seat; a seat held
// by a live connection is never handed out by the orphan scan.
func TestBindSessionTakesOverOrphanedSeat(t *testing.T) {
	tbl, rec := newTestTable(t)
	a := seat(t, tbl, "acc-a", 1, true)
	b := seat(t, tbl, "acc-b", 2, false)
	hub := newSessionHub(tbl)

	// The holder went offline within the grace period: the seat is orphaned.
	tbl.markPlayerOffline(a)

	fresh := newTestClient(hub, "acc-a")
	hub.bindSession(fresh)

	if fresh.table != tbl || fresh.uuid != a {
		t.Fatalf("the orphaned seat should transfer instantly: table=%v uuid=%q", fresh.table == tbl, fresh.uuid)
	}
	tbl.offlineMu.Lock()
	_, pending := tbl.offlineTimers[a]
	tbl.offlineMu.Unlock()
	if pending {
		t.Fatalf("taking over the orphaned seat must cancel the eviction timer")
	}
	if got := readAction(t, fresh.send); got != actionUpdatePlayerUUID {
		t.Fatalf("expected %s, got %s", actionUpdatePlayerUUID, got)
	}
	if got := readAction(t, fresh.send); got != actionUpdateGame {
		t.Fatalf("expected %s, got %s", actionUpdateGame, got)
	}

	// A seat held by a live connection is the kick path's business: the
	// orphan scan must not hand it to a second login of that account.
	holder := newTestClient(hub, "acc-b")
	holder.table = tbl
	holder.uuid = b
	tbl.clientsMu.Lock()
	tbl.clients[holder] = true
	tbl.clientsMu.Unlock()

	second := newTestClient(hub, "acc-b")
	hub.bindSession(second)
	if second.table != nil {
		t.Fatalf("a live-held seat must not be taken by the orphan scan")
	}
	select {
	case raw := <-second.send:
		t.Fatalf("no game message expected, got %s", raw)
	default:
	}
	if calls := rec.snapshot(); len(calls) != 0 {
		t.Fatalf("no session may be flushed, got %+v", calls)
	}
}

// Unregistering a connection drops its session binding — unless a newer
// connection already replaced it.
func TestUnregisterForgetsSession(t *testing.T) {
	hub := &Hub{
		clients:  make(map[*Client]bool),
		sessions: make(map[string]*Client),
	}

	c1 := newTestClient(hub, "acc-a")
	c2 := newTestClient(hub, "acc-a")
	hub.registerClient(c1)
	hub.registerClient(c2)

	// c2 took the account over: c1's teardown must not drop c2's binding.
	hub.sessions["acc-a"] = c2
	hub.unregisterClient(c1)
	hub.sessionsMu.Lock()
	holder := hub.sessions["acc-a"]
	hub.sessionsMu.Unlock()
	if holder != c2 {
		t.Fatalf("a newer binding must survive the previous connection's teardown")
	}
	if _, ok := <-c1.send; ok {
		t.Fatalf("unregister must close the client's send channel")
	}

	hub.unregisterClient(c2)
	hub.sessionsMu.Lock()
	_, held := hub.sessions["acc-a"]
	hub.sessionsMu.Unlock()
	if held {
		t.Fatalf("the binding must be dropped when the holder disconnects")
	}
}

// Inbound messages still in flight when the takeover landed (e.g. a
// leave-table) are ignored, so they cannot evict the transferred seat.
func TestKickedClientIgnoresInboundMessages(t *testing.T) {
	tbl, rec := newTestTable(t)
	a := seat(t, tbl, "acc-a", 1, true)
	seat(t, tbl, "acc-b", 2, false)

	kicked := newTestClient(nil, "acc-a")
	kicked.table = tbl
	kicked.uuid = a
	kicked.kicked.Store(true)

	raw := []byte(`{"action":"leave-table","tablename":"test-room"}`)
	if err := kicked.processEvents(raw); err != nil {
		t.Fatalf("a kicked client must no-op, got %v", err)
	}
	if _, seated := findPlayer(tbl.game.GenerateOmniView(), a); !seated {
		t.Fatalf("a kicked client must not evict the transferred seat")
	}
	if calls := rec.snapshot(); len(calls) != 0 {
		t.Fatalf("no session may be flushed, got %+v", calls)
	}

	// Control: without the flag, the same message does evict.
	live := newTestClient(nil, "acc-a")
	live.table = tbl
	live.uuid = a
	if err := live.processEvents(raw); err != nil {
		t.Fatalf("process leave-table: %v", err)
	}
	waitFor(t, "player a to leave", func() bool {
		_, seated := findPlayer(tbl.game.GenerateOmniView(), a)
		return !seated
	})
}
