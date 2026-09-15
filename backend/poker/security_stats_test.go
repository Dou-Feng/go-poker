package poker

import (
	"errors"
	"testing"
)

func TestSetSeatIDRejectsInvalidSeatWithoutPanic(t *testing.T) {
	g := NewGame()
	Configure(g, 1, 2, 100, 200, 6, 0)
	pn := g.AddPlayer()

	for _, seatID := range []uint{0, 7} {
		if err := SetSeatID(g, pn, seatID); !errors.Is(err, ErrInvalidPosition) {
			t.Fatalf("seat %d: got %v, want ErrInvalidPosition", seatID, err)
		}
	}
}

func TestBlindAllInsEndPreflopBetting(t *testing.T) {
	g := sitDown(t, 1, 2)
	view := g.GenerateOmniView()
	if view.Stage != PreFlop {
		t.Fatalf("stage = %v, want PreFlop", view.Stage)
	}
	if view.Betting {
		t.Fatalf("betting must end when both blinds are all-in")
	}
	if err := RunoutNext(g); err != nil {
		t.Fatalf("all-in hand should be able to run out: %v", err)
	}
}

func TestVPIPCountsAtMostOncePerHand(t *testing.T) {
	g := sitDown(t, 200, 200)

	// Heads-up: player 0 completes the blind, player 1 raises, player 0 calls.
	call(t, g, 0)
	if err := Bet(g, 1, 8); err != nil {
		t.Fatalf("raise: %v", err)
	}
	call(t, g, 0)

	stats := g.players[0].Stats
	if stats.HandsPlayed != 1 || stats.VPIP != 1 {
		t.Fatalf("hands/vpip = %d/%d, want 1/1", stats.HandsPlayed, stats.VPIP)
	}
	var handsAtPosition, vpipAtPosition uint
	for i := range stats.HandsByPos {
		handsAtPosition += stats.HandsByPos[i]
		vpipAtPosition += stats.VPIPByPos[i]
	}
	if handsAtPosition != 1 || vpipAtPosition != 1 {
		t.Fatalf("position hands/vpip = %d/%d, want 1/1", handsAtPosition, vpipAtPosition)
	}
}

func TestWinningMultiplePotsCountsAsOneHandWin(t *testing.T) {
	g := sitDown(t, 50, 100, 200)
	g.players[0].Cards = cards("Qs", "Qh")
	g.players[1].Cards = cards("Ks", "Kh")
	g.players[2].Cards = cards("As", "Ah")

	shove(t, g, 0)
	shove(t, g, 1)
	call(t, g, 2)
	if len(g.pots) < 2 {
		t.Fatalf("fixture should create multiple pots, got %+v", g.pots)
	}
	showdown(t, g, dryBoard)

	if got := g.players[2].Stats.HandsWon; got != 1 {
		t.Fatalf("winning multiple pots counted as %d hand wins, want 1", got)
	}
}
