package poker

import (
	"reflect"
	"testing"
)

func TestFoldRejectsRepeatedOrInactiveActions(t *testing.T) {
	for _, phase := range []string{"waiting", "showdown", "runout", "already folded"} {
		t.Run(phase, func(t *testing.T) {
			g := sitDown(t, 200, 200)
			pn := g.actionNum
			switch phase {
			case "waiting":
				g = NewGame()
				pn = g.AddPlayer()
			case "showdown":
				if err := Fold(g, pn, 0); err != nil {
					t.Fatal(err)
				}
			case "runout":
				shove(t, g, pn)
				call(t, g, g.actionNum)
				pn = g.actionNum
			case "already folded":
				g.players[pn].In = false
			}
			before := g.GenerateOmniView()
			if err := Fold(g, pn, 0); err == nil {
				t.Fatal("inactive fold accepted")
			}
			if !reflect.DeepEqual(before, g.GenerateOmniView()) {
				t.Fatal("rejected fold changed state or paid the pot")
			}
		})
	}
}

func TestOversizedBetRejectedWithoutMutation(t *testing.T) {
	for _, amount := range []uint{101, 1000000, ^uint(0)} {
		g := sitDown(t, 100, 1000, 1000)
		before := g.GenerateOmniView()
		if err := Bet(g, 0, amount); err == nil {
			t.Fatalf("accepted bet %d larger than stack", amount)
		}
		if !reflect.DeepEqual(before, g.GenerateOmniView()) {
			t.Fatal("oversized bet changed raise rights, pot or stats")
		}
		if err := Bet(g, 0, 100); err != nil {
			t.Fatal(err)
		}
		if g.minRaise != 98 {
			t.Fatalf("minRaise=%d, want 98", g.minRaise)
		}
		if err := Bet(g, 1, 197); err != nil {
			t.Fatalf("legal minimum raise rejected: %v", err)
		}
	}
}

func TestFoldedPlayerCannotUnreadyOrMoveDuringHand(t *testing.T) {
	g := sitDown(t, 200, 200, 200)
	if err := Fold(g, 0, 0); err != nil {
		t.Fatal(err)
	}
	before := g.GenerateOmniView()
	if err := ToggleReady(g, 0, 0); err == nil {
		t.Fatal("unready accepted during hand")
	}
	if err := SetSeatID(g, 0, 3); err == nil {
		t.Fatal("seat move accepted during hand")
	}
	if !reflect.DeepEqual(before, g.GenerateOmniView()) {
		t.Fatal("hand changed after rejected requests")
	}
}
