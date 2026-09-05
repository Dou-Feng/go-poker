package poker

import (
	"testing"

	"github.com/alexclewontin/riverboat/eval"
)

// censorTestView builds a three-player view holding distinct cards. players
// marked in the mask are still in the hand.
func censorTestView(stage GameStage) *GameView {
	deck := eval.DefaultDeck
	mk := func(i int, uuid string, in bool) player {
		p := player{UUID: uuid, Position: uint(i)}
		p.Cards = [2]eval.Card{deck[2*i], deck[2*i+1]}
		if in {
			p.setState(PlayerPlaying)
		}
		return p
	}
	return &GameView{
		Stage: stage,
		Players: []player{
			mk(0, "p0", true),
			mk(1, "p1", true),
			mk(2, "p2", false), // folded
		},
	}
}

func cardsHidden(gv *GameView, pn uint) bool {
	return gv.Players[pn].Cards == [2]eval.Card{0, 0}
}

func TestCensorForDuringHand(t *testing.T) {
	gv := censorTestView(Flop)

	// A player sees their own cards but nobody else's.
	v0 := gv.CensorFor(0)
	if cardsHidden(v0, 0) {
		t.Error("viewer's own cards were hidden mid-hand")
	}
	if !cardsHidden(v0, 1) || !cardsHidden(v0, 2) {
		t.Error("opponent cards leaked mid-hand")
	}
	if cardsHidden(gv, 0) {
		t.Error("CensorFor mutated the source view")
	}

	// A spectator (pn outside the player list) sees nobody's cards.
	spec := gv.CensorFor(uint(len(gv.Players)))
	if !cardsHidden(spec, 0) || !cardsHidden(spec, 1) || !cardsHidden(spec, 2) {
		t.Error("spectator received hole cards")
	}
}

func TestCensorForRevealedFlag(t *testing.T) {
	gv := censorTestView(Flop)
	gv.Players[1].Revealed = true // voluntary show / all-in departure

	spec := gv.CensorFor(uint(len(gv.Players)))
	if cardsHidden(spec, 1) {
		t.Error("revealed cards were hidden")
	}
	if !cardsHidden(spec, 0) {
		t.Error("unrevealed cards leaked via Revealed player")
	}
}

func TestCensorForShowdown(t *testing.T) {
	gv := censorTestView(Showdown)
	// One contested pot: p0 and p1 eligible, folded p2 not.
	gv.Pots = []Pot{{EligiblePlayerNums: []uint{0, 1}}}

	spec := gv.CensorFor(uint(len(gv.Players)))
	if cardsHidden(spec, 0) || cardsHidden(spec, 1) {
		t.Error("showdown participants were not revealed")
	}
	if !cardsHidden(spec, 2) {
		t.Error("folded player's cards leaked at showdown")
	}
}

func TestCensorForShowdownUncontested(t *testing.T) {
	gv := censorTestView(Showdown)
	// Everyone folded to p0: no pot has two eligible players, nothing reveals.
	gv.Pots = []Pot{{EligiblePlayerNums: []uint{0}}}

	spec := gv.CensorFor(uint(len(gv.Players)))
	if !cardsHidden(spec, 0) || !cardsHidden(spec, 1) {
		t.Error("cards revealed without a contested pot")
	}
}

func TestCensorForDepartedPlayers(t *testing.T) {
	gv := censorTestView(Flop)
	gv.DepartedPlayers = append(gv.DepartedPlayers, player{
		UUID:     "gone",
		Position: 7,
		Cards:    [2]eval.Card{eval.DefaultDeck[10], eval.DefaultDeck[11]},
	})

	for _, pn := range []uint{0, 1, 2, 3} {
		if got := gv.CensorFor(pn).DepartedPlayers[0].Cards; got != [2]eval.Card{0, 0} {
			t.Errorf("departed player's cards leaked to viewer %d", pn)
		}
	}
}

func TestViewerNum(t *testing.T) {
	gv := censorTestView(Flop)
	if got := gv.ViewerNum("p1"); got != 1 {
		t.Errorf("ViewerNum(p1) = %d, want 1", got)
	}
	if got := gv.ViewerNum("nobody"); got != uint(len(gv.Players)) {
		t.Errorf("ViewerNum(unknown) = %d, want %d", got, len(gv.Players))
	}
}
