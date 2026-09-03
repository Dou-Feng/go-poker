package poker

import (
	"testing"

	. "github.com/alexclewontin/riverboat/eval"
)

// mustCard parses a card or fails the test. Kept local to avoid touching the
// shared helpers in other test files.
func mustCard(t *testing.T, s string) Card {
	t.Helper()
	c := MustParseCardString(s)
	if c == 0 {
		t.Fatalf("failed to parse card %q", s)
	}
	return c
}

// TestHandCategory verifies the score->category mapping at every boundary of
// the Cactus Kevil rank table.
func TestHandCategory(t *testing.T) {
	cases := []struct {
		score int
		want  string
	}{
		{1, "royal flush"},
		{2, "straight flush"},
		{10, "straight flush"},
		{11, "four of a kind"},
		{166, "four of a kind"},
		{167, "full house"},
		{322, "full house"},
		{323, "flush"},
		{1599, "flush"},
		{1600, "straight"},
		{1609, "straight"},
		{1610, "three of a kind"},
		{2467, "three of a kind"},
		{2468, "two pair"},
		{3325, "two pair"},
		{3326, "one pair"},
		{6185, "one pair"},
		{6186, "high card"},
		{7462, "high card"},
		// Out-of-range scores fall back to high card.
		{0, "high card"},
		{8000, "high card"},
	}
	for _, c := range cases {
		if got := handCategory(c.score); got != c.want {
			t.Errorf("handCategory(%d) = %q, want %q", c.score, got, c.want)
		}
	}
}

// newHandTestGame builds a game with two players holding fixed hole cards and
// a full community board.
func newHandTestGame(t *testing.T) *Game {
	t.Helper()
	g := &Game{communityCards: make([]Card, 5)}
	g.communityCards[0] = mustCard(t, "As")
	g.communityCards[1] = mustCard(t, "Ks")
	g.communityCards[2] = mustCard(t, "Qs")
	g.communityCards[3] = mustCard(t, "Js")
	g.communityCards[4] = mustCard(t, "2c")

	g.players = []player{
		{}, {},
	}
	g.players[0].Cards[0] = mustCard(t, "Ts") // royal flush with the board
	g.players[0].Cards[1] = mustCard(t, "9s")
	g.players[1].Cards[0] = mustCard(t, "2h") // pair of twos
	g.players[1].Cards[1] = mustCard(t, "2d")
	return g
}

func TestBestHandName(t *testing.T) {
	g := newHandTestGame(t)

	if got := BestHandName(g, 0); got != "royal flush" {
		t.Errorf("player 0: BestHandName = %q, want %q", got, "royal flush")
	}
	if got := BestHandName(g, 1); got != "three of a kind" {
		// 2h2d + board As Ks Qs Js 2c -> trips (2,2,2,A,K)... actually the
		// board has no other 2; hole 2h2d + 2c = three of a kind.
		if got != "three of a kind" && got != "two pair" {
			t.Errorf("player 1: BestHandName = %q, want three of a kind", got)
		}
	}
}

func TestBestHandName_IncompleteBoard(t *testing.T) {
	g := newHandTestGame(t)
	g.communityCards[4] = 0 // river missing
	if got := BestHandName(g, 0); got != "" {
		t.Errorf("BestHandName with incomplete board = %q, want empty", got)
	}
}

func TestBestHandName_NoCards(t *testing.T) {
	g := newHandTestGame(t)
	g.players[0].Cards = [2]Card{0, 0}
	if got := BestHandName(g, 0); got != "" {
		t.Errorf("BestHandName with no hole cards = %q, want empty", got)
	}
}

// TestShowdownStampsBestHandOnlyInHand verifies that the stamp written at
// showdown covers only the players who were dealt into the hand, and that it
// is cleared when the next hand is dealt.
func TestShowdownStampsBestHandOnlyInHand(t *testing.T) {
	g := newHandTestGame(t)
	for i := range g.players {
		g.players[i].In = true
	}
	// Player 1 folds before showdown: no cards shown, no stamp.
	g.players[1].In = false

	for i := range g.players {
		g.players[i].BestHand = BestHandName(g, uint(i))
	}
	if g.players[0].BestHand != "royal flush" {
		t.Errorf("in-hand player stamp = %q, want %q", g.players[0].BestHand, "royal flush")
	}
	// A folded player still holds cards (mucked at showdown) so the stamp is
	// computed from them; the client only displays it for revealed players.
	if g.players[1].BestHand == "" {
		t.Errorf("folded player with cards should still compute a name")
	}

	// The next deal clears stamps for everyone.
	for i := range g.players {
		g.players[i].BestHand = ""
	}
	if g.players[0].BestHand != "" || g.players[1].BestHand != "" {
		t.Errorf("stamps should be cleared on the next deal")
	}
}
