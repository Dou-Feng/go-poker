package poker

import (
	"testing"

	. "github.com/alexclewontin/riverboat/eval"
)

// A short stack must be able to call all-in for less than the full amount
// needed to call, instead of getting stuck with no legal action.
func TestAllInCallForLessThanFullAmount(t *testing.T) {
	g := NewGame()
	Configure(g, 1, 2, 100, 100, 6, 0)

	a := g.AddPlayer()
	b := g.AddPlayer()
	c := g.AddPlayer()

	for _, pn := range []uint{a, b, c} {
		if err := BuyIn(g, pn, 100); err != nil {
			t.Fatalf("buyin %d: %v", pn, err)
		}
		if err := ToggleReady(g, pn, 0); err != nil {
			t.Fatalf("ready %d: %v", pn, err)
		}
	}
	if err := Deal(g, a, 0); err != nil {
		t.Fatalf("deal: %v", err)
	}

	// a (UTG/dealer) bets 100, going all-in.
	if err := Bet(g, a, 100); err != nil {
		t.Fatalf("a bet: %v", err)
	}

	// b has posted the 1-chip small blind; give b only 5 chips left.
	g.players[b].Stack = 5
	g.players[b].Bet = 1
	g.players[b].TotalBet = 1

	// b must be allowed to call all-in for 5, even though the full call is 99.
	if err := Bet(g, b, 5); err != nil {
		t.Fatalf("short stack should be able to call all-in, got: %v", err)
	}

	if g.players[b].Stack != 0 {
		t.Fatalf("b should be all-in, stack=%d", g.players[b].Stack)
	}
	// The action must move on to c, not stall on the now all-in b.
	view := g.GenerateOmniView()
	if view.ActionNum != c {
		t.Fatalf("action should advance to c, got %d", view.ActionNum)
	}
}

// Side pots are split correctly: the short all-in player only contests the main
// pot, while the side pot is contested by the remaining players.
func TestSidePotShowdownAwards(t *testing.T) {
	g := NewGame()
	Configure(g, 1, 2, 200, 400, 3, 0)

	a := g.AddPlayer()
	b := g.AddPlayer()
	c := g.AddPlayer()

	// a: aces (wins the main pot). b: kings (wins the side pot). c: queens.
	g.players[a].Cards = [2]Card{MustParseCardString("As"), MustParseCardString("Ah")}
	g.players[b].Cards = [2]Card{MustParseCardString("Ks"), MustParseCardString("Kh")}
	g.players[c].Cards = [2]Card{MustParseCardString("Qs"), MustParseCardString("Qh")}

	g.communityCards = []Card{
		MustParseCardString("2c"),
		MustParseCardString("3d"),
		MustParseCardString("7h"),
		MustParseCardString("8s"),
		MustParseCardString("9d"),
	}

	// a is all-in for 50; b and c each committed 100 and have called.
	g.players[a].In = true
	g.players[b].In = true
	g.players[c].In = true
	g.players[a].TotalBet = 50
	g.players[b].TotalBet = 100
	g.players[c].TotalBet = 100
	g.players[a].Stack = 0
	g.players[b].Stack = 100
	g.players[c].Stack = 100
	g.players[b].Called = true
	g.players[c].Called = true

	g.setStageAndBetting(River, true)
	g.updateRoundInfo()

	if g.players[a].Stack != 150 {
		t.Fatalf("a should win the 150 main pot, stack=%d", g.players[a].Stack)
	}
	if g.players[b].Stack != 200 {
		t.Fatalf("b should win the 100 side pot, stack=%d", g.players[b].Stack)
	}
	if g.players[c].Stack != 100 {
		t.Fatalf("c should win nothing, stack=%d", g.players[c].Stack)
	}
	if g.players[a].Stats.HandsWon != 1 {
		t.Fatalf("a should have 1 hand won, got %d", g.players[a].Stats.HandsWon)
	}
	if g.players[b].Stats.HandsWon != 1 {
		t.Fatalf("b should have 1 hand won, got %d", g.players[b].Stats.HandsWon)
	}
}

// ShowHand must propagate the revealed flag into the serialized view so other
// clients can render the player's hole cards.
func TestShowHandRevealsInView(t *testing.T) {
	g := NewGame()
	Configure(g, 1, 2, 100, 100, 6, 0)

	a := g.AddPlayer()
	b := g.AddPlayer()
	c := g.AddPlayer()

	for _, pn := range []uint{a, b, c} {
		if err := BuyIn(g, pn, 100); err != nil {
			t.Fatalf("buyin: %v", err)
		}
		if err := ToggleReady(g, pn, 0); err != nil {
			t.Fatalf("ready: %v", err)
		}
	}
	if err := Deal(g, a, 0); err != nil {
		t.Fatalf("deal: %v", err)
	}

	if err := ShowHand(g, a, 0); err != nil {
		t.Fatalf("show hand: %v", err)
	}

	view := g.GenerateOmniView()
	if !view.Players[a].Revealed {
		t.Fatalf("player a should be revealed in the view")
	}
	if view.Players[a].Cards[0] == 0 {
		t.Fatalf("revealed player should still have cards")
	}
}

// When a big stack goes all-in and shorter stacks call, the hand must run out
// the board automatically instead of leaving the table stuck on an all-in
// player who cannot act.
func TestAllInRunoutToShowdown(t *testing.T) {
	g := NewGame()
	Configure(g, 1, 2, 1000, 2000, 3, 0)

	a := g.AddPlayer()
	b := g.AddPlayer()
	c := g.AddPlayer()

	BuyIn(g, a, 1000)
	BuyIn(g, b, 100)
	BuyIn(g, c, 1000)
	for _, pn := range []uint{a, b, c} {
		if err := ToggleReady(g, pn, 0); err != nil {
			t.Fatalf("ready: %v", err)
		}
	}
	if err := Deal(g, a, 0); err != nil {
		t.Fatalf("deal: %v", err)
	}

	// a (big stack) shoves, b (short) calls all-in, c calls all-in.
	if err := Bet(g, a, 1000); err != nil {
		t.Fatalf("a shove: %v", err)
	}
	if err := Bet(g, b, 99); err != nil { // b posted 1 SB, 99 left
		t.Fatalf("b call: %v", err)
	}
	if err := Bet(g, c, 998); err != nil { // c posted 2 BB, 998 left
		t.Fatalf("c call: %v", err)
	}

	// Betting must stop and the board reveal must be driven one card at a time.
	if g.getBetting() {
		t.Fatalf("betting should be off after everyone is all-in")
	}

	// Drive the runout until the showdown resolves and the game returns to
	// PreDeal. Cards must be revealed one at a time.
	revealedCards := 0
	for g.getStage() != PreDeal {
		if err := RunoutNext(g); err != nil {
			t.Fatalf("runout: %v", err)
		}
		if g.getStage() != PreDeal {
			revealedCards++
		}
	}
	if revealedCards != 5 {
		t.Fatalf("expected 5 cards revealed one at a time, got %d", revealedCards)
	}

	total := g.players[a].Stack + g.players[b].Stack + g.players[c].Stack
	if total != 2100 {
		t.Fatalf("chips should be conserved (2100), got %d", total)
	}
}
