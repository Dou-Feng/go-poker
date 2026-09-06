package server

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/evanofslack/go-poker/poker"
)

// Tests for the per-turn action clock (clock.go).

// clockRoom is a heads-up table (acc-a seat 1, acc-b seat 2, both ready) with
// the given action clock, its broadcasts drained, and the first hand started.
func clockRoom(t *testing.T, timeout time.Duration) *table {
	t.Helper()
	tbl, _ := newTestTable(t)
	drainBroadcasts(t, tbl)
	tbl.clock.timeout = timeout
	seat(t, tbl, "acc-a", 1, true)
	seat(t, tbl, "acc-b", 2, true)
	if !autoStartIfReady(tbl) {
		t.Fatalf("both ready: the hand must start")
	}
	tbl.broadcastGame() // arms the clock for the first turn
	return tbl
}

// A player who lets the clock run out is folded when they face a bet (the
// small blind preflop, heads-up) and checked when they do not.
func TestActionClockChecksOrFolds(t *testing.T) {
	tbl := clockRoom(t, 40*time.Millisecond)
	view := tbl.game.GenerateOmniView()
	pn := view.ActionNum
	actor := view.Players[pn]
	maxBet := uint(0)
	for _, p := range view.Players {
		if p.Bet > maxBet {
			maxBet = p.Bet
		}
	}
	if actor.Bet >= maxBet {
		t.Fatalf("fixture: the first player to act must be facing a bet")
	}

	waitFor(t, "timeout fold", func() bool {
		v := tbl.game.GenerateOmniView()
		return v.Stage == poker.Showdown
	})
	if v := tbl.game.GenerateOmniView(); v.Players[pn].In {
		t.Fatalf("the player on the clock must have folded")
	}

	// Next hand: the first actor calls, the other player is now to act and can
	// check; the clock checks for them instead of folding.
	stub := &Client{table: tbl, send: make(chan []byte, 8)} // acts for whoever is on
	handleDealGame(stub)
	view = tbl.game.GenerateOmniView()
	if !view.Running {
		t.Fatalf("next hand must be running (both still ready)")
	}
	first := view.ActionNum
	handleCall(stub)
	view = tbl.game.GenerateOmniView()
	second := view.ActionNum
	if second == first {
		t.Fatalf("action must move to the other player")
	}
	stage := view.Stage
	waitFor(t, "timeout check", func() bool {
		v := tbl.game.GenerateOmniView()
		return v.Stage != stage || v.ActionNum != second
	})
	v := tbl.game.GenerateOmniView()
	if !v.Players[second].In {
		t.Fatalf("a player who could check must not be folded by the clock")
	}
}

// Rebroadcasts within the same turn keep the deadline; a new turn gets a fresh
// one; no turn clears it. The update-game message carries the clock.
func TestActionClockFollowsTurns(t *testing.T) {
	tbl := clockRoom(t, time.Hour)
	_, left1 := tbl.actionClockState()
	if left1 <= 0 {
		t.Fatalf("clock must be running on the first turn")
	}
	time.Sleep(5 * time.Millisecond)
	tbl.broadcastGame()
	_, left2 := tbl.actionClockState()
	if left2 > left1 {
		t.Fatalf("a rebroadcast must not reset the deadline: %d -> %d", left1, left2)
	}

	var msg struct {
		ActionTimeout     int   `json:"actionTimeout"`
		ActionRemainingMs int64 `json:"actionRemainingMs"`
	}
	if err := json.Unmarshal(createUpdatedGameBytes(tbl), &msg); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if msg.ActionTimeout != 3600 || msg.ActionRemainingMs <= 0 || msg.ActionRemainingMs > left1 {
		t.Fatalf("update-game must carry the clock, got %+v", msg)
	}

	// The acting player acts: a new turn, fresh deadline.
	handleCall(&Client{table: tbl, send: make(chan []byte, 8)})
	_, left3 := tbl.actionClockState()
	if left3 <= left2 {
		t.Fatalf("a new turn must start a fresh clock: %d -> %d", left2, left3)
	}

	// Hand over (fold), nobody to act: the clock is cleared.
	view := tbl.game.GenerateOmniView()
	if err := poker.Fold(tbl.game, view.ActionNum, 0); err != nil {
		t.Fatalf("fold: %v", err)
	}
	tbl.broadcastGame()
	if sec, left := tbl.actionClockState(); sec != 3600 || left != 0 {
		t.Fatalf("no turn means no deadline, got %d/%d", sec, left)
	}
}

// A room without a clock never times anyone out, and the wire carries nothing.
func TestActionClockOffByDefault(t *testing.T) {
	tbl := clockRoom(t, 0)
	if sec, left := tbl.actionClockState(); sec != 0 || left != 0 {
		t.Fatalf("clock off must report zeros, got %d/%d", sec, left)
	}
	time.Sleep(30 * time.Millisecond)
	if v := tbl.game.GenerateOmniView(); v.Stage == poker.Showdown {
		t.Fatalf("nobody may be folded without a clock")
	}
	raw := createUpdatedGameBytes(tbl)
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if _, ok := m["actionTimeout"]; ok {
		t.Fatalf("clock fields must be omitted when off")
	}
	if normalizeActionTimeout(0) != 0 || normalizeActionTimeout(1) != minActionTimeout || normalizeActionTimeout(100000) != maxActionTimeout || normalizeActionTimeout(30) != 30*time.Second {
		t.Fatalf("normalizeActionTimeout bounds are wrong")
	}
}
