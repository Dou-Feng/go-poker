package server

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/evanofslack/go-poker/poker"
)

func TestWireActionsCannotReplayFoldOrOverbet(t *testing.T) {
	for _, action := range []string{"fold", "raise"} {
		t.Run(action, func(t *testing.T) {
			tbl, _ := newTestTable(t)
			seat(t, tbl, "a", 1, true)
			seat(t, tbl, "b", 2, true)
			if !autoStartIfReady(tbl) {
				t.Fatal("start failed")
			}
			c := actionClient(t, tbl)
			raw := []byte(`{"action":"player-raise","amount":1000000}`)
			if action == "fold" {
				raw = []byte(`{"action":"player-fold"}`)
				if err := c.processEvents(raw); err != nil {
					t.Fatal(err)
				}
			}
			before := tbl.game.GenerateOmniView()
			if err := c.processEvents(raw); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(before, tbl.game.GenerateOmniView()) {
				t.Fatal("illegal wire action changed game state")
			}
		})
	}
}

func TestWireFoldUnreadyMoveCannotChangeTurn(t *testing.T) {
	tbl, _ := newTestTable(t)
	seat(t, tbl, "a", 1, true)
	seat(t, tbl, "b", 2, true)
	seat(t, tbl, "c", 3, true)
	if !autoStartIfReady(tbl) {
		t.Fatal("start failed")
	}
	c := actionClient(t, tbl)
	if err := c.processEvents([]byte(`{"action":"player-fold"}`)); err != nil {
		t.Fatal(err)
	}
	before := tbl.game.GenerateOmniView()
	for _, raw := range []string{`{"action":"toggle-ready"}`, `{"action":"move-seat","seatID":6}`} {
		if err := c.processEvents([]byte(raw)); err != nil {
			t.Fatal(err)
		}
		if lastError(t, c) != "game already running" {
			t.Fatalf("request was not rejected: %s", raw)
		}
	}
	if !reflect.DeepEqual(before, tbl.game.GenerateOmniView()) {
		t.Fatal("fold/unready/move changed the active hand")
	}
	// The internal departure path must still allow a folded player to leave.
	if _, ok := tbl.evictPlayer(c.uuid); !ok {
		t.Fatal("folded player could not leave")
	}
	after := tbl.game.GenerateOmniView()
	pos, ok := findPlayer(after, c.uuid)
	if !ok || !after.Players[pos].Left || after.Stage != poker.PreFlop {
		t.Fatal("departure corrupted the running hand")
	}
}

func TestInRoomAuthenticationCannotSwitchIdentity(t *testing.T) {
	for _, raw := range []string{
		`{"action":"login","identifier":"another-account","password":"password"}`,
		`{"action":"register-user","username":"other","uuid":"other123","password":"password"}`,
		`{"action":"reconnect-user","uuid":"another-account","token":"token"}`,
	} {
		t.Run(raw, func(t *testing.T) {
			a, _ := newTestTable(t)
			b, _ := newTestTable(t)
			a.name = "a"
			b.name = "b"
			hub := newSessionHub(a, b)
			c := newTestClient(hub, "account-a")
			c.table = a
			c.username = "Alice"
			c.uuid = seat(t, a, "account-a", 1, false)
			a.registerClient(c)
			hub.bindSession(c)
			other := newTestClient(hub, "another-account")
			other.table = b
			other.uuid = seat(t, b, "another-account", 1, false)
			b.registerClient(other)
			hub.bindSession(other)
			before := c.uuid
			// No Redis is supplied: rejection must happen before token rotation,
			// account creation or any storage access.
			if err := c.processEvents([]byte(raw)); err != nil {
				t.Fatal(err)
			}
			if c.accountUUID != "account-a" || c.username != "Alice" || c.table != a || c.uuid != before || other.kicked.Load() {
				t.Fatal("authentication changed a live room binding")
			}
			if hub.sessions["account-a"] != c || hub.sessions["another-account"] != other || len(b.register) != 0 {
				t.Fatal("session registry or membership changed")
			}
			var response struct {
				Message string `json:"message"`
			}
			if err := json.Unmarshal(<-c.send, &response); err != nil {
				t.Fatal(err)
			}
			if response.Message != "already in a room" {
				t.Fatalf("response=%+v", response)
			}
		})
	}
}

func TestBindSessionCannotTransferBetweenAttachedRooms(t *testing.T) {
	a, _ := newTestTable(t)
	b, _ := newTestTable(t)
	a.name = "a"
	b.name = "b"
	hub := newSessionHub(a, b)
	old := newTestClient(hub, "account")
	old.table = b
	old.uuid = seat(t, b, "account", 1, false)
	hub.bindSession(old)
	c := newTestClient(hub, "account")
	c.table = a
	a.registerClient(c)
	hub.bindSession(c)
	if c.table != a || len(b.register) != 0 || old.kicked.Load() || hub.sessions["account"] != old {
		t.Fatal("bindSession bypassed room boundary")
	}
}
