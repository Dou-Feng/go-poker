package poker

import (
	"math"
	"sort"
	"sync"

	. "github.com/alexclewontin/riverboat/eval"
)

// (52 - 5) / 2. I mean, if you really want to...
const maxPlayers = 23

// Heads up!
const minPlayers = 2

type gameFlags uint8

/*
xxxxBSSS
--------
xxxxxxxx

SSS - Status
	000 : Nothing
	001 : PreDeal
	010 : PreFlop
	011 : Flop
	100 : Turn
	101 : River

B - Betting
	1 :Yes, still betting
	0: No, can advance
*/

type GameStage uint8

const (
	PreDeal GameStage = iota + 1
	PreFlop
	Flop
	Turn
	River
)

type Pot struct {
	TopShare           uint   `json:"topShare"`
	Amt                uint   `json:"amount"`
	EligiblePlayerNums []uint `json:"eligiblePlayerNums"`
	WinningPlayerNums  []uint `json:"winningPlayerNums"`
	WinningHand        []Card `json:"winningHand"`
	WinningScore       int    `json:"winningScore"`
}

type GameConfig struct {
	MaxBuy     uint `json:"maxBuy"`
	BigBlind   uint `json:"bb"`
	SmallBlind uint `json:"sb"`
	BuyIn      uint `json:"buyIn"`
	MaxPlayers uint `json:"maxPlayers"`
}

// Game represents a game of poker. It internally keeps track of state, can be mutated by actions,
// and will generate views of itself upon request. Games should not be initialized directly, only
// through the NewGame factory function.
type Game struct {
	mtx sync.Mutex

	running        bool
	dealerNum      uint
	actionNum      uint
	utgNum         uint
	sbNum          uint
	bbNum          uint
	communityCards []Card
	flags          gameFlags
	config         GameConfig
	players        []player
	deck           Deck
	pots           []Pot
	minRaise       uint
	calledNum      uint
	betsThisStreet uint
}

func (g *Game) getStage() GameStage {
	return GameStage(g.flags & 0x07)
}

func (g *Game) getBetting() bool {
	return (g.flags&0x08 == 0x08)
}

func (g *Game) getStageAndBetting() (GameStage, bool) {
	return g.getStage(), g.getBetting()
}

func (g *Game) setStage(s GameStage) {
	g.flags = gameFlags((uint8(g.flags) & 0xF8) | uint8(s))
}

func (g *Game) setBetting(b bool) {
	if b {
		g.flags = gameFlags(uint8(g.flags) | 0x08)
	} else {
		g.flags = gameFlags(uint8(g.flags) & 0xF7)
	}
}

func (g *Game) setStageAndBetting(s GameStage, b bool) {
	g.setStage(s)
	g.setBetting(b)
}

func (g *Game) getPlayer(pn uint) *player {
	return &g.players[pn]
}

func (g *Game) readyCount() uint {
	var readyCount uint = 0
	for _, p := range g.players {
		if p.Ready {
			readyCount++
		}
	}
	return readyCount
}

func (g *Game) isCalled(pn uint) bool {
	return g.players[pn].allIn() || (g.players[pn].Called)
}

//Returns nil if there are more than 2 players ready, ErrIllegalAction otherwise
func (g *Game) updateBlindNums() {
	readyCount := g.readyCount()

	if readyCount < 2 {
		g.bbNum = g.dealerNum
		g.sbNum = g.dealerNum
		g.utgNum = g.dealerNum

	} else if readyCount == 2 {
		g.sbNum = g.dealerNum
		g.utgNum = g.dealerNum
		g.bbNum = (g.dealerNum + 1) % uint(len(g.players))
		for !g.players[g.bbNum].Ready {
			g.bbNum = (g.bbNum + 1) % uint(len(g.players))
		}
	} else {
		g.sbNum = (g.dealerNum + 1) % uint(len(g.players))
		for !g.players[g.sbNum].Ready {
			g.sbNum = (g.sbNum + 1) % uint(len(g.players))
		}

		g.bbNum = (g.sbNum + 1) % uint(len(g.players))
		for !g.players[g.bbNum].Ready {
			g.bbNum = (g.bbNum + 1) % uint(len(g.players))
		}

		g.utgNum = (g.bbNum + 1) % uint(len(g.players))
		for !g.players[g.utgNum].Ready {
			g.utgNum = (g.utgNum + 1) % uint(len(g.players))
		}
	}
}

