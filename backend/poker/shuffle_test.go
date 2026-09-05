package poker

import (
	"testing"

	"github.com/alexclewontin/riverboat/eval"
)

// shuffleDeck must produce the full 52-card deck in a fresh random order
// every call: no card lost, none duplicated, and consecutive shuffles do not
// repeat (crypto/rand seeding makes a repeat astronomically unlikely).
func TestShuffleDeck(t *testing.T) {
	g := &Game{}

	if err := g.shuffleDeck(); err != nil {
		t.Fatalf("shuffleDeck: %v", err)
	}
	first := append([]eval.Card{}, g.deck...) // copy before the second shuffle overwrites it

	if err := g.shuffleDeck(); err != nil {
		t.Fatalf("shuffleDeck: %v", err)
	}

	if len(g.deck) != 52 || len(first) != 52 {
		t.Fatalf("deck length = %d / %d, want 52 / 52", len(first), len(g.deck))
	}

	seen := make(map[eval.Card]bool)
	for _, c := range g.deck {
		if seen[c] {
			t.Fatalf("duplicate card %d after shuffle", c)
		}
		seen[c] = true
	}

	sameOrder := true
	for i := range g.deck {
		if g.deck[i] != first[i] {
			sameOrder = false
			break
		}
	}
	if sameOrder {
		t.Fatal("two consecutive shuffles produced the identical order")
	}
}
