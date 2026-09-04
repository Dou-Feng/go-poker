package poker

import (
	"testing"

	. "github.com/alexclewontin/riverboat/eval"
)

// Side-pot suite. Every scenario is driven through real actions (deal, bet,
// fold), then the board is rigged and the hand run out to showdown, so the
// pots are built exactly the way they are in production.

func cards(a, b string) [2]Card {
	return [2]Card{MustParseCardString(a), MustParseCardString(b)}
}

// A dry board that never improves anyone: the pocket pair wins.
var dryBoard = []Card{
	MustParseCardString("2c"),
	MustParseCardString("3d"),
	MustParseCardString("7h"),
	MustParseCardString("8s"),
	MustParseCardString("Jd"),
}

// sitDown seats len(stacks) players with the given stacks, readies them and
// deals with player 0 as dealer. Blinds are 1/2.
func sitDown(t *testing.T, stacks ...uint) *Game {
	t.Helper()
	g := NewGame()
	Configure(g, 1, 2, 1000, 10000, uint(len(stacks)), 0)
	for _, s := range stacks {
		pn := g.AddPlayer()
		if err := BuyIn(g, pn, s); err != nil {
			t.Fatalf("buyin %d: %v", pn, err)
		}
		if err := ToggleReady(g, pn, 0); err != nil {
			t.Fatalf("ready %d: %v", pn, err)
		}
	}
	if err := Deal(g, 0, 0); err != nil {
		t.Fatalf("deal: %v", err)
	}
	return g
}

// shove puts the player all-in.
func shove(t *testing.T, g *Game, pn uint) {
	t.Helper()
	if err := Bet(g, pn, g.players[pn].Stack); err != nil {
		t.Fatalf("player %d shove: %v", pn, err)
	}
}

// call matches the highest bet (or as much as the player has).
func call(t *testing.T, g *Game, pn uint) {
	t.Helper()
	amt := g.toCall() - g.players[pn].Bet
	if amt > g.players[pn].Stack {
		amt = g.players[pn].Stack
	}
	if err := Bet(g, pn, amt); err != nil {
		t.Fatalf("player %d call %d: %v", pn, amt, err)
	}
}

// showdown rigs the board, runs the hand out and settles it. Betting must
// already be over (everyone all-in or nobody left to act).
func showdown(t *testing.T, g *Game, board []Card) {
	t.Helper()
	if g.getBetting() {
		t.Fatalf("betting should be over before the showdown, stage=%d action=%d", g.getStage(), g.actionNum)
	}
	// Reveal the whole board at once with the rigged cards, then let
	// RunoutNext resolve the completed board exactly like the client does.
	copy(g.communityCards, board)
	g.setStage(River)
	if err := RunoutNext(g); err != nil {
		t.Fatalf("runout: %v", err)
	}
	if g.getStage() != Showdown {
		t.Fatalf("expected Showdown, got stage %d", g.getStage())
	}
	if err := SettleShowdown(g); err != nil {
		t.Fatalf("settle: %v", err)
	}
}

func totalChips(g *Game) uint {
	var sum uint
	for _, p := range g.players {
		sum += p.Stack
	}
	return sum
}

func expectStacks(t *testing.T, g *Game, want ...uint) {
	t.Helper()
	for pn, w := range want {
		if got := g.players[pn].Stack; got != w {
			t.Errorf("player %d stack = %d, want %d", pn, got, w)
		}
	}
}

