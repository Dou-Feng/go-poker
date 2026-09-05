package server

import (
	"encoding/json"
	"testing"

	"github.com/alexclewontin/riverboat/eval"
	"github.com/evanofslack/go-poker/poker"
)

// TestBroadcastCensorsHoleCards verifies the update-game fan-out: every client
// receives the same state except that each sees only the hole cards they are
// entitled to — their own during play, and none for spectators.
func TestBroadcastCensorsHoleCards(t *testing.T) {
	tbl, _ := newTestTable(t)
	aliceUUID := seat(t, tbl, "alice", 1, true)
	bobUUID := seat(t, tbl, "bob", 2, true)

	view := tbl.game.GenerateOmniView()
	if err := poker.Deal(tbl.game, view.DealerNum, 0); err != nil {
		t.Fatalf("deal: %v", err)
	}

	newClient := func(uuid string) *Client {
		c := &Client{uuid: uuid, send: make(chan []byte, 4)}
		tbl.registerClient(c)
		return c
	}
	alice := newClient(aliceUUID)
	bob := newClient(bobUUID)
	spectator := newClient("not-seated-uuid")

	tbl.broadcastToClients(createUpdatedGameBytes(tbl))

	recv := func(c *Client) *poker.GameView {
		t.Helper()
		var raw []byte
		select {
		case raw = <-c.send:
		default:
			t.Fatal("no update-game delivered")
		}
		var msg updateGame
		if err := json.Unmarshal(raw, &msg); err != nil {
			t.Fatalf("unmarshal update-game: %v", err)
		}
		return msg.Game
	}

	aView, bView, sView := recv(alice), recv(bob), recv(spectator)

	ai, _ := findPlayer(aView, aliceUUID)
	bi, _ := findPlayer(aView, bobUUID)
	if aView.Players[ai].Cards == [2]eval.Card{} {
		t.Error("alice cannot see her own cards")
	}
	if aView.Players[bi].Cards != [2]eval.Card{} {
		t.Error("alice received bob's hole cards")
	}

	if bView.Players[bi].Cards == [2]eval.Card{} {
		t.Error("bob cannot see his own cards")
	}

	if sView.Players[ai].Cards != [2]eval.Card{} || sView.Players[bi].Cards != [2]eval.Card{} {
		t.Error("spectator received hole cards")
	}
}
