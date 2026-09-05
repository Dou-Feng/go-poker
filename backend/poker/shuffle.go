package poker

import (
	crand "crypto/rand"
	"fmt"
	mrand "math/rand/v2"

	"github.com/alexclewontin/riverboat/eval"
)

// shuffleDeck resets g.deck to a fresh copy of the full 52-card deck in a
// uniformly random order. The ChaCha8 generator is seeded from crypto/rand
// once per hand, so the deal is unpredictable even to an attacker who knows
// the source code and the process start time — unlike eval.Deck.Shuffle,
// which draws from the global math/rand source (downgraded to the legacy
// lagged-Fibonacci generator by that package's rand.Seed(time.Now()) init).
func (g *Game) shuffleDeck() error {
	g.deck = append([]eval.Card{}, eval.DefaultDeck...)

	var seed [32]byte
	if _, err := crand.Read(seed[:]); err != nil {
		return fmt.Errorf("seeding shuffle: %w", err)
	}
	rng := mrand.New(mrand.NewChaCha8(seed))
	rng.Shuffle(len(g.deck), func(i, j int) { g.deck[i], g.deck[j] = g.deck[j], g.deck[i] })
	return nil
}
