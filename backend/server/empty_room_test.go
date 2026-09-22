package server

import (
	"testing"

	"github.com/evanofslack/go-poker/poker"
)

func assertTableDestroyed(t *testing.T, hub *Hub, tbl *table) {
	t.Helper()
	if hub.findTable(tbl.name) != nil || len(hub.listTables()) != 0 {
		t.Fatal("empty room remains in the lobby")
	}
	select {
	case <-tbl.stop:
	default:
		t.Fatal("empty room goroutines were not stopped")
	}
}

func TestLastSpectatorLeavingDestroysRoomImmediately(t *testing.T) {
	tbl, _ := newTestTable(t)
	hub := newSessionHub(tbl)
	a, b := newTestClient(hub, "a"), newTestClient(hub, "b")
	tbl.registerClient(a)
	tbl.registerClient(b)
	tbl.unregisterClient(a)
	if hub.findTable(tbl.name) != tbl {
		t.Fatal("room with a spectator was destroyed")
	}
	tbl.unregisterClient(b)
	assertTableDestroyed(t, hub, tbl)
}

func TestLastPlayerLeavingRefundsAndDestroysImmediately(t *testing.T) {
	tbl, rec := newTestTable(t)
	hub := newSessionHub(tbl)
	c := newTestClient(hub, "a")
	c.table = tbl
	c.uuid = seat(t, tbl, "a", 1, false)
	tbl.registerClient(c)
	handleLeaveTable(c, tbl.name)
	tbl.unregisterClient(<-tbl.unregister)
	assertTableDestroyed(t, hub, tbl)
	calls := rec.snapshot()
	if len(calls) != 1 || calls[0].AccountUUID != "a" || calls[0].Stack != 200 {
		t.Fatalf("player's stack was not returned exactly once: %+v", calls)
	}
}

func TestDisconnectedSeatKeepsReconnectGraceThenDestroysRoom(t *testing.T) {
	tbl, rec := newTestTable(t)
	hub := newSessionHub(tbl)
	c := newTestClient(hub, "a")
	c.uuid = seat(t, tbl, "a", 1, false)
	tbl.registerClient(c)
	tbl.unregisterClient(c)
	if hub.findTable(tbl.name) != tbl || len(rec.snapshot()) != 0 {
		t.Fatal("disconnected player's seat lost its reconnect grace")
	}
	// Exercise the expiry callback directly, without a wall-clock delay.
	tbl.timeoutPlayer(c.uuid)
	assertTableDestroyed(t, hub, tbl)
	if calls := rec.snapshot(); len(calls) != 1 || calls[0].Stack != 200 {
		t.Fatalf("offline seat was discarded before refund: %+v", calls)
	}
}

func TestQueuedJoinKeepsEmptyRoomAlive(t *testing.T) {
	tbl, _ := newTestTable(t)
	hub := newSessionHub(tbl)
	old, fresh := newTestClient(hub, "a"), newTestClient(hub, "b")
	tbl.registerClient(old)
	tbl.register <- fresh
	tbl.unregisterClient(old)
	if hub.findTable(tbl.name) != tbl {
		t.Fatal("room destroyed while an accepted join was queued")
	}
	tbl.registerClient(<-tbl.register)
	tbl.unregisterClient(fresh)
	assertTableDestroyed(t, hub, tbl)
}

func TestDepartedSeatsInActiveHandDoNotKeepRoomAlive(t *testing.T) {
	tbl, _ := newTestTable(t)
	hub := newSessionHub(tbl)
	a, b := newTestClient(hub, "a"), newTestClient(hub, "b")
	a.uuid = seat(t, tbl, "a", 1, true)
	b.uuid = seat(t, tbl, "b", 2, true)
	tbl.registerClient(a)
	tbl.registerClient(b)
	if err := tbl.game.Start(); err != nil {
		t.Fatal(err)
	}
	// Both players leave with committed chips still represented in the hand.
	for _, c := range []*Client{a, b} {
		tbl.evictPlayer(c.uuid)
		tbl.unregisterClient(c)
	}
	assertTableDestroyed(t, hub, tbl)
	if view := tbl.game.GenerateOmniView(); view.Stage != poker.NotReady {
		for _, p := range view.Players {
			if !p.Left {
				t.Fatal("room destroyed with a human still playing")
			}
		}
	}
}
