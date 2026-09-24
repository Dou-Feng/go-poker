package poker

import "testing"

func TestButtonAdvancesAfterBustAndRebuy(t *testing.T) {
	g := sitDown(t, 100, 300)
	g.players[0].Cards = cards("Ks", "Kh")
	g.players[1].Cards = cards("As", "Ah")
	shove(t, g, 0)
	call(t, g, 1)
	showdown(t, g, dryBoard)
	if err := BuyIn(g, 0, 100); err != nil {
		t.Fatal(err)
	}
	for i := range g.players {
		if err := ToggleReady(g, uint(i), 0); err != nil {
			t.Fatal(err)
		}
	}
	if err := g.Start(); err != nil {
		t.Fatal(err)
	}
	if g.dealerNum != 1 {
		t.Fatalf("next hand repeats dealer %d and BB %d; want dealer 1 and BB 0", g.dealerNum, g.bbNum)
	}
}

func TestPostflopRaisesDoNotCountAsThreeBets(t *testing.T) {
	g := sitDown(t, 100, 100)
	call(t, g, 0)
	call(t, g, 1)
	for street := 0; street < 3; street++ {
		if err := Bet(g, 1, 2); err != nil {
			t.Fatal(err)
		}
		if err := Bet(g, 0, 4); err != nil {
			t.Fatal(err)
		}
		call(t, g, 1)
	}
	if g.players[0].Stats.ThreeBets != 0 {
		t.Fatalf("no preflop raise, yet ThreeBets=%d for HandsPlayed=%d (UI shows 300%%)", g.players[0].Stats.ThreeBets, g.players[0].Stats.HandsPlayed)
	}
}

func TestThreeBetOpportunitiesIncludeCallsAndFolds(t *testing.T) {
	g := sitDown(t, 100, 100, 100, 100)
	if err := Bet(g, 3, 6); err != nil {
		t.Fatal(err)
	}
	call(t, g, 0)
	if err := Fold(g, 1, 0); err != nil {
		t.Fatal(err)
	}
	if err := Bet(g, 2, 16); err != nil {
		t.Fatal(err)
	} // BB raises to 18
	call(t, g, 3)
	call(t, g, 0)
	for pn, p := range g.players {
		wantOpportunity, wantThreeBet := uint(1), uint(0)
		if pn == 3 {
			wantOpportunity = 0
		} // opener faces a 3-bet, not an open
		if pn == 2 {
			wantThreeBet = 1
		}
		if p.Stats.ThreeBetOpportunities != wantOpportunity || p.Stats.ThreeBets != wantThreeBet {
			t.Fatalf("player %d stats = %+v", pn, p.Stats)
		}
	}
}

func TestShortCallerHasNoThreeBetOpportunity(t *testing.T) {
	g := sitDown(t, 100, 5, 100)
	if err := Bet(g, 0, 6); err != nil {
		t.Fatal(err)
	}
	call(t, g, 1)
	call(t, g, 2)
	if g.players[1].Stats.ThreeBetOpportunities != 0 || g.players[2].Stats.ThreeBetOpportunities != 1 {
		t.Fatal("short all-in caller counted as able to raise")
	}
}

// A departing player folded by the engine (disconnect, timeout, sit-out)
// still faced the open they left on: the opportunity must reach their stats
// or their lifetime 3-bet rate loses its denominator.
func TestDepartureFoldsRecordThreeBetOpportunity(t *testing.T) {
	// On their own turn: LeaveHand folds immediately.
	g := sitDown(t, 100, 100, 100)
	if err := Bet(g, 0, 6); err != nil {
		t.Fatal(err)
	} // UTG opens
	if err := LeaveHand(g, 1); err != nil {
		t.Fatal(err)
	}
	if g.players[1].Stats.ThreeBetOpportunities != 1 || g.players[1].Stats.Folds != 1 {
		t.Fatalf("on-turn departure missed the 3-bet opportunity: %+v", g.players[1].Stats)
	}

	// Not on their turn: the fold lands with the next action instead.
	g = sitDown(t, 100, 100, 100)
	if err := Bet(g, 0, 6); err != nil {
		t.Fatal(err)
	}
	if err := LeaveHand(g, 2); err != nil {
		t.Fatal(err)
	} // BB departs, action is still on 1
	if err := Fold(g, 1, 0); err != nil {
		t.Fatal(err)
	}
	if g.players[2].Stats.ThreeBetOpportunities != 1 || g.players[2].Stats.Folds != 1 {
		t.Fatalf("deferred departure fold missed the 3-bet opportunity: %+v", g.players[2].Stats)
	}

	// SitOut folds regardless of turn.
	g = sitDown(t, 100, 100, 100)
	if err := Bet(g, 0, 6); err != nil {
		t.Fatal(err)
	}
	if err := SitOut(g, 1, 0); err != nil {
		t.Fatal(err)
	}
	if g.players[1].Stats.ThreeBetOpportunities != 1 {
		t.Fatalf("sit-out missed the 3-bet opportunity: %+v", g.players[1].Stats)
	}
}

func TestButtonAdvancesPastDepartedSeatBeforeCompaction(t *testing.T) {
	for _, departing := range []uint{0, 1, 2} {
		g := sitDown(t, 100, 100, 100, 100)
		want := g.players[1].UUID
		if departing == 1 {
			want = g.players[2].UUID
		}
		if err := LeaveHand(g, departing); err != nil {
			t.Fatal(err)
		}
		for g.getStage() != Showdown {
			if err := Fold(g, g.actionNum, 0); err != nil {
				t.Fatal(err)
			}
		}
		if err := SettleShowdown(g); err != nil {
			t.Fatal(err)
		}
		if g.players[g.dealerNum].UUID != want {
			t.Fatalf("departing %d: button did not move to next remaining seat", departing)
		}
		for i := range g.players {
			if err := ToggleReady(g, uint(i), 0); err != nil {
				t.Fatal(err)
			}
		}
		if err := g.Start(); err != nil {
			t.Fatal(err)
		}
		if g.players[g.dealerNum].UUID != want {
			t.Fatal("readying moved the button again")
		}
	}
}
