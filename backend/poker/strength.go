package poker

import (
	"github.com/alexclewontin/riverboat/eval"
)

// Card helpers over the evaluator's 32-bit encoding (see Card.tsx for the
// layout): rank in bits 8..11 (0 = deuce … 12 = ace), one suit bit in 12..15.

// CardRank returns 0 (deuce) … 12 (ace).
func CardRank(c eval.Card) int {
	return (int(c) >> 8) & 0x0f
}

// CardSuit returns the suit bit (0x1000, 0x2000, 0x4000 or 0x8000).
func CardSuit(c eval.Card) int {
	return int(c) & 0xf000
}

// HandCategory names a Cactus-Kev style score (1 best … 7462 worst).
func HandCategory(score int) string {
	return handCategory(score)
}

// HandStrength evaluates two hole cards against however much of the board is
// dealt (3, 4 or 5 cards; zero entries are undealt). It returns the best
// five-card score (lower is better) and its category name. With fewer than
// three board cards there is no five-card hand yet: score 0 and "" are
// returned and callers fall back to a preflop heuristic.
func HandStrength(hole [2]eval.Card, board []eval.Card) (int, string) {
	if hole[0] == 0 || hole[1] == 0 {
		return 0, ""
	}
	dealt := make([]eval.Card, 0, 5)
	for _, c := range board {
		if c != 0 {
			dealt = append(dealt, c)
		}
	}
	var score int
	switch len(dealt) {
	case 3:
		score = eval.HandValue(hole[0], hole[1], dealt[0], dealt[1], dealt[2])
	case 4:
		_, score = eval.BestFiveOfSix(hole[0], hole[1], dealt[0], dealt[1], dealt[2], dealt[3])
	case 5:
		_, score = eval.BestFiveOfSeven(hole[0], hole[1], dealt[0], dealt[1], dealt[2], dealt[3], dealt[4])
	default:
		return 0, ""
	}
	return score, handCategory(score)
}
