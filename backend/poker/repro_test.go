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
	// PreDeal. The flop is revealed all at once, then the turn and river.
	revealedCards := 0
	for g.getStage() != PreDeal {
		if err := RunoutNext(g); err != nil {
			t.Fatalf("runout: %v", err)
		}
		if g.getStage() != PreDeal {
			revealedCards++
		}
	}
	if revealedCards != 3 {
		t.Fatalf("expected 3 reveal steps (flop, turn, river), got %d", revealedCards)
	}

	total := g.players[a].Stack + g.players[b].Stack + g.players[c].Stack
	if total != 2100 {
		t.Fatalf("chips should be conserved (2100), got %d", total)
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

	view := g.GenerateOmniView()
	if len(view.Players) != 1 {
		t.Fatalf("expected 1 player remaining, got %d", len(view.Players))
	}
	if len(view.Pots) == 0 || len(view.Pots[0].WinningPlayerNums) != 1 {
		t.Fatalf("expected a pot with a single winner")
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
	g.running = true
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
	g.running = true
	g.setStageAndBetting(River, true)

	if err := LeaveHand(g, b); err != nil {
		t.Fatalf("leave: %v", err)
	}

	g.updateRoundInfo()

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
	g.running = true
	g.setStageAndBetting(PreFlop, true)

	if err := LeaveHand(g, b); err != nil {
		t.Fatalf("leave: %v", err)
	}
	if err := Fold(g, a, 0); err != nil {
		t.Fatalf("a fold: %v", err)
	}

	view := g.GenerateOmniView()
	// a folded, and b (the all-in leaver) cannot collect: the pot vanishes.
	if len(view.Pots) == 0 || view.Pots[0].Amt != 102 {
		t.Fatalf("expected a 102-chip pot, got %+v", view.Pots)
	}
	if len(view.Pots[0].WinningPlayerNums) != 0 {
		t.Fatalf("pot should have no winners (forfeit), got %v", view.Pots[0].WinningPlayerNums)
	}
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
	g.running = true
	g.setStageAndBetting(PreFlop, true)

	if err := LeaveHand(g, b); err != nil {
		t.Fatalf("leave: %v", err)
	}

	view := g.GenerateOmniView()
	// b folded on their turn and was dropped; a wins the pot by concession.
	if len(view.Players) != 1 {
		t.Fatalf("expected 1 player remaining, got %d", len(view.Players))
	}
	if len(view.Pots) == 0 || len(view.Pots[0].WinningPlayerNums) != 1 || view.Pots[0].WinningPlayerNums[0] != 0 {
		t.Fatalf("a should win by concession, got %+v", view.Pots)
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
	g.running = true
	g.setStageAndBetting(River, true)

	if err := LeaveHand(g, b); err != nil {
		t.Fatalf("leave: %v", err)
	}
	if !g.players[b].In || !g.players[b].Left || !g.players[b].Revealed {
		t.Fatalf("all-in leaver should stay in, marked left and revealed")
	}

	g.updateRoundInfo()

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
	g.running = true
	g.setStageAndBetting(River, true)

	if err := LeaveHand(g, b); err != nil {
		t.Fatalf("leave: %v", err)
	}

	g.updateRoundInfo()

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
	g.running = true
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
	g.running = true
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
	g.running = true
	g.setStageAndBetting(River, true)

	if err := LeaveHand(g, b); err != nil {
		t.Fatalf("leave b: %v", err)
	}
	if err := LeaveHand(g, c); err != nil {
		t.Fatalf("leave c: %v", err)
	}

	g.updateRoundInfo()

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
	g.running = true
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
	// are revealed one at a time. It must resolve without hanging.
	revealed := 0
	for g.getStage() != PreDeal {
		if err := RunoutNext(g); err != nil {
			t.Fatalf("runout: %v", err)
		}
		if g.getStage() != PreDeal {
			revealed++
		}
	}
	if revealed != 3 {
		t.Fatalf("expected 3 reveal steps (flop, turn, river), got %d", revealed)
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

	// Drive the runout: exactly two more cards (turn + river) must be dealt.
	revealed := 0
	for g.getStage() != PreDeal {
		if err := RunoutNext(g); err != nil {
			t.Fatalf("runout: %v", err)
		}
		if g.getStage() != PreDeal {
			revealed++
		}
	}
	if revealed != 2 {
		t.Fatalf("expected turn + river (2 cards), got %d", revealed)
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

	// Drive the runout: exactly two more cards (turn + river) must be dealt.
	revealed := 0
	for g.getStage() != PreDeal {
		if err := RunoutNext(g); err != nil {
			t.Fatalf("runout: %v", err)
		}
		if g.getStage() != PreDeal {
			revealed++
		}
	}
	if revealed != 2 {
		t.Fatalf("expected turn + river (2 cards), got %d", revealed)
	}
}
