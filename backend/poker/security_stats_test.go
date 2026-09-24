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
	if handsAtPosition != 0 || vpipAtPosition != 0 {
		t.Fatalf("heads-up position hands/vpip = %d/%d, want 0/0", handsAtPosition, vpipAtPosition)
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

func TestUTGVPIPCountsOneHandAcrossReraise(t *testing.T) {
	g := sitDown(t, 200, 200, 200, 200, 200, 200)
	if err := Bet(g, 3, 4); err != nil {
		t.Fatal(err)
	}
	if err := Bet(g, 4, 8); err != nil {
		t.Fatal(err)
	}
	for _, pn := range []uint{5, 0, 1, 2, 3} {
		call(t, g, pn)
	}
	stats := g.players[3].Stats
	if stats.HandsByPos[PosUTG] != 1 || stats.VPIPByPos[PosUTG] != 1 || !stats.ValidPositionStats() {
		t.Fatalf("UTG must record one hand and one VPIP, got %+v", stats)
	}
}

func TestVPIPKeepsDealtPositionWhenFoldedButtonLeaves(t *testing.T) {
	g := sitDown(t, 200, 200, 200, 200, 200, 200)
	for _, pn := range []uint{3, 4, 5} {
		call(t, g, pn)
	}
	if err := Fold(g, 0, 0); err != nil {
		t.Fatal(err)
	}
	if err := LeaveHand(g, 0); err != nil {
		t.Fatal(err)
	}
	// The departure moves the button bookkeeping to player 1, who was dealt SB.
	if g.dealerNum != 1 {
		t.Fatal("fixture must move the button")
	}
	call(t, g, 1)
	stats := g.players[1].Stats
	if stats.HandsByPos[PosSB] != 1 || stats.VPIPByPos[PosSB] != 1 || stats.VPIPByPos[PosBTN] != 0 {
		t.Fatalf("VPIP moved away from the hand's dealt position: %+v", stats)
	}
}

func TestPositionStatsRequireFiveDealtPlayers(t *testing.T) {
	for n := 2; n <= 8; n++ {
		stacks := make([]uint, n)
		for i := range stacks {
			stacks[i] = 200
		}
		g := sitDown(t, stacks...)
		actor := g.actionNum
		call(t, g, actor)
		for i, p := range g.players {
			var hands, vpip uint
			for pos := range p.Stats.HandsByPos {
				hands += p.Stats.HandsByPos[pos]
				vpip += p.Stats.VPIPByPos[pos]
			}
			var wantHands, wantVPIP uint
			if n >= 5 {
				wantHands = 1
				if uint(i) == actor {
					wantVPIP = 1
				}
			}
			if hands != wantHands || vpip != wantVPIP || p.Stats.HandsPlayed != 1 {
				t.Fatalf("%d players, seat %d: %+v", n, i, p.Stats)
			}
			if uint(i) == actor && p.Stats.VPIP != 1 {
				t.Fatalf("%d players: total VPIP was not counted", n)
			}
		}
	}
}

func TestPositionSampleIgnoresUndealtSeats(t *testing.T) {
	g := NewGame()
	Configure(g, 1, 2, 200, 400, 8, 0)
	for i := 0; i < 6; i++ {
		pn := g.AddPlayer()
		if err := BuyIn(g, pn, 200); err != nil {
			t.Fatal(err)
		}
		if i < 4 {
			if err := ToggleReady(g, pn, 0); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := Deal(g, 0, 0); err != nil {
		t.Fatal(err)
	}
	call(t, g, g.actionNum)
	for _, p := range g.players {
		if p.Stats.HandsByPos != [PosLabelCount]uint{} || p.Stats.VPIPByPos != [PosLabelCount]uint{} {
			t.Fatal("unready seats or room capacity inflated the participant count")
		}
	}
}

func TestFivePlayerHandKeepsPositionEligibilityAfterFolds(t *testing.T) {
	g := sitDown(t, 200, 200, 200, 200, 200)
	for _, pn := range []uint{3, 4} {
		if err := Fold(g, pn, 0); err != nil {
			t.Fatal(err)
		}
	}
	call(t, g, 0) // Three remain, but the hand started with five.
	stats := g.players[0].Stats
	if stats.HandsByPos[PosBTN] != 1 || stats.VPIPByPos[PosBTN] != 1 {
		t.Fatalf("folds incorrectly removed position eligibility: %+v", stats)
	}
}
