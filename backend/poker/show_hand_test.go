package poker

import (
	"reflect"
	"testing"
)

func TestShowHandRequiresAtMostOnePlayerAbleToAct(t *testing.T) {
	g := sitDown(t, 200, 200, 200)
	pn := g.actionNum

	assertRejected := func(pn uint) {
		t.Helper()
		before := g.GenerateOmniView()
		if err := ShowHand(g, pn, 0); err == nil {
			t.Fatal("ineligible player was allowed to show")
		}
		if !reflect.DeepEqual(before, g.GenerateOmniView()) {
			t.Fatal("rejected reveal changed the game")
		}
	}
	assertRejected(pn) // Not all-in.
	assertRejected(uint(len(g.players)))
	shove(t, g, pn)
	assertRejected(pn) // All-in, but two opponents can still act.
	folder := g.actionNum
	if err := Fold(g, folder, 0); err != nil {
		t.Fatal(err)
	}
	assertRejected(folder)
	assertRejected(g.actionNum) // The remaining opponent has not gone all-in.
	if err := ShowHand(g, pn, 0); err != nil {
		t.Fatalf("all-in player cannot show with only two remaining: %v", err)
	}
	spec := g.GenerateOmniView().CensorFor(uint(len(g.players)))
	if cardsHidden(spec, pn) || !cardsHidden(spec, folder) || !cardsHidden(spec, g.actionNum) {
		t.Fatal("voluntary reveal must expose only the eligible player's cards")
	}
}

func TestShowHandAllowedDuringMultiwayRunout(t *testing.T) {
	g := sitDown(t, 200, 200, 200)
	shove(t, g, g.actionNum)
	call(t, g, g.actionNum)
	call(t, g, g.actionNum)
	if err := ShowHand(g, 0, 0); err != nil {
		t.Fatalf("all players all-in must allow voluntary reveal: %v", err)
	}
	// The other players do not reveal voluntarily; showdown must still
	// expose their cards automatically.
	for steps := 0; g.getStage() != Showdown && steps < 5; steps++ {
		if err := RunoutNext(g); err != nil {
			t.Fatal(err)
		}
	}
	if g.getStage() != Showdown {
		t.Fatal("runout did not reach showdown")
	}
	spec := g.GenerateOmniView().CensorFor(uint(len(g.players)))
	for pn := range g.players {
		if cardsHidden(spec, uint(pn)) {
			t.Fatal("normal multiway showdown must still reveal participants")
		}
	}
}

func TestShowHandFourPlayersWithTwoAlreadyAllIn(t *testing.T) {
	g := sitDown(t, 200, 200, 200, 200)
	first := g.actionNum
	shove(t, g, first)
	second := g.actionNum
	call(t, g, second)
	// Two players are all-in; two still have chips and can act.
	for _, pn := range []uint{first, second} {
		before := g.GenerateOmniView()
		if err := ShowHand(g, pn, 0); err != ErrIllegalAction {
			t.Fatalf("two opponents can act; reveal should be rejected: %v", err)
		}
		if !reflect.DeepEqual(before, g.GenerateOmniView()) {
			t.Fatal("rejected reveal changed the game")
		}
	}
	third := g.actionNum
	call(t, g, third) // The third player calls all-in; only one can act now.
	for _, pn := range []uint{first, second, third} {
		if err := ShowHand(g, pn, 0); err != nil {
			t.Fatalf("player %d cannot reveal with only one opponent able to act: %v", pn, err)
		}
	}
	if err := ShowHand(g, g.actionNum, 0); err != ErrIllegalAction {
		t.Fatalf("the player with chips must not reveal before going all-in: %v", err)
	}
}

func TestShowHandAfterUncontestedWin(t *testing.T) {
	g := sitDown(t, 200, 200)
	folder := g.actionNum
	winner := (folder + 1) % 2
	if err := Fold(g, folder, 0); err != nil {
		t.Fatal(err)
	}
	if err := ShowHand(g, winner, 0); err != nil {
		t.Fatalf("uncontested winner cannot show at showdown: %v", err)
	}
	if err := SettleShowdown(g); err != nil {
		t.Fatal(err)
	}
	if err := ShowHand(g, winner, 0); err != ErrIllegalAction {
		t.Fatalf("reveal accepted between hands: %v", err)
	}
}