func (g *Game) toCall() uint {
	var val uint = 0

	for _, q := range g.players {
		if q.Bet > val {
			val = q.Bet
		}
	}

	return val
}

// positionLabel returns the preflop position bucket for the given player,
// relative to the current button. It is only meaningful after blinds are set.
func (g *Game) positionLabel(pn uint) PositionLabel {
	if pn == g.dealerNum {
		return PosBTN
	}
	if pn == g.sbNum {
		return PosSB
	}
	if pn == g.bbNum {
		return PosBB
	}

	n := uint(len(g.players))
	d := (pn + n - g.dealerNum) % n // seats clockwise from the button

	if d == 3 {
		return PosUTG
	}
	if d == n-1 {
		return PosCO
	}
	return PosMP
}

func (g *Game) getLimit() uint {
	//TODO: implement limits
	return uint(math.MaxUint64)
}

func (g *Game) canOpen(pn uint) bool {
	//TODO: placeholder stub, as limits on who can open betting will eventually be implemented
	return true
}

// dropPlayer removes the player at index pn from the game and remaps the
// position bookkeeping. It assumes the game mutex is held.
func (g *Game) dropPlayer(pn uint) {
	shift := func(n *uint) {
		if *n > pn {
			*n--
		} else if *n == pn {
			*n = 0
		}
	}
	shift(&g.dealerNum)
	shift(&g.sbNum)
	shift(&g.bbNum)
	shift(&g.utgNum)
	shift(&g.actionNum)

	g.players = append(g.players[:pn], g.players[pn+1:]...)

	// Re-index player positions after the removal.
	for i := range g.players {
		g.players[i].Position = uint(i)
	}
}

// RemovePlayer removes a player from the game entirely, freeing their seat.
// It is only safe to call when no hand is in progress (stage PreDeal).
func RemovePlayer(g *Game, pn uint) error {
	g.mtx.Lock()
	defer g.mtx.Unlock()

	if pn >= uint(len(g.players)) {
		return ErrOutOfBounds
	}
	g.dropPlayer(pn)
	if g.getStage() == PreDeal {
		g.updateBlindNums()
	}
	return nil
}

// ResetToReadyPhase puts the game back into the pre-game state without
// clearing player stacks: players who have left are dropped, everyone else
// becomes not-ready, and the hand state is cleared so players can rebuy and
// ready up again.
func ResetToReadyPhase(g *Game) {
	g.mtx.Lock()
	defer g.mtx.Unlock()

	// Drop players who have left the room (e.g. offline timeout).
	for i := len(g.players) - 1; i >= 0; i-- {
		if g.players[i].Left {
			g.dropPlayer(uint(i))
		}
	}

	g.running = false
	g.pots = []Pot{}
	g.communityCards = make([]Card, 5)
	g.deck = DefaultDeck
	g.setStageAndBetting(PreDeal, false)

	for i := range g.players {
		g.players[i].Ready = false
		g.players[i].In = false
		g.players[i].Called = false
		g.players[i].Bet = 0
		g.players[i].TotalBet = 0
		g.players[i].Cards = [2]Card{0, 0}
		g.players[i].Left = false
	}

	if len(g.players) > 0 {
		g.updateBlindNums()
	}
}

func (g *Game) resetForNextHand() {

	// Remove players who have left the room (iterate backwards so indices
	// stay valid while dropping).
	for i := len(g.players) - 1; i >= 0; i-- {
		if g.players[i].Left {
			g.dropPlayer(uint(i))
		}
	}

	if len(g.players) == 0 {
		g.setStageAndBetting(PreDeal, false)
		return
	}

	for i := range g.players {
		g.players[i].Bet = 0
		g.players[i].TotalBet = 0

		if g.players[i].Stack == 0 {
			g.players[i].Ready = false
		}

	}

	g.dealerNum = (g.dealerNum + 1) % uint(len(g.players))
	n := uint(len(g.players))
	seen := uint(0)
	for !g.players[g.dealerNum].Ready && seen < n {
		g.dealerNum = (g.dealerNum + 1) % n
		seen++
	}

	g.setStageAndBetting(PreDeal, false)
}

