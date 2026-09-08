package server

import (
	"encoding/json"
	"testing"
)

func TestSpectatorRosterTracksConnectionsAndSeating(t *testing.T) {
	tbl, _ := newTestTable(t)
	playerUUID := seat(t, tbl, "seated", 1, false)
	player := &Client{uuid: playerUUID, accountUUID: "seated", username: "Player"}
	// An account reconnecting before its session uuid is restored is still seated.
	replay := &Client{accountUUID: "seated", username: "Player"}
	watcher := &Client{accountUUID: "watcher", username: "Walker", table: tbl}
	duplicate := &Client{accountUUID: "watcher", username: "Walker"}
	bot := &Client{isBot: true, username: "Bot"}
	kicked := &Client{accountUUID: "kicked", username: "Old"}
	kicked.kicked.Store(true)
	for _, c := range []*Client{player, replay, watcher, duplicate, bot, kicked} {
		tbl.registerClient(c)
	}
	view := tbl.game.GenerateOmniView()
	roster := tbl.spectators(view)
	if len(roster) != 1 || roster[0].AccountUUID != "watcher" {
		t.Fatalf("wrong roster: %+v", roster)
	}
	var snapshot updateGame
	if err := json.Unmarshal(createUpdatedGame(watcher), &snapshot); err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Spectators) != 1 {
		t.Fatal("direct update missing spectators")
	}
	if err := json.Unmarshal(createUpdatedGameBytes(tbl), &snapshot); err != nil {
		t.Fatal(err)
	}
	var censored updateGame
	if err := json.Unmarshal(snapshot.censoredFor(""), &censored); err != nil {
		t.Fatal(err)
	}
	if len(censored.Spectators) != 1 {
		t.Fatal("censor dropped roster")
	}
	if err := json.Unmarshal(tbl.censoredGameFor(watcher, &snapshot), &censored); err != nil {
		t.Fatal(err)
	}
	if len(censored.Spectators) != 1 {
		t.Fatal("personalized fanout dropped roster")
	}
	seat(t, tbl, "watcher", 2, false)
	if got := tbl.spectators(tbl.game.GenerateOmniView()); len(got) != 0 {
		t.Fatalf("newly seated watcher remains: %+v", got)
	}
}

func TestSpectatorRosterDropsDepartedConnectionsAndIsSorted(t *testing.T) {
	tbl, _ := newTestTable(t)
	a := &Client{accountUUID: "a", username: "Amy"}
	b := &Client{accountUUID: "b", username: "Bob"}
	tbl.registerClient(b)
	tbl.registerClient(a)
	first := tbl.spectators(tbl.game.GenerateOmniView())
	if len(first) != 2 || first[0].Username != "Amy" {
		t.Fatalf("wrong order: %+v", first)
	}
	// Detach exactly as the membership portion of unregisterClient does;
	// no Redis or voice transport is needed to exercise the roster snapshot.
	tbl.clientsMu.Lock()
	delete(tbl.clients, a)
	tbl.clientsMu.Unlock()
	next := tbl.spectators(tbl.game.GenerateOmniView())
	if len(next) != 1 || next[0].Username != "Bob" {
		t.Fatalf("departure not reflected: %+v", next)
	}
	if len(first) != 2 || first[0].Username != "Amy" {
		t.Fatal("previous snapshot mutated")
	}
}
