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
xB...SSS
--------
x  - unused
B  - Betting
	1 : Yes, still betting
	0 : No, can advance
SSS - Status (see GameStage)

Betting is only meaningful in the betting states (PreFlop..River).
*/

// GameStage is the table state machine (change.md「状态」章节):
//
//	NotReady  — waiting for players to ready up; rebuy/move/spectate allowed
//	PreFlop   — hole cards dealt, betting round in progress
//	Flop      — three community cards, betting round in progress
//	Turn      — fourth community card, betting round in progress
//	River     — fifth community card, betting round in progress
//	Showdown  — hand resolved: reveal cards + hand types + winner toast
//	Terminal  — session finished (hand limit / early settle vote): scoreboard
type GameStage uint8

const (
	NotReady GameStage = iota + 1
	PreFlop
	Flop
	Turn
	River
	Showdown
	Terminal
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
	HandsLimit uint `json:"handsLimit"`
}

// Game represents a game of poker. It internally keeps track of state, can be mutated by actions,
// and will generate views of itself upon request. Games should not be initialized directly, only
// through the NewGame factory function.
type Game struct {
	mtx sync.Mutex

	dealerNum         uint
	actionNum         uint
	utgNum            uint
	sbNum             uint
	bbNum             uint
	communityCards    []Card
	flags             gameFlags
	config            GameConfig
	players           []player
	departedPlayers   []player
	deck              Deck
	pots              []Pot
	minRaise          uint
	calledNum         uint
	betsThisStreet    uint
	handsPlayed       uint
	biggestPotAmt     uint
	biggestPotWinners []uint
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

// getRunning reports whether the table is inside a hand (PreFlop..River) or
// its showdown window — i.e. everything except NotReady and Terminal.
func (g *Game) getRunning() bool {
	s := g.getStage()
	return s >= PreFlop && s <= Showdown
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

// Returns nil if there are more than 2 players ready, ErrIllegalAction otherwise
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
	// Snapshot the departing player for the room scoreboard. Cards are
	// cleared so departed players never leak their hole cards.
	snap := g.players[pn]
	snap.Cards = [2]Card{0, 0}
	g.departedPlayers = append(g.departedPlayers, snap)

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

	// Re-map pot position references: positions above pn shift down by one,
	// and the dropped player is removed from any pot lists.
	for i := range g.pots {
		remap := func(nums []uint) []uint {
			out := make([]uint, 0, len(nums))
			for _, n := range nums {
				if n > pn {
					out = append(out, n-1)
				} else if n < pn {
					out = append(out, n)
				}
			}
			return out
		}
		g.pots[i].EligiblePlayerNums = remap(g.pots[i].EligiblePlayerNums)
		g.pots[i].WinningPlayerNums = remap(g.pots[i].WinningPlayerNums)
	}

	g.players = append(g.players[:pn], g.players[pn+1:]...)

	// Re-index player positions after the removal.
	for i := range g.players {
		g.players[i].Position = uint(i)
	}
}

// RemovePlayer removes a player from the game entirely, freeing their seat.
// It is only safe to call when no hand is in progress (stage NotReady).
func RemovePlayer(g *Game, pn uint) error {
	g.mtx.Lock()
	defer g.mtx.Unlock()

	if pn >= uint(len(g.players)) {
		return ErrOutOfBounds
	}
	g.dropPlayer(pn)
	if g.getStage() == NotReady {
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

	g.pots = []Pot{}
	g.communityCards = make([]Card, 5)
	g.deck = DefaultDeck
	g.setStageAndBetting(NotReady, false)

	for i := range g.players {
		g.players[i].setState(PlayerNotReady)
		g.players[i].Bet = 0
		g.players[i].TotalBet = 0
		g.players[i].Cards = [2]Card{0, 0}
		g.players[i].Left = false
		g.players[i].Revealed = false
	}

	if len(g.players) > 0 {
		g.updateBlindNums()
	}
}

// Pause puts the game into the not-ready phase without clearing player stacks
// or the hand counter: everyone becomes not-ready, so the table waits for
// players to ready up again.
func Pause(g *Game) {
	g.mtx.Lock()
	defer g.mtx.Unlock()

	for i := range g.players {
		g.players[i].setState(PlayerNotReady)
		g.players[i].Bet = 0
		g.players[i].TotalBet = 0
		g.players[i].Cards = [2]Card{0, 0}
		g.players[i].Revealed = false
	}
	g.pots = []Pot{}
	g.setStageAndBetting(NotReady, false)
}

func (g *Game) resetForNextHand() {

	// Remove players who have left the room (iterate backwards so indices
	// stay valid while dropping).
	hadLeft := false
	for i := len(g.players) - 1; i >= 0; i-- {
		if g.players[i].Left {
			g.dropPlayer(uint(i))
			hadLeft = true
		}
	}

	if len(g.players) == 0 {
		g.setStageAndBetting(NotReady, false)
		return
	}

	g.handsPlayed++

	// Apply rebuys queued during the previous hand.
	for i := range g.players {
		if g.players[i].PendingBuyIn > 0 {
			g.players[i].Stack += g.players[i].PendingBuyIn
			g.players[i].PendingBuyIn = 0
		}
	}

	paused := hadLeft
	if !paused {
		for i := range g.players {
			if g.players[i].Stack == 0 {
				paused = true
				break
			}
		}
	}

	if paused {
		// Someone left or busted: pause after this hand so the table can
		// regroup. Everyone becomes not-ready, but the hand counter is
		// preserved so a fixed-length session still ends on schedule.
		for i := range g.players {
			g.players[i].setState(PlayerNotReady)
			g.players[i].Called = false
			g.players[i].Bet = 0
			g.players[i].TotalBet = 0
			g.players[i].Cards = [2]Card{0, 0}
			g.players[i].Revealed = false
		}
		g.setStageAndBetting(NotReady, false)
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

	g.setStageAndBetting(NotReady, false)
}

// recordBiggestPot tracks the largest single pot of the session along with its
// winners, for display on the settlement screen.
func (g *Game) recordBiggestPot(amt uint, winners []uint) {
	if amt > g.biggestPotAmt {
		g.biggestPotAmt = amt
		g.biggestPotWinners = append([]uint{}, winners...)
	}
}

func (g *Game) updateRoundInfo() {
	// Fold any player who has left the table but is still in the hand. This
	// runs on the next hand evaluation (e.g. the next action) so a departed
	// player is folded on their turn rather than immediately. A departed
	// player who is all-in is not folded: their cards stay in contention and
	// are resolved at showdown (their winnings are forfeited below).
	for i := range g.players {
		if g.players[i].In && g.players[i].Left && !g.players[i].allIn() {
			g.players[i].setState(PlayerNotReady)
			g.players[i].Stats.Folds++
		}
	}

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
		// No player is left in the hand (e.g. every opponent left the room
		// and the last actor folded): nobody is awarded the pot. Enter the
		// Showdown state so the forfeit is displayed, then the client
		// advances.
		if len(inPlayerNums) == 0 {
			for i := range g.pots {
				g.pots[i].WinningScore = 8000
				g.pots[i].WinningPlayerNums = []uint{}
			}
			g.setStageAndBetting(Showdown, false)
			return
		}

		//the sole number in the array is the winner by default
		//TODO: Create a pot here to simplify sending result description

		// add player as winner
		for i := range g.pots {
			g.pots[i].WinningScore = 8000
			g.pots[i].WinningPlayerNums = inPlayerNums
		}

		// A departed all-in player who is the last one standing forfeits the
		// pot: nobody is awarded the chips. The table still enters the
		// Showdown state so the forfeit is displayed (the chips vanish), then
		// the client advances to the next state.
		if g.players[inPlayerNums[0]].Left {
			for i := range g.pots {
				g.pots[i].WinningPlayerNums = []uint{}
			}
			g.setStageAndBetting(Showdown, false)
			return
		}

		// Uncontested win: award the pot to the last player standing. No
		// showdown comparison is needed, so no cards are revealed — showing
		// is left to the winner (ShowHand). The table still enters the
		// Showdown state so the winner toast plays, then the client advances.
		var won uint = 0
		for _, p := range g.players {
			won += p.TotalBet
			g.players[inPlayerNums[0]].Stack += p.TotalBet
		}
		g.players[inPlayerNums[0]].Stats.HandsWon++
		if won > g.players[inPlayerNums[0]].Stats.MaxPotWon {
			g.players[inPlayerNums[0]].Stats.MaxPotWon = won
		}
		g.recordBiggestPot(won, inPlayerNums)

		g.setStageAndBetting(Showdown, false)

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
		// Resolve the pots and enter the Showdown state: cards, hand types
		// and the winner toast stay on screen here. The client advances the
		// table to the next state with a deal request once its display
		// window (hand types → 1s → toast 4s) has elapsed.
		g.resolveShowdown()
		g.setStageAndBetting(Showdown, false)
		return

		// otherwise, just set betting to false so the dealer can deal the next part of the hand
	} else if len(inPlayerNums) == len(allInPlayerNums) {
		// Every player still in the hand is all-in: stop betting. The board
		// is then revealed one card at a time by the client via RunoutNext.
		g.setBetting(false)
	} else {
		g.setBetting(false)
		deal(g, g.dealerNum, 0)
	}
}

// resolveShowdown evaluates every pot on the board, awards the chips and
// stamps each in-hand player's best hand name. Chips have moved and stats are
// updated after this, but the table reset (resetForNextHand) happens when the
// showdown display ends and the next hand is dealt.
func (g *Game) resolveShowdown() {
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

		// Drop winners who left while all-in: their share is forfeited
		// (the chips vanish) as a penalty for leaving. If every winner
		// forfeited, the whole pot disappears.
		totalWinners := uint(len(g.pots[i].WinningPlayerNums))
		legit := []uint{}
		for _, num := range g.pots[i].WinningPlayerNums {
			if !g.players[num].Left {
				legit = append(legit, num)
			}
		}
		g.pots[i].WinningPlayerNums = legit

		if totalWinners > 0 {
			share := g.pots[i].Amt / totalWinners
			for _, num := range legit {
				g.players[num].Stack += share
				//TODO: leave the remainder in the middle! (fractional money will disappear currently)
				g.players[num].Stats.HandsWon++
				if share > g.players[num].Stats.MaxPotWon {
					g.players[num].Stats.MaxPotWon = share
				}
			}
		}
		if len(legit) > 0 {
			g.recordBiggestPot(g.pots[i].Amt, legit)
		}
	}

	// Stamp each in-hand player with the name of their best five-card hand:
	// clients display it next to the seat during the showdown window.
	for i := range g.players {
		if g.players[i].In {
			g.players[i].BestHand = BestHandName(g, uint(i))
		}
	}
}

// SettleShowdown closes the showdown window: reset the table for the next
// hand (state 6 → 0; the client auto-starts or re-readies from there).
func SettleShowdown(g *Game) error {
	g.mtx.Lock()
	defer g.mtx.Unlock()
	if g.getStage() != Showdown {
		return ErrIllegalAction
	}
	g.resetForNextHand()
	return nil
}

//Exported functions related to game management (not "Actions")

// NewGame is a factory method that returns a pointer to an initialized game.
// This freshly created game will have the following default values:
//
//	Players: []
//	GameStage: NotReady
//	Betting: False
//	Config: {
//		BigBlind:	25
//		SmallBlind:	10
//		MaxBuy:		0
//	}
func NewGame() *Game {
	newGame := Game{}

	newGame.setStageAndBetting(NotReady, false)
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
func Configure(g *Game, sb uint, bb uint, buyIn uint, maxBuy uint, maxPlayers uint, handsLimit uint) {
	g.mtx.Lock()
	defer g.mtx.Unlock()

	g.config.SmallBlind = sb
	g.config.BigBlind = bb
	g.config.BuyIn = buyIn
	g.config.MaxBuy = maxBuy
	g.config.MaxPlayers = maxPlayers
	g.config.HandsLimit = handsLimit
}

// Start checks that all players (except those who have left) are ready, then
// deals the first hand (moving the table from NotReady into PreFlop).
func (g *Game) Start() error {
	if g.getStage() != NotReady {
		return ErrStartGame
	}
	for _, p := range g.players {
		if !p.Left && !p.Ready {
			return ErrStartGame
		}
	}
	err := Deal(g, g.dealerNum, 0)
	if err != nil {
		return err
	}
	return nil
}

// Reset resets the game to a blank game
func (g *Game) Reset() {
	g.players = []player{}
	g.departedPlayers = []player{}
	g.pots = []Pot{}
	g.communityCards = make([]Card, 5)
	g.deck = DefaultDeck
	g.setStageAndBetting(NotReady, false)
	g.handsPlayed = 0
	g.biggestPotAmt = 0
	g.biggestPotWinners = nil
}

// RunoutNext reveals the next board card(s) when every remaining player is
// all-in. The flop is dealt as three cards at once (flipped together), then
// the turn and river are revealed one at a time so the client can animate
// each flip. Dealing the river completes the board but does NOT resolve the
// hand: the table displays the full board for the showdown, and the next
// deal-game request settles it (revealed >= 5 branch).
func RunoutNext(g *Game) error {
	g.mtx.Lock()
	defer g.mtx.Unlock()

	revealed := 0
	for _, c := range g.communityCards {
		if c != 0 {
			revealed++
		}
	}
	if revealed >= 5 {
		g.updateRoundInfo()
		return nil
	}

	if revealed == 0 {
		// Deal the whole flop at once so the three cards flip together.
		g.communityCards[0] = g.deck.Pop()
		g.communityCards[1] = g.deck.Pop()
		g.communityCards[2] = g.deck.Pop()
		g.setStage(Flop)
	} else {
		g.communityCards[revealed] = g.deck.Pop()
		switch revealed {
		case 3:
			g.setStage(Turn)
		case 4:
			g.setStage(River)
		}
	}
	g.setBetting(false)
	return nil
}

func (g *Game) AddPlayer() uint {
	g.players = append(g.players, player{})
	g.players[len(g.players)-1].initialize()
	return uint(len(g.players) - 1)
}