func (g *Game) updateRoundInfo() {

	var allCalled = true
	var allInPlayerNums = []uint{}
	var inPlayerNums = []uint{}

	for i, p := range g.players {
		if p.In {
			inPlayerNums = append(inPlayerNums, uint(i))
			if p.allIn() {
				allInPlayerNums = append(allInPlayerNums, uint(i))
			} else if !g.isCalled(uint(i)) {
				allCalled = false
			}
		}
	}

	// Update the pot information

	sort.Slice(allInPlayerNums, func(i, j int) bool {
		return g.players[allInPlayerNums[i]].TotalBet < g.players[allInPlayerNums[j]].TotalBet
	}) //here, the whole slice needs to be sorted by the totalBet amount of the players represented

	tmpPlayers := append([]player{}, g.players...)
	g.pots = []Pot{}
	for _, pn := range allInPlayerNums {

		newPot := Pot{}
		newPot.TopShare = tmpPlayers[pn].TotalBet

		for i := range tmpPlayers {

			if tmpPlayers[i].TotalBet >= newPot.TopShare {
				if tmpPlayers[i].In {
					newPot.EligiblePlayerNums = append(newPot.EligiblePlayerNums, uint(i))
				}
				newPot.Amt += newPot.TopShare
				tmpPlayers[i].TotalBet -= newPot.TopShare
			} else {
				newPot.Amt += tmpPlayers[i].TotalBet
				tmpPlayers[i].TotalBet = 0
			}
		}

		g.pots = append(g.pots, newPot)
	}

	//The above takes care of all the all-in side pots. One last pot for the non-all-in people

	var finalPot Pot
	finalPot.EligiblePlayerNums = []uint{}

	for i, p := range tmpPlayers {
		finalPot.Amt += p.TotalBet
		if p.In && !p.allIn() {
			finalPot.EligiblePlayerNums = append(finalPot.EligiblePlayerNums, uint(i))
		}
	}

	g.pots = append(g.pots, finalPot)

	// If less than two players are still in, the hand has been conceded
	if len(inPlayerNums) < 2 {
		//the sole number in the array is the winner by default
		//TODO: Create a pot here to simplify sending result description

		// add player as winner
		for i := range g.pots {
			g.pots[i].WinningScore = 8000
			g.pots[i].WinningPlayerNums = inPlayerNums
		}

		// But this is special because cards do not need to be shown
		var won uint = 0
		for _, p := range g.players {
			won += p.TotalBet
			g.players[inPlayerNums[0]].Stack += p.TotalBet
		}
		g.players[inPlayerNums[0]].Stats.HandsWon++
		if won > g.players[inPlayerNums[0]].Stats.MaxPotWon {
			g.players[inPlayerNums[0]].Stats.MaxPotWon = won
		}

		g.resetForNextHand()

		return
	}

	// If two or more players are in, but not everybody has called
	if !allCalled {
		// just move action to next player
		for g.isCalled(g.actionNum) || !g.players[g.actionNum].In {
			g.actionNum = (g.actionNum + 1) % uint(len(g.players))
		}

		return
	}

	//If there are two or more players in, and everybody has either called or is all-in, and at this point we determine that only one player is
	//in but not all in, we take all the money above and beyond the second highest better (who is all in) and return it to the people who bet it
	//If the only players in are both all in for the exact same amount of money, nothing happens here
	//(but we can't skip in the "0 not all in" case because technically before this step happens a player who after this step may read as not all in
	//could return true for the isAllIn method)
	if (len(inPlayerNums) - len(allInPlayerNums)) < 2 {
		var topBettor1 uint = 0
		var topBettor2 uint = 0
		// TODO: what if everyone is all in?
		for _, ndx := range inPlayerNums {
			if g.players[ndx].TotalBet > g.players[topBettor1].TotalBet {
				topBettor2 = topBettor1
				topBettor1 = ndx
			} else if g.players[ndx].TotalBet > g.players[topBettor2].TotalBet {
				topBettor2 = ndx
			}
		}

		g.players[topBettor1].returnChips(g.players[topBettor1].TotalBet - g.players[topBettor2].TotalBet)
	}

	//If there are two or more players in, and everybody has called or is all in, then end the hand f we've just finished river betting
	if g.getStage() == River {

		for i := range g.pots {
			g.pots[i].WinningScore = 8000

			for _, num := range g.pots[i].EligiblePlayerNums {

				hand, score := BestFiveOfSeven(
					g.players[num].Cards[0],
					g.players[num].Cards[1],
					g.communityCards[0],
					g.communityCards[1],
					g.communityCards[2],
					g.communityCards[3],
					g.communityCards[4],
				)
				// lower is better for the score
				if score < g.pots[i].WinningScore {
					g.pots[i].WinningScore = score
					g.pots[i].WinningPlayerNums = []uint{num}
					g.pots[i].WinningHand = hand
				} else if score == g.pots[i].WinningScore {
					g.pots[i].WinningPlayerNums = append(g.pots[i].WinningPlayerNums, num)
				}
			}

			for _, num := range g.pots[i].WinningPlayerNums {
				share := g.pots[i].Amt / uint(len(g.pots[i].WinningPlayerNums))
				g.players[num].Stack += share
				//TODO: leave the remainder in the middle! (fractional money will disappear currently)
				g.players[num].Stats.HandsWon++
				if share > g.players[num].Stats.MaxPotWon {
					g.players[num].Stats.MaxPotWon = share
				}
			}
		}

		g.resetForNextHand()

		// otherwise, just set betting to false so the dealer can deal the next part of the hand
	} else {
		g.setBetting(false)
		deal(g, g.dealerNum, 0)
	}
}

