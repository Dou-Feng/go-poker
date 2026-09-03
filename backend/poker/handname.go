package poker

import (
	. "github.com/alexclewontin/riverboat/eval"
)

// handCategory maps a Cactus-Kevil-style hand rank (the score returned by
// BestFiveOfSeven, 1 = royal flush … 7462 = worst high card) to a category
// name. Lower is better. Scores outside [1, 7462] (e.g. the 8000 sentinel
// used for undecided pots, or 0) return "high card" as a safe fallback.
func handCategory(score int) string {
	switch {
	case score < 1 || score > 7462:
		return "high card"
	case score == 1:
		return "royal flush"
	case score <= 10:
		return "straight flush"
	case score <= 166:
		return "four of a kind"
	case score <= 322:
		return "full house"
	case score <= 1599:
		return "flush"
	case score <= 1609:
		return "straight"
	case score <= 2467:
		return "three of a kind"
	case score <= 3325:
		return "two pair"
	case score <= 6185:
		return "one pair"
	default:
		return "high card"
	}
}

// BestHandName computes the name of the best five-card hand a player can make
// from their two hole cards plus the community cards. It returns an empty
// string when the board is incomplete.
func BestHandName(g *Game, pn uint) string {
	p := g.players[pn]
	if p.Cards[0] == 0 || p.Cards[1] == 0 {
		return ""
	}
	for _, c := range g.communityCards {
		if c == 0 {
			return ""
		}
	}
	_, score := BestFiveOfSeven(
		p.Cards[0],
		p.Cards[1],
		g.communityCards[0],
		g.communityCards[1],
		g.communityCards[2],
		g.communityCards[3],
		g.communityCards[4],
	)
	return handCategory(score)
}
