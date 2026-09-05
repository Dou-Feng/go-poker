package poker

import (
	"github.com/alexclewontin/riverboat/eval"
)

// GameView is the type that represents a snapshot of a Game's state.
type GameView struct {
	Running           bool        `json:"running"`
	DealerNum         uint        `json:"dealer"`
	ActionNum         uint        `json:"action"`
	UTGNum            uint        `json:"utg"`
	SBNum             uint        `json:"sb"`
	BBNum             uint        `json:"bb"`
	CommunityCards    []eval.Card `json:"communityCards"`
	Stage             GameStage   `json:"stage"`
	Betting           bool        `json:"betting"`
	Config            GameConfig  `json:"config"`
	Players           []player    `json:"players"`
	DepartedPlayers   []player    `json:"departedPlayers"`
	Deck              eval.Deck   `json:"-"`
	Pots              []Pot       `json:"pots"`
	MinRaise          uint        `json:"minRaise"`
	ReadyCount        uint        `json:"readyCount"`
	HandsPlayed       uint        `json:"handsPlayed"`
	BiggestPotAmt     uint        `json:"biggestPotAmt"`
	BiggestPotWinners []uint      `json:"biggestPotWinners"`
}

func cardReader(cards []eval.Card) []string {
	var readable []string
	for _, c := range cards {
		readable = append(readable, c.String())
	}
	return readable
}

func (g *Game) copyToView() *GameView {
	//TODO: Is there some way to do this programatically? I considered using
	// reflection, but since that happens at runtime it is less performant.
	// Something like reflection, but evaluated at compile-time would be ideal
	// Probably using go generate.

	//WARNING: This needs to be the deepest of deep copies. If adding a field,
	//make sure that it is. An example: copying a slice of structs, where the struct
	//has a field that is a slice: this doesn't work by default. Write a helper function.
	view := &GameView{
		Running:           g.getRunning(),
		DealerNum:         g.dealerNum,
		ActionNum:         g.actionNum,
		UTGNum:            g.utgNum,
		SBNum:             g.sbNum,
		BBNum:             g.bbNum,
		CommunityCards:    append([]eval.Card{}, g.communityCards...),
		Stage:             g.getStage(),
		Betting:           g.getBetting(),
		Config:            g.config,
		Players:           append([]player{}, g.players...),
		DepartedPlayers:   append([]player{}, g.departedPlayers...),
		Deck:              append([]eval.Card{}, g.deck...),
		Pots:              copyPots(g.pots),
		MinRaise:          g.minRaise,
		ReadyCount:        g.readyCount(),
		HandsPlayed:       g.handsPlayed,
		BiggestPotAmt:     g.biggestPotAmt,
		BiggestPotWinners: append([]uint{}, g.biggestPotWinners...),
	}

	// Showdown annotation: the hand name is stamped onto players at
	// showdown time (see updateRoundInfo) and persists on the player until
	// the next hand deals, so clients can display it during their showdown
	// window.
	return view
}

func copyPots(src []Pot) []Pot {
	ret := make([]Pot, len(src))
	for i := range src {
		ret[i].Amt = src[i].Amt
		ret[i].TopShare = src[i].TopShare
		ret[i].WinningScore = src[i].WinningScore
		ret[i].EligiblePlayerNums = append([]uint{}, src[i].EligiblePlayerNums...)
		ret[i].WinningPlayerNums = append([]uint{}, src[i].WinningPlayerNums...)
		ret[i].WinningHand = append([]eval.Card{}, src[i].WinningHand...)
	}

	return ret
}

// FillFromView is primarily for loading a stored view from a persistence layer
func (g *Game) FillFromView(gv *GameView) {
	g.mtx.Lock()
	defer g.mtx.Unlock()

	g.dealerNum = gv.DealerNum
	g.actionNum = gv.ActionNum
	g.utgNum = gv.UTGNum
	g.bbNum = gv.BBNum
	g.sbNum = gv.SBNum
	g.communityCards = append([]eval.Card{}, gv.CommunityCards...)
	g.setStageAndBetting(gv.Stage, gv.Betting)
	g.config = gv.Config
	g.players = append([]player{}, gv.Players...)
	g.departedPlayers = append([]player{}, gv.DepartedPlayers...)
	g.deck = append([]eval.Card{}, gv.Deck...)
	g.pots = copyPots(gv.Pots)
	g.minRaise = gv.MinRaise
}

// GeneratePlayerView is primarily for creating a view that can be serialized for delivery to a specific player
// The generated view holds only the information that the player denoted by pn is entitled to see at the moment it is generated.
func (g *Game) GeneratePlayerView(pn uint) *GameView {
	g.mtx.Lock()
	defer g.mtx.Unlock()

	gv := g.copyToView()
	gv.Deck = nil

	return gv.CensorFor(pn)
}

// ViewerNum returns the player number of the seat held by viewerUUID, or a
// value outside the player list for spectators and unknown viewers.
func (gv *GameView) ViewerNum(viewerUUID string) uint {
	for i := range gv.Players {
		if gv.Players[i].UUID == viewerUUID {
			return uint(i)
		}
	}
	return uint(len(gv.Players))
}

// CensorFor returns a copy of gv showing only the hole cards the viewer pn is
// entitled to see: their own cards while they still hold them, cards flagged
// Revealed (a voluntary show, or an all-in player who left), and — once the
// hand reaches the showdown stage — every player eligible for a contested pot.
// The showdown set mirrors the clients' reveal logic (getRevealedPlayers in
// web/components/Table.tsx): a pot only contested by one player reveals
// nothing. A pn outside the player list (spectator) sees only revealed cards.
// Departed players' cards are always hidden.
func (gv *GameView) CensorFor(pn uint) *GameView {
	out := *gv
	out.Players = append([]player{}, gv.Players...)
	out.DepartedPlayers = append([]player{}, gv.DepartedPlayers...)

	// Reveal the showdown participants only when at least one pot was
	// actually contested (side pots may have different eligible players).
	showdown := gv.Stage == Showdown
	if showdown {
		contested := false
		for _, pot := range gv.Pots {
			if len(pot.EligiblePlayerNums) > 1 {
				contested = true
				break
			}
		}
		showdown = contested
	}

	for i := range out.Players {
		p := &out.Players[i]
		holdsCards := p.Cards[0] != 0 || p.Cards[1] != 0
		visible := p.Revealed ||
			(uint(i) == pn && holdsCards) ||
			(showdown && eligibleForAnyPot(gv.Pots, p.Position))
		if !visible {
			p.Cards = [2]eval.Card{0, 0}
		}
	}

	for i := range out.DepartedPlayers {
		out.DepartedPlayers[i].Cards = [2]eval.Card{0, 0}
	}

	return &out
}

func eligibleForAnyPot(pots []Pot, position uint) bool {
	for _, pot := range pots {
		for _, num := range pot.EligiblePlayerNums {
			if num == position {
				return true
			}
		}
	}
	return false
}

// GenerateOmniView is primarily for creating a view that can be serialized for delivery to a persistance layer, like a db or in-memory store
// Nothing is censored, not even the contents of the deck
func (g *Game) GenerateOmniView() *GameView {
	g.mtx.Lock()
	defer g.mtx.Unlock()

	return g.copyToView()

}
