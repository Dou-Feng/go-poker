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

func TestJoiningMissingRoomDoesNotCreateIt(t *testing.T) {
	hub := newSessionHub()
	c := newTestClient(hub, "account")
	c.username = "player"

	handleJoinTable(c, "missing-room", "", "", false)
	if c.table != nil || hub.findTable("missing-room") != nil || len(hub.tables) != 0 {
		t.Fatal("joining a missing room created or attached to a table")
	}
	var result joinResult
	if err := json.Unmarshal(<-c.send, &result); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if result.Action != actionJoinResult || result.Ok || result.Message != "room not found" {
		t.Fatalf("unexpected join result: %+v", result)
	}
}

func TestRoomConfigRejectsUnsafeValues(t *testing.T) {
	valid := normalizeRoomConfig(5, 10, 200, 0, 6, 20, false)
	if err := validateRoomConfig("friendly-room", "secret", valid); err != nil {
		t.Fatalf("valid room rejected: %v", err)
	}

	cases := []struct {
		name     string
		room     string
		password string
		cfg      roomConfig
	}{
		{name: "blank room", room: "   ", cfg: valid},
		{name: "padded room", room: " room ", cfg: valid},
		{name: "long room", room: string(make([]byte, maxRoomNameLen+1)), cfg: valid},
		{name: "long password", room: "room", password: string(make([]byte, maxRoomPassLen+1)), cfg: valid},
		{name: "one player", room: "room", cfg: roomConfig{sb: 5, bb: 10, buyIn: 200, maxPlayers: 1}},
		{name: "too many players", room: "room", cfg: roomConfig{sb: 5, bb: 10, buyIn: 200, maxPlayers: 9}},
		{name: "reversed blinds", room: "room", cfg: roomConfig{sb: 20, bb: 10, buyIn: 200, maxPlayers: 6}},
		{name: "short buy-in", room: "room", cfg: roomConfig{sb: 5, bb: 10, buyIn: 9, maxPlayers: 6}},
		{name: "oversized chips", room: "room", cfg: roomConfig{sb: 5, bb: 10, buyIn: maxRoomChips + 1, maxPlayers: 6}},
		{name: "oversized hand limit", room: "room", cfg: roomConfig{sb: 5, bb: 10, buyIn: 200, maxPlayers: 6, handsLimit: maxHandsLimit + 1}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := validateRoomConfig(tc.room, tc.password, tc.cfg); err == nil {
				t.Fatal("unsafe room config was accepted")
			}
		})
	}
}

func TestInvalidRoomConfigDoesNotCreateRoom(t *testing.T) {
	hub := newSessionHub()
	c := newTestClient(hub, "host")
	handleCreateTable(c, "bad-room", "", 5, 10, 200, 0, maxRoomPlayers+1, 0, false, 0, botKindNormal)

	var res result
	if err := json.Unmarshal(<-c.send, &res); err != nil {
		t.Fatalf("decode create response: %v", err)
	}
	if res.Ok || len(hub.tables) != 0 {
		t.Fatalf("invalid config created a room: result=%+v tables=%d", res, len(hub.tables))
	}
}

func TestTakeSeatUsesAuthenticatedUsername(t *testing.T) {
	tbl, _ := newTestTable(t)
	store := newMemUserStore()
	store.save(&UserRecord{UUID: "account", Username: "real-name", Chips: 1000})
	tbl.users = store
	hub := newSessionHub(tbl)
	c := newTestClient(hub, "account")
	c.username = "real-name"
	c.table = tbl

	handleTakeSeat(c, "forged-name", 1, 200)
	view := tbl.game.GenerateOmniView()
	if len(view.Players) != 1 || view.Players[0].Username != "real-name" {
		t.Fatalf("seat used an untrusted username: %+v", view.Players)
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
