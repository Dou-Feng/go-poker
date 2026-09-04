package poker

import (
	"testing"

	. "github.com/alexclewontin/riverboat/eval"
)

// Regression: when every opponent has left the room (still seated but marked
// Left) and the last actor folds, no player is left In. updateRoundInfo must
// not index into an empty inPlayerNums slice; the hand settles as a forfeit
// into the Showdown state instead.
func TestAllOpponentsLeaveThenFoldNoPanic(t *testing.T) {
	g := NewGame()
	Configure(g, 1, 2, 100, 100, 3, 0)

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

	view := g.GenerateOmniView()
	act := view.ActionNum // UTG acts first

	// The two non-acting players leave while not on their turn: they stay In
	// with Left=true until the next evaluation folds them.
	for _, pn := range []uint{a, b, c} {
		if pn == act {
			continue
		}
		if err := LeaveHand(g, pn); err != nil {
			t.Fatalf("leave %d: %v", pn, err)
		}
	}

	// The acting player folds. Nobody is left in the hand.
	if err := Fold(g, act, 0); err != nil {
		t.Fatalf("fold: %v", err)
	}

	// The hand must have settled (forfeit) without panicking.
	view = g.GenerateOmniView()
	if view.Stage != Showdown {
		t.Fatalf("expected Showdown after everyone conceded, got stage %v", view.Stage)
	}
	// No player is awarded anything.
	for i := range view.Pots {
		if len(view.Pots[i].WinningPlayerNums) != 0 {
			t.Fatalf("pot %d should have no winners (forfeit), got %v", i, view.Pots[i].WinningPlayerNums)
		}
	}

	// And the table settles forward without panicking.
	if err := SettleShowdown(g); err != nil {
		t.Fatalf("settle showdown: %v", err)
	}
}

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
	if g.getStage() == Showdown {
		if err := SettleShowdown(g); err != nil {
			t.Fatalf("settle showdown: %v", err)
		}
	}

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

	// Drive the runout until the board is complete. The flop is revealed all
	// at once, then the turn and river. Dealing the river enters the Showdown
	// state (cards + hand types displayed); settleShowdown() advances to the
	// next hand.
	revealedCards := 0
	for g.getStage() != Showdown {
		if err := RunoutNext(g); err != nil {
			t.Fatalf("runout: %v", err)
		}
		if g.getStage() != Showdown {
			revealedCards++
		}
	}
	if revealedCards != 3 {
		t.Fatalf("expected 3 reveal steps (flop, turn, river), got %d", revealedCards)
	}
	if g.pots[0].WinningPlayerNums == nil {
		t.Fatalf("pots should be decided when the showdown state is entered")
	}

	// Ending the showdown display advances the table to the next hand.
	if err := SettleShowdown(g); err != nil {
		t.Fatalf("settle showdown: %v", err)
	}
	if g.getStage() != NotReady {
		t.Fatalf("stage after settle = %v, want NotReady", g.getStage())
	}

	total := g.players[a].Stack + g.players[b].Stack + g.players[c].Stack
	if total != 2100 {
		t.Fatalf("chips should be conserved (2100), got %d", total)
	}
}

