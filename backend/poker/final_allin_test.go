package poker

import (
	"fmt"
	"testing"
)

func TestFinalHandFourWayAllInCompletes(t *testing.T) {
	for _, stacks := range [][]uint{{200, 200, 200, 200}, {100, 200, 300, 400}, {400, 300, 200, 100}, {351, 143, 543, 269}, {1, 2, 3, 400}, {2, 1, 400, 3}, {1, 1, 1, 1}, {100, 1, 1, 1}} {
		for _, street := range []GameStage{PreFlop, Flop, Turn, River} {
			t.Run(fmt.Sprintf("%v/street-%d", stacks, street), func(t *testing.T) {
				g := sitDown(t, stacks...)
				g.config.HandsLimit = 20
				g.handsPlayed = 19
				for steps := 0; g.getStage() != street; steps++ {
					if !g.getBetting() {
						break
					}
					if steps > 16 {
						t.Fatal("cannot reach requested street")
					}
					call(t, g, g.actionNum)
				}
				for steps := 0; g.getBetting(); steps++ {
					if steps > 4 {
						t.Fatal("all-ins failed to end betting")
					}
					shove(t, g, g.actionNum)
				}
				for steps := 0; g.getStage() != Showdown; steps++ {
					if steps > 4 {
						t.Fatalf("runout stuck at %v", g.getStage())
					}
					if err := RunoutNext(g); err != nil {
						t.Fatal(err)
					}
				}
				var initial uint
				for _, stack := range stacks {
					initial += stack
				}
				if totalChips(g) != initial {
					t.Fatalf("lost chips: %d != %d", totalChips(g), initial)
				}
				if err := SettleShowdown(g); err != nil {
					t.Fatal(err)
				}
				if g.getStage() != NotReady || g.handsPlayed != 20 {
					t.Fatalf("final hand not finished: stage=%d hands=%d", g.getStage(), g.handsPlayed)
				}
			})
		}
	}
}

// A folded raise still matches part of an all-in. Refunding down to only
// the surviving short stack leaves the refunded player below that raise;
// RunoutNext then waits for a call on the river with betting disabled.
func TestAllInRunoutWithFoldedRaise(t *testing.T) {
	g := sitDown(t, 200, 200, 400, 50)
	g.config.HandsLimit = 20
	g.handsPlayed = 19
	g.players[2].Cards = cards("Kc", "Kh")
	g.players[3].Cards = cards("Ac", "Ah")
	shove(t, g, 3)
	call(t, g, 0)
	// Raise to 100 including the small blind.
	if err := Bet(g, 1, 99); err != nil {
		t.Fatal(err)
	}
	shove(t, g, 2)
	for _, pn := range []uint{0, 1} {
		if err := Fold(g, pn, 0); err != nil {
			t.Fatal(err)
		}
	}
	if g.getBetting() {
		t.Fatal("all-in runout must disable betting")
	}
	copy(g.communityCards, dryBoard)
	g.setStage(River)
	if err := RunoutNext(g); err != nil {
		t.Fatal(err)
	}
	if g.getStage() != Showdown {
		t.Fatalf("river did not advance: stage=%d betting=%v", g.getStage(), g.getBetting())
	}
	// 200 main pot to the aces; 100 side pot to kings, including the folded
	// raise. Only 300 of the big stack's original 400 can be refunded.
	expectStacks(t, g, 150, 100, 400, 200)
	if len(g.pots) != 2 || g.pots[0].Amt != 200 || g.pots[1].Amt != 100 {
		t.Fatalf("wrong pots: %+v", g.pots)
	}
	if err := SettleShowdown(g); err != nil {
		t.Fatal(err)
	}
	if g.handsPlayed != 20 || g.getStage() != NotReady {
		t.Fatal("final hand did not finish")
	}
}
