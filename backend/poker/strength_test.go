package poker

import (
	"testing"

	"github.com/alexclewontin/riverboat/eval"
)

func card(s string) eval.Card { return eval.MustParseCardString(s) }

func TestCardRankAndSuit(t *testing.T) {
	if CardRank(card("2c")) != 0 || CardRank(card("Ah")) != 12 || CardRank(card("Td")) != 8 {
		t.Fatalf("rank mapping wrong: 2c=%d Ah=%d Td=%d", CardRank(card("2c")), CardRank(card("Ah")), CardRank(card("Td")))
	}
	suits := map[int]bool{}
	for _, s := range []string{"As", "Ah", "Ad", "Ac"} {
		suits[CardSuit(card(s))] = true
	}
	if len(suits) != 4 {
		t.Fatalf("four suits must map to four distinct bits, got %v", suits)
	}
	if CardSuit(card("As")) != CardSuit(card("2s")) {
		t.Fatalf("same suit must share the bit")
	}
}

// Partial boards evaluate with 5, 6 or 7 cards; preflop yields no hand yet.
func TestHandStrengthAcrossStreets(t *testing.T) {
	hole := [2]eval.Card{card("Ah"), card("Kh")}
	if s, name := HandStrength(hole, []eval.Card{0, 0, 0, 0, 0}); s != 0 || name != "" {
		t.Fatalf("preflop must have no five-card hand, got %d %q", s, name)
	}
	if _, name := HandStrength(hole, []eval.Card{card("Qh"), card("Jh"), card("Th"), 0, 0}); name != "royal flush" {
		t.Fatalf("flop royal: %q", name)
	}
	if _, name := HandStrength(hole, []eval.Card{card("Ad"), card("Kc"), card("2s"), card("9d"), 0}); name != "two pair" {
		t.Fatalf("turn two pair: %q", name)
	}
	if _, name := HandStrength(hole, []eval.Card{card("2c"), card("7d"), card("9s"), card("4h"), card("Jc")}); name != "high card" {
		t.Fatalf("river high card: %q", name)
	}
	better, _ := HandStrength([2]eval.Card{card("As"), card("Ad")}, []eval.Card{card("2c"), card("7d"), card("9s"), 0, 0})
	worse, _ := HandStrength([2]eval.Card{card("3s"), card("3d")}, []eval.Card{card("2c"), card("7d"), card("9s"), 0, 0})
	if !(better < worse) {
		t.Fatalf("aces (%d) must score better (lower) than treys (%d)", better, worse)
	}
	if s, name := HandStrength([2]eval.Card{0, card("Ad")}, []eval.Card{card("2c"), card("7d"), card("9s"), 0, 0}); s != 0 || name != "" {
		t.Fatalf("missing hole card must yield nothing, got %d %q", s, name)
	}
	if HandCategory(1) != "royal flush" || HandCategory(7462) != "high card" {
		t.Fatalf("HandCategory must expose the score mapping")
	}
}