// A player who folds stays seated and readied for the next hand: only the
// current hand is abandoned. This matters for heads-up — when A folds, B takes
// the pot and the room should auto-start the next hand without A having to
// click ready again.
func TestFoldKeepsReadyForNextHand(t *testing.T) {
	g := NewGame()
	Configure(g, 1, 2, 100, 100, 2, 0)

	a := g.AddPlayer()
	b := g.AddPlayer()

	for _, pn := range []uint{a, b} {
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

	// In heads-up the dealer (a) is SB and acts first preflop. A folds.
	if err := Fold(g, a, 0); err != nil {
		t.Fatalf("fold: %v", err)
	}

	view := g.GenerateOmniView()
	if view.Stage != Showdown {
		t.Fatalf("expected Showdown after heads-up fold, got stage %v", view.Stage)
	}
	// The folder stays seated, readied for the next hand.
	if !view.Players[a].Ready {
		t.Fatalf("folder a should still be ready for the next hand")
	}
	if view.Players[a].In {
		t.Fatalf("folder a should be out of the current hand")
	}
	// B takes the pot.
	if len(view.Pots) == 0 || len(view.Pots[0].WinningPlayerNums) != 1 || view.Pots[0].WinningPlayerNums[0] != 1 {
		t.Fatalf("b should win the pot, got %+v", view.Pots)
	}

	// Settling back to the ready phase keeps both players ready so the room
	// auto-starts the next hand.
	if err := SettleShowdown(g); err != nil {
		t.Fatalf("settle: %v", err)
	}
	if g.getStage() != NotReady {
		t.Fatalf("expected NotReady after settle, got %v", g.getStage())
	}
	view = g.GenerateOmniView()
	if !view.Players[a].Ready || !view.Players[b].Ready {
		t.Fatalf("both players should remain ready, a=%v b=%v", view.Players[a].Ready, view.Players[b].Ready)
	}
	// A new hand can be dealt immediately without re-readying anyone.
	if err := Deal(g, view.DealerNum, 0); err != nil {
		t.Fatalf("dealing the next hand should work without re-ready: %v", err)
	}
}

// A player who leaves on their own turn must be folded immediately so the hand
// advances instead of hanging.
func TestLeaveHandOnTurnFolds(t *testing.T) {
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

	view := g.GenerateOmniView()
	action := view.ActionNum

	// The player up to act leaves before acting.
	if err := LeaveHand(g, action); err != nil {
		t.Fatalf("leave on turn: %v", err)
	}

	if g.players[action].In {
		t.Fatalf("player %d should have folded", action)
	}
	if !g.players[action].Left {
		t.Fatalf("player %d should be marked left", action)
	}

	// The action must have moved to another player, not stalled on the leaver.
	after := g.GenerateOmniView()
	if after.ActionNum == action {
		t.Fatalf("action should have advanced, still on %d", action)
	}
}

// When the player up to act leaves a heads-up hand, the remaining player wins
// the pot, and the pot winner positions must be remapped after the leaver is
// dropped so the client can resolve the settlement correctly.
func TestLeaveOnTurnHeadsUpSettlement(t *testing.T) {
	g := NewGame()
	Configure(g, 1, 2, 100, 100, 2, 0)

	a := g.AddPlayer()
	b := g.AddPlayer()

	for _, pn := range []uint{a, b} {
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

	// a is the dealer/UTG and up to act; a leaves.
	if err := LeaveHand(g, a); err != nil {
		t.Fatalf("leave: %v", err)
	}

	// The uncontested win must enter the Showdown state (stage 6) so the
	// winner toast can play; the leaver is still seated (greyed) until the
	// showdown display ends.
	view := g.GenerateOmniView()
	if view.Stage != Showdown {
		t.Fatalf("expected Showdown after uncontested win, got stage %v", view.Stage)
	}
	if len(view.Players) != 2 {
		t.Fatalf("expected both players seated during showdown, got %d", len(view.Players))
	}
	if len(view.Pots) == 0 || len(view.Pots[0].WinningPlayerNums) != 1 {
		t.Fatalf("expected a pot with a single winner")
	}

	// Ending the showdown display drops the leaver and remaps positions.
	if err := SettleShowdown(g); err != nil {
		t.Fatalf("settle showdown: %v", err)
	}
	view = g.GenerateOmniView()
	if len(view.Players) != 1 {
		t.Fatalf("expected 1 player remaining, got %d", len(view.Players))
	}
	// After dropping a, b moves to position 0; the pot must reference it.
	if view.Pots[0].WinningPlayerNums[0] != 0 {
		t.Fatalf("pot winner should be position 0, got %d", view.Pots[0].WinningPlayerNums[0])
	}
	// b started with 100, posted the big blind (2), then won the 3-chip pot.
	if view.Players[0].Stack != 101 {
		t.Fatalf("b should have 101 chips, got %d", view.Players[0].Stack)
	}
}

// A player who leaves while all-in is shown down rather than folded: they stay
// in the hand with their cards revealed. If they would have won, the pot is
// forfeited (the chips vanish) as a penalty for leaving.
func TestAllInLeaveForfeitsPot(t *testing.T) {
	g := NewGame()
	Configure(g, 1, 2, 100, 100, 2, 0)

	a := g.AddPlayer()
	b := g.AddPlayer()

	// b (the leaver) holds aces; a holds kings.
	g.players[b].Cards = [2]Card{MustParseCardString("As"), MustParseCardString("Ah")}
	g.players[a].Cards = [2]Card{MustParseCardString("Ks"), MustParseCardString("Kh")}
	g.communityCards = []Card{
		MustParseCardString("2c"),
		MustParseCardString("3d"),
		MustParseCardString("7h"),
		MustParseCardString("8s"),
		MustParseCardString("9d"),
	}

	// Both players are all-in and the board has been run out.
	g.players[a].In = true
	g.players[b].In = true
	g.players[a].Stack = 0
	g.players[b].Stack = 0
	g.players[a].TotalBet = 100
	g.players[b].TotalBet = 100
	g.players[a].Called = true
	g.players[b].Called = true
	g.setStageAndBetting(River, true)

	// b leaves while all-in: they stay in the hand and reveal, not folded.
	if err := LeaveHand(g, b); err != nil {
		t.Fatalf("leave: %v", err)
	}
	if !g.players[b].In {
		t.Fatalf("all-in leaver should stay in the hand")
	}
	if !g.players[b].Left || !g.players[b].Revealed {
		t.Fatalf("all-in leaver should be marked left and revealed")
	}

	g.updateRoundInfo()
	if g.getStage() == Showdown {
		if err := SettleShowdown(g); err != nil {
			t.Fatalf("settle showdown: %v", err)
		}
	}

	view := g.GenerateOmniView()
	// b (aces) beats a (kings): the pot is forfeited, nobody is awarded.
	if len(view.Pots) == 0 || view.Pots[0].Amt != 200 {
		t.Fatalf("expected a 200-chip pot, got %+v", view.Pots)
	}
	if len(view.Pots[0].WinningPlayerNums) != 0 {
		t.Fatalf("pot should have no winners (forfeit), got %v", view.Pots[0].WinningPlayerNums)
	}
	if len(view.Players) != 1 {
		t.Fatalf("expected 1 player remaining, got %d", len(view.Players))
	}
	if view.Players[0].Stack != 0 {
		t.Fatalf("a should not be awarded chips, got %d", view.Players[0].Stack)
	}
}

// When a player leaves while all-in but the opponent has the better hand, the
// opponent wins the pot normally.
func TestAllInLeaveOpponentWins(t *testing.T) {
	g := NewGame()
	Configure(g, 1, 2, 100, 100, 2, 0)

	a := g.AddPlayer()
	b := g.AddPlayer()

	// a (the opponent) holds aces; b (the leaver) holds kings.
	g.players[a].Cards = [2]Card{MustParseCardString("As"), MustParseCardString("Ah")}
	g.players[b].Cards = [2]Card{MustParseCardString("Ks"), MustParseCardString("Kh")}
	g.communityCards = []Card{
		MustParseCardString("2c"),
		MustParseCardString("3d"),
		MustParseCardString("7h"),
		MustParseCardString("8s"),
		MustParseCardString("9d"),
	}

	g.players[a].In = true
	g.players[b].In = true
	g.players[a].Stack = 0
	g.players[b].Stack = 0
	g.players[a].TotalBet = 100
	g.players[b].TotalBet = 100
	g.players[a].Called = true
	g.players[b].Called = true
	g.setStageAndBetting(River, true)

	if err := LeaveHand(g, b); err != nil {
		t.Fatalf("leave: %v", err)
	}

	g.updateRoundInfo()
	if g.getStage() == Showdown {
		if err := SettleShowdown(g); err != nil {
			t.Fatalf("settle showdown: %v", err)
		}
	}

	view := g.GenerateOmniView()
	if len(view.Pots) == 0 || len(view.Pots[0].WinningPlayerNums) != 1 || view.Pots[0].WinningPlayerNums[0] != 0 {
		t.Fatalf("a should win the pot, got %+v", view.Pots)
	}
	if len(view.Players) != 1 {
		t.Fatalf("expected 1 player remaining, got %d", len(view.Players))
	}
	if view.Players[0].Stack != 200 {
		t.Fatalf("a should win 200 chips, got %d", view.Players[0].Stack)
	}
}

// If everyone folds to a departed all-in player, they are the last one
// standing but cannot collect: the pot is forfeited instead of awarded.
func TestAllInLeaveOpponentFoldsForfeits(t *testing.T) {
	g := NewGame()
	Configure(g, 1, 2, 100, 100, 2, 0)

	a := g.AddPlayer()
	b := g.AddPlayer()

	// b is all-in for 100; a (posted the 2-chip big blind) faces the all-in.
	g.players[a].In = true
	g.players[b].In = true
	g.players[a].Stack = 98
	g.players[b].Stack = 0
	g.players[a].Bet = 2
	g.players[b].Bet = 100
	g.players[a].TotalBet = 2
	g.players[b].TotalBet = 100
	g.actionNum = a
	g.setStageAndBetting(PreFlop, true)

	if err := LeaveHand(g, b); err != nil {
		t.Fatalf("leave: %v", err)
	}
	if err := Fold(g, a, 0); err != nil {
		t.Fatalf("a fold: %v", err)
	}

	// The forfeit (nobody collects) must still enter the Showdown state so
	// the "chips forfeited" notice can display before the hand is settled.
	view := g.GenerateOmniView()
	if view.Stage != Showdown {
		t.Fatalf("expected Showdown after forfeit, got stage %v", view.Stage)
	}
	if len(view.Players) != 2 {
		t.Fatalf("expected both players seated during showdown, got %d", len(view.Players))
	}
	if len(view.Pots) == 0 || view.Pots[0].Amt != 102 {
		t.Fatalf("expected a 102-chip pot, got %+v", view.Pots)
	}
	if len(view.Pots[0].WinningPlayerNums) != 0 {
		t.Fatalf("pot should have no winners (forfeit), got %v", view.Pots[0].WinningPlayerNums)
	}

	// Ending the showdown display drops the departed all-in player.
	if err := SettleShowdown(g); err != nil {
		t.Fatalf("settle showdown: %v", err)
	}
	view = g.GenerateOmniView()
	if len(view.Players) != 1 {
		t.Fatalf("expected 1 player remaining, got %d", len(view.Players))
	}
	if view.Players[0].Stack != 98 {
		t.Fatalf("a should keep its uncalled 98 chips, got %d", view.Players[0].Stack)
	}
}

// Heads-up: a non-all-in player facing an all-in opponent leaves on their
// turn. They fold, so the all-in opponent wins the pot normally.
func TestHeadsUpLeaveFacingAllInOpponentFolds(t *testing.T) {
	g := NewGame()
	Configure(g, 1, 2, 100, 100, 2, 0)

	a := g.AddPlayer()
	b := g.AddPlayer()

	// a is all-in for 100; b (big blind) faces the all-in on their turn.
	g.players[a].In = true
	g.players[b].In = true
	g.players[a].Stack = 0
	g.players[b].Stack = 98
	g.players[a].Bet = 100
	g.players[b].Bet = 2
	g.players[a].TotalBet = 100
	g.players[b].TotalBet = 2
	g.actionNum = b
	g.setStageAndBetting(PreFlop, true)

	if err := LeaveHand(g, b); err != nil {
		t.Fatalf("leave: %v", err)
	}

	// b folded on their turn; a wins by concession. The table enters the
	// Showdown state so the winner toast can play before the leaver is
	// dropped when the display ends.
	view := g.GenerateOmniView()
	if view.Stage != Showdown {
		t.Fatalf("expected Showdown after concession, got stage %v", view.Stage)
	}
	if len(view.Pots) == 0 || len(view.Pots[0].WinningPlayerNums) != 1 || view.Pots[0].WinningPlayerNums[0] != 0 {
		t.Fatalf("a should win by concession, got %+v", view.Pots)
	}

	if err := SettleShowdown(g); err != nil {
		t.Fatalf("settle showdown: %v", err)
	}
	view = g.GenerateOmniView()
	if len(view.Players) != 1 {
		t.Fatalf("expected 1 player remaining, got %d", len(view.Players))
	}
	if view.Players[0].Stack != 102 {
		t.Fatalf("a should win 102 chips, got %d", view.Players[0].Stack)
	}
}

// Three-handed: one all-in player leaves and has the best hand. The pot is
// forfeited and nobody is awarded the chips.
func TestThreePlayerAllInLeaveForfeits(t *testing.T) {
	g := NewGame()
	Configure(g, 1, 2, 100, 100, 3, 0)

	a := g.AddPlayer()
	b := g.AddPlayer()
	c := g.AddPlayer()

	// b (the leaver) holds aces; a holds kings; c holds queens.
	g.players[b].Cards = [2]Card{MustParseCardString("As"), MustParseCardString("Ah")}
	g.players[a].Cards = [2]Card{MustParseCardString("Ks"), MustParseCardString("Kh")}
	g.players[c].Cards = [2]Card{MustParseCardString("Qs"), MustParseCardString("Qh")}
	g.communityCards = []Card{
		MustParseCardString("2c"),
		MustParseCardString("3d"),
		MustParseCardString("7h"),
		MustParseCardString("8s"),
		MustParseCardString("9d"),
	}

	for _, pn := range []uint{a, b, c} {
		g.players[pn].In = true
		g.players[pn].Stack = 0
		g.players[pn].TotalBet = 100
		g.players[pn].Called = true
	}
	g.setStageAndBetting(River, true)

	if err := LeaveHand(g, b); err != nil {
		t.Fatalf("leave: %v", err)
	}
	if !g.players[b].In || !g.players[b].Left || !g.players[b].Revealed {
		t.Fatalf("all-in leaver should stay in, marked left and revealed")
	}

	g.updateRoundInfo()
	if g.getStage() == Showdown {
		if err := SettleShowdown(g); err != nil {
			t.Fatalf("settle showdown: %v", err)
		}
	}

	view := g.GenerateOmniView()
	if len(view.Pots) == 0 || view.Pots[0].Amt != 300 {
		t.Fatalf("expected a 300-chip pot, got %+v", view.Pots)
	}
	if len(view.Pots[0].WinningPlayerNums) != 0 {
		t.Fatalf("pot should be forfeited, got %v", view.Pots[0].WinningPlayerNums)
	}
	if len(view.Players) != 2 {
		t.Fatalf("expected 2 players remaining, got %d", len(view.Players))
	}
	for _, p := range view.Players {
		if p.Stack != 0 {
			t.Fatalf("nobody should be awarded the forfeited pot, stack=%d", p.Stack)
		}
	}
}

// Three-handed: one all-in player leaves but the opponent has the better hand,
// so the opponent wins the pot normally.
func TestThreePlayerAllInLeaveOpponentWins(t *testing.T) {
	g := NewGame()
	Configure(g, 1, 2, 100, 100, 3, 0)

	a := g.AddPlayer()
	b := g.AddPlayer()
	c := g.AddPlayer()

	// a holds aces (wins); b (the leaver) holds kings; c holds queens.
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

	for _, pn := range []uint{a, b, c} {
		g.players[pn].In = true
		g.players[pn].Stack = 0
		g.players[pn].TotalBet = 100
		g.players[pn].Called = true
	}
	g.setStageAndBetting(River, true)

	if err := LeaveHand(g, b); err != nil {
		t.Fatalf("leave: %v", err)
	}

	g.updateRoundInfo()
	if g.getStage() == Showdown {
		if err := SettleShowdown(g); err != nil {
			t.Fatalf("settle showdown: %v", err)
		}
	}

	view := g.GenerateOmniView()
	if len(view.Pots) == 0 || len(view.Pots[0].WinningPlayerNums) != 1 || view.Pots[0].WinningPlayerNums[0] != 0 {
		t.Fatalf("a should win the pot, got %+v", view.Pots)
	}
	if len(view.Players) != 2 {
		t.Fatalf("expected 2 players remaining, got %d", len(view.Players))
	}
	if view.Players[0].Stack != 300 {
		t.Fatalf("a should win 300 chips, got %d", view.Players[0].Stack)
	}
	if view.Players[1].Stack != 0 {
		t.Fatalf("c should be busted, got %d", view.Players[1].Stack)
	}
}

// Three-handed: a non-all-in player who leaves when it is not their turn is
// folded at the next action instead of immediately.
func TestThreePlayerLeaveNotOnTurnFolds(t *testing.T) {
	g := NewGame()
	Configure(g, 1, 2, 100, 100, 3, 0)

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

	view := g.GenerateOmniView()
	action := view.ActionNum // a is UTG and up to act

	// c (the big blind) leaves while it is a's turn: not folded yet.
	if err := LeaveHand(g, c); err != nil {
		t.Fatalf("leave: %v", err)
	}
	if !g.players[c].In || !g.players[c].Left {
		t.Fatalf("leaver should stay in until the next action")
	}

	// a calls; the next evaluation folds c.
	if err := Bet(g, action, 2); err != nil {
		t.Fatalf("a call: %v", err)
	}
	if g.players[c].In {
		t.Fatalf("c should have folded after the next action")
	}
	after := g.GenerateOmniView()
	if after.ActionNum != b {
		t.Fatalf("action should advance to b, got %d", after.ActionNum)
	}
}

// Three-handed, two leavers: one all-in and one not. The all-in leaver stays
// in for the showdown; the non-all-in leaver folds; the remaining player wins.
func TestThreePlayerTwoLeaveOneAllIn(t *testing.T) {
	g := NewGame()
	Configure(g, 1, 2, 100, 100, 3, 0)

	a := g.AddPlayer()
	b := g.AddPlayer()
	c := g.AddPlayer()

	// a (stays) holds aces; b (all-in leaver) holds kings; c (folded) holds queens.
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

	// a and b are all-in; c has only posted the 2-chip big blind.
	g.players[a].In = true
	g.players[b].In = true
	g.players[c].In = true
	g.players[a].Stack = 0
	g.players[b].Stack = 0
	g.players[c].Stack = 98
	g.players[a].TotalBet = 100
	g.players[b].TotalBet = 100
	g.players[c].TotalBet = 2
	g.players[a].Called = true
	g.players[b].Called = true
	g.setStageAndBetting(River, true)

	if err := LeaveHand(g, b); err != nil {
		t.Fatalf("leave b: %v", err)
	}
	if err := LeaveHand(g, c); err != nil {
		t.Fatalf("leave c: %v", err)
	}
	if !g.players[b].In || !g.players[b].Revealed {
		t.Fatalf("all-in leaver b should stay in and reveal")
	}

	g.updateRoundInfo()
	if g.getStage() == Showdown {
		if err := SettleShowdown(g); err != nil {
			t.Fatalf("settle showdown: %v", err)
		}
	}

	view := g.GenerateOmniView()
	// a (aces) beats b (kings) and wins the 202-chip pot (b's 100 + c's 2).
	if len(view.Pots) == 0 || len(view.Pots[0].WinningPlayerNums) != 1 || view.Pots[0].WinningPlayerNums[0] != 0 {
		t.Fatalf("a should win the pot, got %+v", view.Pots)
	}
	if len(view.Players) != 1 {
		t.Fatalf("expected 1 player remaining, got %d", len(view.Players))
	}
	if view.Players[0].Stack != 202 {
		t.Fatalf("a should win 202 chips, got %d", view.Players[0].Stack)
	}
}

// Three-handed, two all-in leavers: the departing player with the best hand
// forfeits the pot, so nobody is awarded the chips.
func TestThreePlayerTwoLeaveBothAllInForfeits(t *testing.T) {
	g := NewGame()
	Configure(g, 1, 2, 100, 100, 3, 0)

	a := g.AddPlayer()
	b := g.AddPlayer()
	c := g.AddPlayer()

	// b (leaver) holds aces; c (leaver) holds kings; a holds queens.
	g.players[b].Cards = [2]Card{MustParseCardString("As"), MustParseCardString("Ah")}
	g.players[c].Cards = [2]Card{MustParseCardString("Ks"), MustParseCardString("Kh")}
	g.players[a].Cards = [2]Card{MustParseCardString("Qs"), MustParseCardString("Qh")}
	g.communityCards = []Card{
		MustParseCardString("2c"),
		MustParseCardString("3d"),
		MustParseCardString("7h"),
		MustParseCardString("8s"),
		MustParseCardString("9d"),
	}

	for _, pn := range []uint{a, b, c} {
		g.players[pn].In = true
		g.players[pn].Stack = 0
		g.players[pn].TotalBet = 100
		g.players[pn].Called = true
	}
	g.setStageAndBetting(River, true)

	if err := LeaveHand(g, b); err != nil {
		t.Fatalf("leave b: %v", err)
	}
	if err := LeaveHand(g, c); err != nil {
		t.Fatalf("leave c: %v", err)
	}
	if !g.players[b].In || !g.players[c].In {
		t.Fatalf("both all-in leavers should stay in")
	}

	g.updateRoundInfo()
	if g.getStage() == Showdown {
		if err := SettleShowdown(g); err != nil {
			t.Fatalf("settle showdown: %v", err)
		}
	}

	view := g.GenerateOmniView()
	if len(view.Pots) == 0 || view.Pots[0].Amt != 300 {
		t.Fatalf("expected a 300-chip pot, got %+v", view.Pots)
	}
	if len(view.Pots[0].WinningPlayerNums) != 0 {
		t.Fatalf("pot should be forfeited, got %v", view.Pots[0].WinningPlayerNums)
	}
	if len(view.Players) != 1 {
		t.Fatalf("expected 1 player remaining, got %d", len(view.Players))
	}
	if view.Players[0].Stack != 0 {
		t.Fatalf("a should be busted by the forfeit, got %d", view.Players[0].Stack)
	}
}

// Three-handed, two all-in leavers: the remaining player has the best hand and
// wins the pot normally.
func TestThreePlayerTwoLeaveBothAllInRemainingWins(t *testing.T) {
	g := NewGame()
	Configure(g, 1, 2, 100, 100, 3, 0)

	a := g.AddPlayer()
	b := g.AddPlayer()
	c := g.AddPlayer()

	// a (stays) holds aces; b and c (leavers) hold kings and queens.
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

	for _, pn := range []uint{a, b, c} {
		g.players[pn].In = true
		g.players[pn].Stack = 0
		g.players[pn].TotalBet = 100
		g.players[pn].Called = true
	}
	g.setStageAndBetting(River, true)

	if err := LeaveHand(g, b); err != nil {
		t.Fatalf("leave b: %v", err)
	}
	if err := LeaveHand(g, c); err != nil {
		t.Fatalf("leave c: %v", err)
	}

	g.updateRoundInfo()
	if g.getStage() == Showdown {
		if err := SettleShowdown(g); err != nil {
			t.Fatalf("settle showdown: %v", err)
		}
	}

	view := g.GenerateOmniView()
	if len(view.Pots) == 0 || len(view.Pots[0].WinningPlayerNums) != 1 || view.Pots[0].WinningPlayerNums[0] != 0 {
		t.Fatalf("a should win the pot, got %+v", view.Pots)
	}
	if len(view.Players) != 1 {
		t.Fatalf("expected 1 player remaining, got %d", len(view.Players))
	}
	if view.Players[0].Stack != 300 {
		t.Fatalf("a should win 300 chips, got %d", view.Players[0].Stack)
	}
}

// An all-in player who leaves must not stall the runout: the board is still
// dealt one card at a time and the hand resolves to the showdown.
func TestAllInLeaveRunoutCompletes(t *testing.T) {
	g := NewGame()
	Configure(g, 1, 2, 100, 100, 2, 0)

	a := g.AddPlayer()
	b := g.AddPlayer()

	g.players[a].Cards = [2]Card{MustParseCardString("As"), MustParseCardString("Ah")}
	g.players[b].Cards = [2]Card{MustParseCardString("Ks"), MustParseCardString("Kh")}

	// a is all-in; b faces the all-in on their turn.
	g.players[a].In = true
	g.players[b].In = true
	g.players[a].Stack = 0
	g.players[b].Stack = 98
	g.players[a].Bet = 100
	g.players[b].Bet = 2
	g.players[a].TotalBet = 100
	g.players[b].TotalBet = 2
	g.actionNum = b
	g.setStageAndBetting(PreFlop, true)

	// a leaves while all-in: stays in and reveals.
	if err := LeaveHand(g, a); err != nil {
		t.Fatalf("leave: %v", err)
	}
	if !g.players[a].In || !g.players[a].Revealed {
		t.Fatalf("all-in leaver should stay in and reveal")
	}

	// b calls the all-in; betting turns off and the runout begins.
	if err := Bet(g, b, 98); err != nil {
		t.Fatalf("b call: %v", err)
	}
	if g.getBetting() {
		t.Fatalf("betting should be off after the call")
	}

	// Drive the runout: the flop is dealt all at once, then the turn and river
	// are revealed one at a time. Dealing the river enters the Showdown state;
	// settleShowdown() resolves the display window and drops the leaver.
	revealed := 0
	for g.getStage() != Showdown {
		if err := RunoutNext(g); err != nil {
			t.Fatalf("runout: %v", err)
		}
		if g.getStage() != Showdown {
			revealed++
		}
	}
	if revealed != 3 {
		t.Fatalf("expected 3 reveal steps (flop, turn, river), got %d", revealed)
	}
	if err := SettleShowdown(g); err != nil {
		t.Fatalf("settle showdown: %v", err)
	}

	// The leaver is dropped once the hand resolves; only b remains.
	view := g.GenerateOmniView()
	if len(view.Players) != 1 {
		t.Fatalf("expected 1 player remaining, got %d", len(view.Players))
	}
}

// A flop all-in that is called must still reveal the turn and river one at a
// time before settling, instead of skipping straight to the next hand.
func TestFlopAllInRunoutRevealsTurnAndRiver(t *testing.T) {
	g := NewGame()
	Configure(g, 1, 2, 100, 100, 2, 0)

	a := g.AddPlayer()
	b := g.AddPlayer()

	for _, pn := range []uint{a, b} {
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

	// Preflop: a (dealer/SB) calls, b (BB) checks.
	if err := Bet(g, a, 1); err != nil {
		t.Fatalf("a call: %v", err)
	}
	if err := Bet(g, b, 0); err != nil {
		t.Fatalf("b check: %v", err)
	}

	// The flop has been dealt; b (first to act post-flop) shoves and a calls all-in.
	if g.getStage() != Flop {
		t.Fatalf("expected flop, got stage %d", g.getStage())
	}
	if err := Bet(g, b, 98); err != nil {
		t.Fatalf("b all-in: %v", err)
	}
	if err := Bet(g, a, 98); err != nil {
		t.Fatalf("a call: %v", err)
	}
	if g.getBetting() {
		t.Fatalf("betting should be off after both players are all-in")
	}

	// Drive the runout: exactly two more cards (turn + river) must be dealt,
	// landing the table in the Showdown state.
	revealed := 0
	for g.getStage() != Showdown {
		if err := RunoutNext(g); err != nil {
			t.Fatalf("runout: %v", err)
		}
		if g.getStage() != Showdown {
			revealed++
		}
	}
	if revealed != 2 {
		t.Fatalf("expected turn + river (2 cards), got %d", revealed)
	}
	if err := SettleShowdown(g); err != nil {
		t.Fatalf("settle showdown: %v", err)
	}

	// Chips must be conserved: 200 total, the winner gets it all.
	view := g.GenerateOmniView()
	total := uint(0)
	for _, p := range view.Players {
		total += p.Stack
	}
	if total != 200 {
		t.Fatalf("chips should be conserved (200), got %d", total)
	}
}

// headsUpFlop deals a heads-up hand (a short, b deep), checks through the
// preflop street and returns with the flop dealt and b about to bet 100.
// Seat order is parameterised because the old excess-return code depended on
// player indices.
func headsUpFlop(t *testing.T, aFirst bool, aStack, bStack uint) (*Game, uint, uint) {
	t.Helper()
	g := NewGame()
	Configure(g, 1, 2, 200, 1000, 2, 0)
	var a, b uint
	if aFirst {
		a = g.AddPlayer()
		b = g.AddPlayer()
	} else {
		b = g.AddPlayer()
		a = g.AddPlayer()
	}
	BuyIn(g, a, aStack)
	BuyIn(g, b, bStack)
	for _, pn := range []uint{a, b} {
		if err := ToggleReady(g, pn, 0); err != nil {
			t.Fatalf("ready %d: %v", pn, err)
		}
	}
	if err := Deal(g, g.GenerateOmniView().DealerNum, 0); err != nil {
		t.Fatalf("deal: %v", err)
	}
	// Preflop: the dealer/SB completes, the BB checks.
	first := g.GenerateOmniView().ActionNum
	if err := Bet(g, first, 1); err != nil {
		t.Fatalf("sb call: %v", err)
	}
	if err := Bet(g, 1-first, 0); err != nil {
		t.Fatalf("bb check: %v", err)
	}
	if g.getStage() != Flop {
		t.Fatalf("expected flop, got stage %d", g.getStage())
	}
	// If a is first to act on the flop, a checks so that b can lead out.
	if g.GenerateOmniView().ActionNum == a {
		if err := Bet(g, a, 0); err != nil {
			t.Fatalf("a check: %v", err)
		}
	}
	return g, a, b
}

// Regression: b bets 100 on the flop and a shoves for 148 more (total 150),
// which is more than a call but less than a full raise. The old code treated
// b as already "called", ended the street at once and, depending on seat
// order, either excluded b from the pot (a won everything at showdown
// without b ever acting) or silently downgraded a's shove to a call. b must
// be asked to match the extra 48 (or fold), and a full call must conserve
// chips and run the board out.
func TestShortAllInRaiseOpponentMustAct(t *testing.T) {
	for _, aFirst := range []bool{true, false} {
		g, a, b := headsUpFlop(t, aFirst, 150, 400)

		if err := Bet(g, b, 100); err != nil {
			t.Fatalf("b bet: %v", err)
		}
		if err := Bet(g, a, g.players[a].Stack); err != nil {
			t.Fatalf("a shove: %v", err)
		}
		if g.players[a].Stack != 0 {
			t.Fatalf("a should be all-in, stack=%d", g.players[a].Stack)
		}

		// Still the flop, still betting, and b is up: the street did not end.
		view := g.GenerateOmniView()
		if view.Stage != Flop || !view.Betting || view.ActionNum != b {
			t.Fatalf("aFirst=%v: b should face the short all-in on the flop, got stage=%d betting=%v action=%d",
				aFirst, view.Stage, view.Betting, view.ActionNum)
		}
		// The shove must not have been downgraded to a call.
		if g.players[a].TotalBet != 150 {
			t.Fatalf("aFirst=%v: a's total should be 150, got %d", aFirst, g.players[a].TotalBet)
		}

		// b has already acted this street, so b may only call or fold: a
		// re-raise (or a shove) must be rejected.
		if err := Bet(g, b, 200); err == nil {
			t.Fatalf("aFirst=%v: b should not be able to re-raise a short all-in", aFirst)
		}
		if err := Bet(g, b, g.players[b].Stack); err == nil {
			t.Fatalf("aFirst=%v: b should not be able to shove over a short all-in", aFirst)
		}
		// Calling exactly the extra 48 works.
		if err := Bet(g, b, 48); err != nil {
			t.Fatalf("aFirst=%v: b call: %v", aFirst, err)
		}

		// Nobody can act any more: the board runs out.
		if g.getBetting() {
			t.Fatalf("aFirst=%v: betting should be off once only an all-in player is left to beat", aFirst)
		}
		for g.getStage() != Showdown {
			if err := RunoutNext(g); err != nil {
				t.Fatalf("runout: %v", err)
			}
		}
		// The main pot holds 150 from each player; both are eligible.
		if len(g.pots) == 0 || g.pots[0].Amt != 300 || len(g.pots[0].EligiblePlayerNums) != 2 {
			t.Fatalf("aFirst=%v: expected a 300-chip pot contested by both, got %+v", aFirst, g.pots)
		}
		if err := SettleShowdown(g); err != nil {
			t.Fatalf("settle: %v", err)
		}
		if total := g.players[a].Stack + g.players[b].Stack; total != 550 {
			t.Fatalf("aFirst=%v: chips should be conserved (550), got %d", aFirst, total)
		}
	}
}

// A short all-in that is bigger than the bet must still be foldable by the
// player who already acted: they lose only what they put in.
func TestShortAllInRaiseOpponentMayFold(t *testing.T) {
	g, a, b := headsUpFlop(t, true, 150, 400)

	if err := Bet(g, b, 100); err != nil {
		t.Fatalf("b bet: %v", err)
	}
	if err := Bet(g, a, g.players[a].Stack); err != nil {
		t.Fatalf("a shove: %v", err)
	}
	if err := Fold(g, b, 0); err != nil {
		t.Fatalf("b fold: %v", err)
	}
	if g.getStage() != Showdown {
		t.Fatalf("expected Showdown after fold, got %d", g.getStage())
	}
	if err := SettleShowdown(g); err != nil {
		t.Fatalf("settle: %v", err)
	}
	// a wins the 150 shove back plus b's 2 (preflop) + 100 (flop).
	if g.players[a].Stack != 252 || g.players[b].Stack != 298 {
		t.Fatalf("expected a=252 b=298, got a=%d b=%d", g.players[a].Stack, g.players[b].Stack)
	}
}

// Regression: b bets more than a has and a calls all-in for less. b's uncalled
// excess is returned immediately (whichever seat b sits in), the pots are
// rebuilt without it so no chips are created, and the board runs out instead
// of making b check alone through every street.
func TestShortAllInCallReturnsExcessAndRunsOut(t *testing.T) {
	for _, aFirst := range []bool{true, false} {
		g, a, b := headsUpFlop(t, aFirst, 150, 400)

		if err := Bet(g, b, 200); err != nil {
			t.Fatalf("b bet: %v", err)
		}
		if err := Bet(g, a, g.players[a].Stack); err != nil {
			t.Fatalf("a call all-in: %v", err)
		}

		// b's 52 uncalled chips (202 - 150) are back in b's stack.
		if g.players[b].Stack != 400-150 || g.players[b].TotalBet != 150 || g.players[b].Bet != 148 {
			t.Fatalf("aFirst=%v: b should have the excess back: stack=%d total=%d bet=%d",
				aFirst, g.players[b].Stack, g.players[b].TotalBet, g.players[b].Bet)
		}
		// Nothing left to bet: runout, not a lone check-down.
		if g.getBetting() {
			t.Fatalf("aFirst=%v: betting should be off", aFirst)
		}
		if len(g.pots) == 0 || g.pots[0].Amt != 300 {
			t.Fatalf("aFirst=%v: expected a 300-chip pot, got %+v", aFirst, g.pots)
		}
		for g.getStage() != Showdown {
			if err := RunoutNext(g); err != nil {
				t.Fatalf("runout: %v", err)
			}
		}
		if err := SettleShowdown(g); err != nil {
			t.Fatalf("settle: %v", err)
		}
		if total := g.players[a].Stack + g.players[b].Stack; total != 550 {
			t.Fatalf("aFirst=%v: chips should be conserved (550), got %d", aFirst, total)
		}
	}
}

// Three-handed: a short all-in does not reopen the betting for a player who
// already acted, but a player who has not yet acted this street may still
// raise, and the minimum raise is measured from the all-in amount.
func TestShortAllInThreeHandedRaiseRights(t *testing.T) {
	g := NewGame()
	Configure(g, 1, 2, 200, 1000, 3, 0)

	a := g.AddPlayer()
	b := g.AddPlayer()
	c := g.AddPlayer()
	BuyIn(g, a, 500) // dealer / UTG
	BuyIn(g, b, 500) // small blind
	BuyIn(g, c, 15)  // big blind, short
	for _, pn := range []uint{a, b, c} {
		if err := ToggleReady(g, pn, 0); err != nil {
			t.Fatalf("ready %d: %v", pn, err)
		}
	}
	if err := Deal(g, a, 0); err != nil {
		t.Fatalf("deal: %v", err)
	}

	// a opens to 10 (min raise is now 8). c shoves 15 total: only 5 more, a
	// short all-in.
	if err := Bet(g, a, 10); err != nil {
		t.Fatalf("a open: %v", err)
	}
	// b has not acted yet and just calls 9 more.
	if err := Bet(g, b, 9); err != nil {
		t.Fatalf("b call: %v", err)
	}
	if err := Bet(g, c, 13); err != nil {
		t.Fatalf("c shove: %v", err)
	}
	if g.players[c].Stack != 0 {
		t.Fatalf("c should be all-in")
	}

	// a already acted: a can call the extra 5 but cannot raise.
	if g.actionNum != a {
		t.Fatalf("a should be next, got %d", g.actionNum)
	}
	if err := Bet(g, a, 13); err == nil {
		t.Fatalf("a already acted and must not be able to raise over a short all-in")
	}
	if err := Bet(g, a, 5); err != nil {
		t.Fatalf("a call: %v", err)
	}
	// b already acted too: call only.
	if g.actionNum != b {
		t.Fatalf("b should be next, got %d", g.actionNum)
	}
	if err := Bet(g, b, 20); err == nil {
		t.Fatalf("b already acted and must not be able to raise over a short all-in")
	}
	if err := Bet(g, b, 5); err != nil {
		t.Fatalf("b call: %v", err)
	}

	// Everyone matched 15; the street is over and the flop is dealt with a
	// and b still able to bet against each other.
	if g.getStage() != Flop || !g.getBetting() {
		t.Fatalf("expected flop betting, got stage=%d betting=%v", g.getStage(), g.getBetting())
	}
	for _, pn := range []uint{a, b} {
		if g.players[pn].TotalBet != 15 {
			t.Fatalf("player %d should have 15 in, got %d", pn, g.players[pn].TotalBet)
		}
	}
}

// A player who has NOT acted since the last full raise keeps the right to
// raise over a short all-in, and the minimum raise is counted from the all-in
// amount using the last full raise size.
func TestShortAllInDoesNotBlockUnactedPlayer(t *testing.T) {
	g := NewGame()
	Configure(g, 1, 2, 200, 1000, 3, 0)

	a := g.AddPlayer()
	b := g.AddPlayer()
	c := g.AddPlayer()
	BuyIn(g, a, 500) // dealer / UTG
	BuyIn(g, b, 15)  // small blind, short
	BuyIn(g, c, 500) // big blind
	for _, pn := range []uint{a, b, c} {
		if err := ToggleReady(g, pn, 0); err != nil {
			t.Fatalf("ready %d: %v", pn, err)
		}
	}
	if err := Deal(g, a, 0); err != nil {
		t.Fatalf("deal: %v", err)
	}

	// a opens to 10; b shoves to 15 (short: less than the 8-chip min raise).
	if err := Bet(g, a, 10); err != nil {
		t.Fatalf("a open: %v", err)
	}
	if err := Bet(g, b, 14); err != nil {
		t.Fatalf("b shove: %v", err)
	}
	// c has not acted: a raise to 22 (15 + 8) is illegal, 23 is the minimum.
	if g.actionNum != c {
		t.Fatalf("c should be next, got %d", g.actionNum)
	}
	if err := Bet(g, c, 20); err == nil {
		t.Fatalf("raise to 22 is below the minimum (15 + 8)")
	}
	if err := Bet(g, c, 21); err != nil {
		t.Fatalf("c min raise to 23: %v", err)
	}
	// A full raise reopens the action for a.
	if g.actionNum != a {
		t.Fatalf("a should be next, got %d", g.actionNum)
	}
	if err := Bet(g, a, 13); err != nil {
		t.Fatalf("a call: %v", err)
	}
	if g.getStage() != Flop {
		t.Fatalf("expected flop, got stage %d", g.getStage())
	}
}

// The minimum bet post-flop and the minimum raise preflop are one big blind.
func TestMinimumBetIsBigBlind(t *testing.T) {
	g := NewGame()
	Configure(g, 5, 10, 1000, 1000, 2, 0)

	a := g.AddPlayer()
	b := g.AddPlayer()
	for _, pn := range []uint{a, b} {
		BuyIn(g, pn, 1000)
		if err := ToggleReady(g, pn, 0); err != nil {
			t.Fatalf("ready %d: %v", pn, err)
		}
	}
	if err := Deal(g, a, 0); err != nil {
		t.Fatalf("deal: %v", err)
	}

	// Preflop, dealer/SB (a) has 5 in: raising to 15 is illegal, 20 is the minimum.
	if err := Bet(g, a, 10); err == nil {
		t.Fatalf("raise to 15 should be below the minimum of 2 big blinds")
	}
	if err := Bet(g, a, 15); err != nil {
		t.Fatalf("raise to 20: %v", err)
	}
	if err := Bet(g, b, 10); err != nil {
		t.Fatalf("b call: %v", err)
	}
	if g.getStage() != Flop {
		t.Fatalf("expected flop, got stage %d", g.getStage())
	}

	// Post-flop the first player may not bet less than a big blind.
	first := g.actionNum
	if err := Bet(g, first, 5); err == nil {
		t.Fatalf("bet of 5 should be below the 10-chip minimum bet")
	}
	if err := Bet(g, first, 10); err != nil {
		t.Fatalf("bet of 10: %v", err)
	}
}

// A short stack that goes all-in on the flop and is called must still reveal
// the turn and river before settling.
func TestShortAllInFlopRevealsTurnAndRiver(t *testing.T) {
	g := NewGame()
	Configure(g, 1, 2, 100, 100, 2, 0)

	a := g.AddPlayer()
	b := g.AddPlayer()

	for _, pn := range []uint{a, b} {
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

	// Preflop: a (dealer/SB) calls, b (BB) checks.
	if err := Bet(g, a, 1); err != nil {
		t.Fatalf("a call: %v", err)
	}
	if err := Bet(g, b, 0); err != nil {
		t.Fatalf("b check: %v", err)
	}

	// The flop is dealt. Make a a short stack, then b shoves and a calls
	// all-in for less.
	if g.getStage() != Flop {
		t.Fatalf("expected flop, got stage %d", g.getStage())
	}
	g.players[a].Stack = 50
	if err := Bet(g, b, 98); err != nil {
		t.Fatalf("b all-in: %v", err)
	}
	if err := Bet(g, a, 50); err != nil {
		t.Fatalf("a call all-in: %v", err)
	}
	if g.getBetting() {
		t.Fatalf("betting should be off after both are all-in")
	}

	// Drive the runout: exactly two more cards (turn + river) must be dealt,
	// landing the table in the Showdown state.
	revealed := 0
	for g.getStage() != Showdown {
		if err := RunoutNext(g); err != nil {
			t.Fatalf("runout: %v", err)
		}
		if g.getStage() != Showdown {
			revealed++
		}
	}
	if revealed != 2 {
		t.Fatalf("expected turn + river (2 cards), got %d", revealed)
	}
}