//Exported functions related to game management (not "Actions")

// NewGame is a factory method that returns a pointer to an initialized game.
// This freshly created game will have the following default values:
// 	Players: []
// 	GameStage: PreDeal
// 	Betting: False
// 	Config: {
// 		BigBlind:	25
// 		SmallBlind:	10
// 		MaxBuy:		0
// 	}
func NewGame() *Game {
	newGame := Game{}

	newGame.setStageAndBetting(PreDeal, false)
	newGame.deck = DefaultDeck
	newGame.config = GameConfig{
		BigBlind:   20,
		SmallBlind: 10,
		MaxBuy:     0,
	}
	newGame.communityCards = make([]Card, 5)

	return &newGame
}

// Configure sets the table configuration before any hands are dealt.
// It should only be called on a fresh game.
func Configure(g *Game, sb uint, bb uint, buyIn uint, maxBuy uint, maxPlayers uint) {
	g.mtx.Lock()
	defer g.mtx.Unlock()

	g.config.SmallBlind = sb
	g.config.BigBlind = bb
	g.config.BuyIn = buyIn
	g.config.MaxBuy = maxBuy
	g.config.MaxPlayers = maxPlayers
}

// Start checks that all players (except those who have left) are ready, then
// sets running to true and deals the first hand
func (g *Game) Start() error {
	for _, p := range g.players {
		if !p.Left && !p.Ready {
			return ErrStartGame
		}
	}
	g.running = true
	err := Deal(g, g.dealerNum, 0)
	if err != nil {
		g.running = false
		return err
	}
	return nil
}

// Reset resets the game to a blank game
func (g *Game) Reset() {
	g.running = false
	g.players = []player{}
	g.pots = []Pot{}
	g.communityCards = make([]Card, 5)
	g.deck = DefaultDeck
	g.setStageAndBetting(PreDeal, false)
}

func (g *Game) AddPlayer() uint {
	g.players = append(g.players, player{})
	g.players[len(g.players)-1].initialize()
	return uint(len(g.players) - 1)
}
