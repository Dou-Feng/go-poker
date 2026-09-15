package server

import (
	"encoding/json"
	"testing"
)

func TestAnonymousRoomActionIsRejectedWithoutPanic(t *testing.T) {
	c := &Client{send: make(chan []byte, 1)}
	c.processEvents([]byte(`{"action":"player-fold"}`))

	var msg struct {
		Action  string `json:"action"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(<-c.send, &msg); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if msg.Action != actionError || msg.Message != "not logged in" {
		t.Fatalf("unexpected response: %+v", msg)
	}
}

func TestBettingActionRequiresCurrentSeatOwner(t *testing.T) {
	tbl, _ := newTestTable(t)
	seat(t, tbl, "acc-a", 1, true)
	seat(t, tbl, "acc-b", 2, true)
	if !autoStartIfReady(tbl) {
		t.Fatal("hand did not start")
	}

	before := tbl.game.GenerateOmniView()
	attacker := &Client{
		table:       tbl,
		uuid:        "attacker-seat",
		accountUUID: "attacker-account",
		send:        make(chan []byte, 1),
	}
	handleFold(attacker)
	after := tbl.game.GenerateOmniView()
	if after.Stage != before.Stage || after.ActionNum != before.ActionNum || !after.Players[before.ActionNum].In {
		t.Fatalf("unauthorized fold changed game state")
	}

	var msg struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal(<-attacker.send, &msg); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if msg.Message != "not your turn" {
		t.Fatalf("message = %q, want not your turn", msg.Message)
	}

	handleFold(actionClient(t, tbl))
	if tbl.game.GenerateOmniView().Players[before.ActionNum].In {
		t.Fatalf("seat owner should be able to fold")
	}
}

func TestReconnectPlayerRequiresSeatAccount(t *testing.T) {
	tbl, _ := newTestTable(t)
	playerUUID := seat(t, tbl, "victim-account", 1, false)

	attacker := &Client{table: tbl, accountUUID: "attacker-account", send: make(chan []byte, 2)}
	if reconnectPlayer(attacker, playerUUID) {
		t.Fatal("another account reconnected to the victim's seat")
	}
	if attacker.uuid != "" {
		t.Fatalf("attacker inherited seat uuid %q", attacker.uuid)
	}

	victim := &Client{table: tbl, accountUUID: "victim-account", send: make(chan []byte, 2)}
	if !reconnectPlayer(victim, playerUUID) || victim.uuid != playerUUID {
		t.Fatal("seat owner could not reconnect")
	}
}

func TestSessionTokenIsHashedAndVerifiable(t *testing.T) {
	user := &UserRecord{UUID: "account"}
	token, err := newSessionToken(user)
	if err != nil {
		t.Fatalf("new token: %v", err)
	}
	if token == "" || user.SessionHash == "" || token == user.SessionHash {
		t.Fatalf("token must be nonempty and stored only as a hash")
	}
	if !validSessionToken(user, token) || validSessionToken(user, token+"x") {
		t.Fatal("session token verification returned the wrong result")
	}

	newToken, err := newSessionToken(user)
	if err != nil {
		t.Fatalf("rotate token: %v", err)
	}
	if validSessionToken(user, token) || !validSessionToken(user, newToken) {
		t.Fatal("rotating the token must invalidate the previous token")
	}
}

func TestWrongRoomPasswordDoesNotAttachClient(t *testing.T) {
	tbl, _ := newTestTable(t)
	tbl.password = "secret"
	hub := newSessionHub(tbl)
	c := newTestClient(hub, "account")
	c.username = "player"

	handleJoinTable(c, tbl.name, "wrong", "", false)
	if c.table != nil {
		t.Fatal("wrong password attached client to the table")
	}
	var result joinResult
	if err := json.Unmarshal(<-c.send, &result); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if result.Action != actionJoinResult || result.Ok || result.Message != "wrong password" || result.Tablename != tbl.name {
		t.Fatalf("unexpected join result: %+v", result)
	}
	select {
	case <-tbl.register:
		t.Fatal("wrong password queued a table registration")
	default:
	}
}

func TestChatUsesAuthenticatedUsername(t *testing.T) {
	tbl, _ := newTestTable(t)
	c := &Client{table: tbl, username: "real-name"}
	handleSendMessage(c, "forged-name", "hello")

	var message newMessage
	if err := json.Unmarshal(<-tbl.broadcast, &message); err != nil {
		t.Fatalf("decode chat: %v", err)
	}
	if message.Username != "real-name" || message.Message != "hello" {
		t.Fatalf("unexpected chat message: %+v", message)
	}
}

func TestSpectatorCannotAdvanceHand(t *testing.T) {
	tbl, _ := newTestTable(t)
	seat(t, tbl, "acc-a", 1, true)
	seat(t, tbl, "acc-b", 2, true)
	if !autoStartIfReady(tbl) {
		t.Fatal("hand did not start")
	}

	before := tbl.game.GenerateOmniView()
	spectator := &Client{
		table:       tbl,
		accountUUID: "spectator",
		send:        make(chan []byte, 1),
	}
	handleDealGame(spectator)
	after := tbl.game.GenerateOmniView()
	if after.Stage != before.Stage || after.ActionNum != before.ActionNum {
		t.Fatal("spectator advanced the hand")
	}

	var message errorMessage
	if err := json.Unmarshal(<-spectator.send, &message); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if message.Message != "you are not seated" {
		t.Fatalf("message = %q, want you are not seated", message.Message)
	}
}