// The user's case: A shoves 200, B calls all-in for 100. Only 100 of A's
// chips can be matched, so A must get 100 back (it never enters the pot) and
// the single 200-chip pot goes to the winner. Whoever wins, 300 chips remain.
func TestHeadsUpUnequalAllInRefundsExcess(t *testing.T) {
	for _, aWins := range []bool{true, false} {
		// Player 0 (A) is dealer/SB and acts first preflop; player 1 (B) is BB.
		g := sitDown(t, 200, 100)
		a, b := uint(0), uint(1)
		if aWins {
			g.players[a].Cards = cards("As", "Ah")
			g.players[b].Cards = cards("Ks", "Kh")
		} else {
			g.players[a].Cards = cards("Ks", "Kh")
			g.players[b].Cards = cards("As", "Ah")
		}

		shove(t, g, a)
		call(t, g, b)

		// The excess is refunded as soon as the betting closes: A has 100 back
		// and both players have exactly 100 in the middle.
		if g.players[a].Stack != 100 || g.players[a].TotalBet != 100 {
			t.Fatalf("A should be refunded 100: stack=%d total=%d", g.players[a].Stack, g.players[a].TotalBet)
		}
		if g.players[b].TotalBet != 100 {
			t.Fatalf("B total = %d, want 100", g.players[b].TotalBet)
		}
		// One live pot of 200 that both can win. No phantom empty pots.
		if len(g.pots) != 1 || g.pots[0].Amt != 200 || len(g.pots[0].EligiblePlayerNums) != 2 {
			t.Fatalf("expected one 200-chip pot contested by both, got %+v", g.pots)
		}

		showdown(t, g, dryBoard)

		if aWins {
			expectStacks(t, g, 300, 0)
		} else {
			expectStacks(t, g, 100, 200)
		}
		if totalChips(g) != 300 {
			t.Fatalf("chips must be conserved (300), got %d", totalChips(g))
		}
		if g.players[a].Stats.HandsWon+g.players[b].Stats.HandsWon != 1 {
			t.Fatalf("exactly one player should be credited with a win, got a=%d b=%d",
				g.players[a].Stats.HandsWon, g.players[b].Stats.HandsWon)
		}
	}
}

// Same shape but the deep stack is the caller: the short stack shoves 100
// and the deep stack "calls" with a 200 shove. The caller's excess is
// refunded, not the shover's.
func TestHeadsUpDeepCallerRefunded(t *testing.T) {
	g := sitDown(t, 100, 200)
	a, b := uint(0), uint(1)
	g.players[a].Cards = cards("As", "Ah")
	g.players[b].Cards = cards("Ks", "Kh")

	shove(t, g, a) // 100
	shove(t, g, b) // 200, of which only 100 can be matched

	if g.players[b].Stack != 100 || g.players[b].TotalBet != 100 {
		t.Fatalf("B should be refunded 100: stack=%d total=%d", g.players[b].Stack, g.players[b].TotalBet)
	}
	showdown(t, g, dryBoard)
	expectStacks(t, g, 200, 100)
}

// Three all-ins of 50 / 100 / 200. Main pot 150 (everyone), side pot 100
// (the two bigger stacks), and the biggest stack is refunded its unmatched
// 100. Each winner ordering is checked.
func TestThreeWayAllInSidePots(t *testing.T) {
	type want struct {
		name   string
		cards  [3][2]Card // player 0, 1, 2 (stacks 50, 100, 200)
		stacks [3]uint
	}
	aces, kings, queens := cards("As", "Ah"), cards("Ks", "Kh"), cards("Qs", "Qh")
	tests := []want{
		{
			// Short stack has the best hand: takes the 150 main pot only; the
			// side pot (100) goes to the better of the other two.
			name:   "short wins main, mid wins side",
			cards:  [3][2]Card{aces, kings, queens},
			stacks: [3]uint{150, 100, 100},
		},
		{
			name:   "short wins main, big wins side",
			cards:  [3][2]Card{aces, queens, kings},
			stacks: [3]uint{150, 0, 200},
		},
		{
			// Middle stack best: main + side = 250. Big stack keeps only the refund.
			name:   "mid wins everything",
			cards:  [3][2]Card{queens, aces, kings},
			stacks: [3]uint{0, 250, 100},
		},
		{
			// Big stack best: main + side + refund = 350.
			name:   "big wins everything",
			cards:  [3][2]Card{queens, kings, aces},
			stacks: [3]uint{0, 0, 350},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// Player 0 dealer (acts first), 1 SB, 2 BB.
			g := sitDown(t, 50, 100, 200)
			for pn := range tc.cards {
				g.players[pn].Cards = tc.cards[pn]
			}

			shove(t, g, 0) // 50
			shove(t, g, 1) // 100 (full raise over 50)
			shove(t, g, 2) // 200, only 100 matchable

			if g.players[2].Stack != 100 || g.players[2].TotalBet != 100 {
				t.Fatalf("big stack should be refunded 100: stack=%d total=%d", g.players[2].Stack, g.players[2].TotalBet)
			}
			if len(g.pots) != 2 {
				t.Fatalf("expected main + side pot, got %+v", g.pots)
			}
			main, side := g.pots[0], g.pots[1]
			if main.Amt != 150 || len(main.EligiblePlayerNums) != 3 {
				t.Fatalf("main pot should be 150 for all three, got %+v", main)
			}
			if side.Amt != 100 || len(side.EligiblePlayerNums) != 2 ||
				side.EligiblePlayerNums[0] != 1 || side.EligiblePlayerNums[1] != 2 {
				t.Fatalf("side pot should be 100 for players 1 and 2, got %+v", side)
			}

			showdown(t, g, dryBoard)
			expectStacks(t, g, tc.stacks[0], tc.stacks[1], tc.stacks[2])
			if totalChips(g) != 350 {
				t.Fatalf("chips must be conserved (350), got %d", totalChips(g))
			}
		})
	}
}

// Dead money: a player who puts chips in and then folds is not eligible for
// anything, but their chips stay in the pots. Player 2 (BB, 2 chips) folds to
// two shoves of 50 and 100; the winner collects the 2 as well.
func TestFoldedChipsStayInPot(t *testing.T) {
	g := sitDown(t, 50, 100, 300)
	g.players[0].Cards = cards("As", "Ah")
	g.players[1].Cards = cards("Ks", "Kh")

	shove(t, g, 0) // 50
	shove(t, g, 1) // 100
	if err := Fold(g, 2, 0); err != nil {
		t.Fatalf("fold: %v", err)
	}

	// Player 1's unmatched 50 comes back; the folded big blind is dead money.
	if g.players[1].Stack != 50 || g.players[1].TotalBet != 50 {
		t.Fatalf("player 1 should be refunded 50: stack=%d total=%d", g.players[1].Stack, g.players[1].TotalBet)
	}
	if len(g.pots) != 1 || g.pots[0].Amt != 102 {
		t.Fatalf("expected one 102-chip pot (50+50+2 dead), got %+v", g.pots)
	}
	for _, pn := range g.pots[0].EligiblePlayerNums {
		if pn == 2 {
			t.Fatalf("folded player must not be eligible: %+v", g.pots[0])
		}
	}

	showdown(t, g, dryBoard)
	// Aces collect the whole 102 pot (their own 50, player 1's 50, the dead 2).
	expectStacks(t, g, 102, 50, 298)
	if totalChips(g) != 450 {
		t.Fatalf("chips must be conserved (450), got %d", totalChips(g))
	}
}

// A live player calls two shorter all-ins: the caller is the only one eligible
// for the chips above the second all-in, and those chips are refunded rather
// than sitting in a one-player pot.
func TestLivePlayerCallsTwoAllIns(t *testing.T) {
	g := sitDown(t, 50, 100, 300)
	g.players[0].Cards = cards("Qs", "Qh")
	g.players[1].Cards = cards("Ks", "Kh")
	g.players[2].Cards = cards("As", "Ah")

	shove(t, g, 0) // 50
	shove(t, g, 1) // 100
	call(t, g, 2)  // calls 100 total, keeps 200 behind

	// Nobody can act against player 2 any more: betting stops, no refund
	// needed because the call exactly matched the top all-in.
	if g.getBetting() {
		t.Fatalf("betting should be over")
	}
	if g.players[2].Stack != 200 || g.players[2].TotalBet != 100 {
		t.Fatalf("caller stack=%d total=%d, want 200/100", g.players[2].Stack, g.players[2].TotalBet)
	}
	if len(g.pots) != 2 || g.pots[0].Amt != 150 || g.pots[1].Amt != 100 {
		t.Fatalf("expected pots 150 + 100, got %+v", g.pots)
	}

	showdown(t, g, dryBoard)
	// Aces take both pots: 200 + 150 + 100.
	expectStacks(t, g, 0, 0, 450)
}

// Two players all-in for exactly the same amount produce one pot, one award
// and one HandsWon credit (no duplicate empty pot).
func TestEqualAllInsSinglePot(t *testing.T) {
	g := sitDown(t, 100, 100)
	g.players[0].Cards = cards("As", "Ah")
	g.players[1].Cards = cards("Ks", "Kh")

	shove(t, g, 0)
	call(t, g, 1)

	if len(g.pots) != 1 || g.pots[0].Amt != 200 {
		t.Fatalf("expected a single 200-chip pot, got %+v", g.pots)
	}
	showdown(t, g, dryBoard)
	expectStacks(t, g, 200, 0)
	if g.players[0].Stats.HandsWon != 1 {
		t.Fatalf("winner should be credited once, got %d", g.players[0].Stats.HandsWon)
	}
	if g.players[0].Stats.MaxPotWon != 200 {
		t.Fatalf("max pot won should be 200, got %d", g.players[0].Stats.MaxPotWon)
	}
}

// A tie splits the pot evenly between the tied players; a side pot the short
// stack is not eligible for still goes to its own winner.
func TestTiedMainPotSplitsAndSidePotSeparate(t *testing.T) {
	g := sitDown(t, 50, 100, 200)
	g.players[0].Cards = cards("As", "Kd") // ace-king
	g.players[1].Cards = cards("Ah", "Kc") // ace-king: ties player 0
	g.players[2].Cards = cards("Qs", "Qh") // queens: loses to AK on this board

	shove(t, g, 0)
	shove(t, g, 1)
	shove(t, g, 2)

	// Board pairs the ace so AK beats QQ; queens win nothing.
	board := []Card{
		MustParseCardString("Ac"),
		MustParseCardString("3d"),
		MustParseCardString("7h"),
		MustParseCardString("8s"),
		MustParseCardString("Jd"),
	}
	showdown(t, g, board)

	// Main pot 150 split 75/75; side pot 100 to player 1 alone; player 2
	// keeps only its 100 refund.
	expectStacks(t, g, 75, 175, 100)
	if totalChips(g) != 350 {
		t.Fatalf("chips must be conserved (350), got %d", totalChips(g))
	}
}

// When only one player still has chips and everyone has matched the top bet,
// that player never gets a turn: nobody can respond, so acting would have no
// effect. Betting stops and the board is run out street by street.
func TestLonePlayerWithChipsGetsNoTurn(t *testing.T) {
	g := sitDown(t, 100, 300)

	shove(t, g, 0) // button shoves 100
	call(t, g, 1)  // BB calls, keeps 200 behind

	if g.getBetting() {
		t.Fatalf("betting should be off: the caller has nobody left to act against")
	}
	if g.getStage() != PreFlop {
		t.Fatalf("no street should be dealt via a betting round, got stage %d", g.getStage())
	}
	// The board is revealed through the runout path (flop, turn, river) and
	// no bet is accepted from the lone player at any point.
	for _, want := range []GameStage{Flop, Turn, River} {
		if err := RunoutNext(g); err != nil {
			t.Fatalf("runout: %v", err)
		}
		if g.getStage() != want || g.getBetting() {
			t.Fatalf("expected stage %d with betting off, got stage %d betting=%v", want, g.getStage(), g.getBetting())
		}
		if err := Bet(g, 1, 0); err == nil {
			t.Fatalf("lone player must not be able to act during the runout")
		}
	}
	if err := RunoutNext(g); err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if g.getStage() != Showdown {
		t.Fatalf("expected Showdown, got %d", g.getStage())
	}
	if err := SettleShowdown(g); err != nil {
		t.Fatalf("settle: %v", err)
	}
	if totalChips(g) != 400 {
		t.Fatalf("chips must be conserved (400), got %d", totalChips(g))
	}
}

// The turn is kept when it does have an effect: the lone player with chips
// still owes money to a short all-in and must call or fold.
func TestLonePlayerStillActsWhenOwingChips(t *testing.T) {
	g := sitDown(t, 100, 300)

	// BB (player 1) is not yet matched by the button's shove of 100 → player 1
	// must act.
	shove(t, g, 0)
	if !g.getBetting() || g.actionNum != 1 {
		t.Fatalf("player 1 owes 98 and must get a turn, betting=%v action=%d", g.getBetting(), g.actionNum)
	}
	if err := Fold(g, 1, 0); err != nil {
		t.Fatalf("fold: %v", err)
	}
	if g.getStage() != Showdown {
		t.Fatalf("expected the shove to win uncontested, got stage %d", g.getStage())
	}
}

// Odd-chip rule, heads-up tie: player 0 (button) and player 2 tie for a
// 201-chip pot (the small blind folded its 1 chip). The odd chip goes to the
// first winner after the button, player 2.
func TestOddChipGoesToFirstAfterButton(t *testing.T) {
	g := sitDown(t, 100, 300, 100)
	g.players[0].Cards = cards("As", "Kd")
	g.players[2].Cards = cards("Ah", "Kc")

	shove(t, g, 0) // button/UTG shoves 100
	if err := Fold(g, 1, 0); err != nil {
		t.Fatalf("sb fold: %v", err)
	}
	call(t, g, 2) // BB calls all-in: pot is 100 + 1 + 100 = 201

	if len(g.pots) != 1 || g.pots[0].Amt != 201 {
		t.Fatalf("expected a 201-chip pot, got %+v", g.pots)
	}
	showdown(t, g, dryBoard)

	expectStacks(t, g, 100, 299, 101)
	if totalChips(g) != 500 {
		t.Fatalf("chips must be conserved (500), got %d", totalChips(g))
	}
	if g.players[2].Stats.MaxPotWon != 101 || g.players[0].Stats.MaxPotWon != 100 {
		t.Fatalf("max pot won should reflect the odd chip: p0=%d p2=%d",
			g.players[0].Stats.MaxPotWon, g.players[2].Stats.MaxPotWon)
	}
}

// Odd-chip rule, three-way tie with two leftover chips: they go one each to
// the first two winners clockwise from the button; the button gets none.
func TestTwoOddChipsHandedOutClockwise(t *testing.T) {
	// Player 0 button, 1 SB, 2 BB, 3 UTG (acts first).
	g := sitDown(t, 100, 100, 100, 300)
	g.players[0].Cards = cards("As", "Kd")
	g.players[1].Cards = cards("Ah", "Kc")
	g.players[2].Cards = cards("Ad", "Ks")

	call(t, g, 3) // UTG limps 2
	shove(t, g, 0)
	shove(t, g, 1)
	shove(t, g, 2)
	if err := Fold(g, 3, 0); err != nil {
		t.Fatalf("utg fold: %v", err)
	}

	// 100 × 3 + 2 dead = 302: split 100 each with 2 chips left over.
	if len(g.pots) != 1 || g.pots[0].Amt != 302 {
		t.Fatalf("expected a 302-chip pot, got %+v", g.pots)
	}
	showdown(t, g, dryBoard)

	expectStacks(t, g, 100, 101, 101, 298)
	if totalChips(g) != 600 {
		t.Fatalf("chips must be conserved (600), got %d", totalChips(g))
	}
}

// Side pots built over several streets: preflop everyone calls 10, on the
// flop the short stack shoves the rest and the others go all-in over it. The
// per-street bets must be totalled correctly when capping each pot.
func TestSidePotsAcrossStreets(t *testing.T) {
	g := sitDown(t, 60, 150, 400)
	g.players[0].Cards = cards("As", "Ah")
	g.players[1].Cards = cards("Ks", "Kh")
	g.players[2].Cards = cards("Qs", "Qh")

	// Preflop: dealer raises to 10, both blinds call.
	if err := Bet(g, 0, 10); err != nil {
		t.Fatalf("open: %v", err)
	}
	call(t, g, 1)
	call(t, g, 2)
	if g.getStage() != Flop {
		t.Fatalf("expected flop, got %d", g.getStage())
	}

	// Flop (SB acts first): player 1 bets 40, player 2 raises to 140, player 0
	// calls all-in for its remaining 50, player 1 calls all-in for 140 total.
	if err := Bet(g, 1, 40); err != nil {
		t.Fatalf("bet: %v", err)
	}
	if err := Bet(g, 2, 140); err != nil {
		t.Fatalf("raise: %v", err)
	}
	call(t, g, 0) // 50 more: total 60
	call(t, g, 1) // 100 more: total 150

	// Totals: 60 / 150 / 150. Main pot 180 (all), side pot 180 (players 1, 2).
	if len(g.pots) != 2 || g.pots[0].Amt != 180 || g.pots[1].Amt != 180 {
		t.Fatalf("expected pots 180 + 180, got %+v", g.pots)
	}
	if len(g.pots[0].EligiblePlayerNums) != 3 || len(g.pots[1].EligiblePlayerNums) != 2 {
		t.Fatalf("eligibility wrong: %+v", g.pots)
	}

	showdown(t, g, dryBoard)
	// Aces take the main pot (180); kings take the side pot (180); player 2
	// keeps the 250 it never bet.
	expectStacks(t, g, 180, 180, 250)
	if totalChips(g) != 610 {
		t.Fatalf("chips must be conserved (610), got %d", totalChips(g))
	}
}
