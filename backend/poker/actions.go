package poker

import (
	"sort"
)

// Action is the generic type of all state machine transitions, formalized to better allow external agents to interact with the game.
// For all Actions, g is the game in which it is performed and pn is the player number performing the action.
// data represents different things for different Actions.
//
// If pn is valid, Actions are guaranteed to not modify the internal state of g at all, and return a descriptive
// error if the attempted action was illegal.
//
// Passing an invalid player number to pn will result in undefined behavior,
// and may cause anything from a segmentation fault to completely silent failure.
// Invalid player numbers are player numbers that have not been assigned to a player within Game g.
// Player numbers that have left the game *may* still be valid (but cannot legally perform actions), but
// that is not guaranteed by the API. Player numbers are generally meant as an internal identifier,
// and in most applications will be mapped to some other identifier (like a client session id), so
// it intentionally does not perform checks on the values it is passed to
// optimize performance. If you intend to pass Actions player numbers directly from an external source
// it is your responsibility to ensure the integrity of those numbers.
type Action func(g *Game, pn uint, data uint) error

// Bet is the Action that covers checking, opening betting, calling, and raising.
// For Bet, data is the amount of the bet (with a check being 0). If Bet is called out of turn, or
// the value passed to data does not constitute a legal bet, Bet will return an error value. If bet is successful,
// it will return nil.
func Bet(g *Game, pn uint, data uint) error {
	g.mtx.Lock()
	defer g.mtx.Unlock()
	return bet(g, pn, data)
}

func bet(g *Game, pn uint, data uint) error {

	if !g.getBetting() {
		return ErrIllegalAction
	}

	if g.actionNum != pn {
		return ErrIllegalAction
	}

	p := g.getPlayer(pn)

	// A player who is already all-in cannot act again.
	if p.allIn() {
		return ErrIllegalAction
	}

	//rename this for readability
	betVal := data

	var minBet uint = g.toCall()

	var betLegalError error = nil

	if !g.canOpen(pn) {
		//Won't hit now, reserved for future implementations
		betLegalError = ErrIllegalAction
	} else if betVal >= p.Stack {
		// An all-in is always a legal bet, even when it is less than the
		// full amount needed to call or less than a minimum raise. It only
		// reopens the betting when it is at least a full minimum raise over
		// the previous bet; otherwise players can only call.
		betLegalError = nil
		if betVal+p.Bet >= minBet+g.minRaise {
			g.minRaise = betVal + p.Bet - minBet
			for i := range g.players {
				g.players[i].Called = false
				g.calledNum = pn
			}
		}
	} else if betVal < (minBet - p.Bet) {
		//Not calling the minimum needed
		betLegalError = ErrIllegalAction
	} else if betVal == (minBet - p.Bet) {
		//Calling exactly
		betLegalError = nil
	} else if betVal < (minBet + g.minRaise - p.Bet) {
		// More than calling, but less than minimum raise
		betLegalError = ErrIllegalAction
	} else {
		// More than calling, and at least the minimum raise
		betLegalError = nil
		g.minRaise = betVal + p.Bet - minBet
		for i := range g.players {
			g.players[i].Called = false
			g.calledNum = pn
		}
	}

	if betLegalError != nil {
		//I could just return this in every spot, but i suspect the structure of what is legal
		//will change as more betting schemes are introduced, so seems more extensible to keep it here
		return betLegalError
	}

	callAmount := minBet - p.Bet

	g.players[pn].putInChips(betVal)
	g.players[pn].Called = true

	// record per-player statistics for the session
	if betVal == 0 {
		// check
	} else if betVal == callAmount {
		g.players[pn].Stats.Calls++
	} else {
		g.players[pn].Stats.Raises++
		g.betsThisStreet++
		if g.betsThisStreet == 2 {
			g.players[pn].Stats.ThreeBets++
		}
	}
	if g.getStage() == PreFlop && betVal > 0 {
		g.players[pn].Stats.VPIP++
		g.players[pn].Stats.VPIPByPos[g.positionLabel(pn)]++
	}

	g.updateRoundInfo()

	return nil
}

// BuyIn buys more chips for the player. For BuyIn, data is the amount to buy in for.
// BuyIn will return an error if the player attempting it is in the current round, or if
// the buy would cause the player's stack to exceed the maximum configured buy in.
func BuyIn(g *Game, pn uint, data uint) error {
	g.mtx.Lock()
	defer g.mtx.Unlock()
	return buyIn(g, pn, data)
}

func buyIn(g *Game, pn uint, data uint) error {
	p := g.getPlayer(pn)

	//Can't buy more than the maximum buy, if it's configured
	if g.config.MaxBuy != 0 && p.TotalBuyIn+data > g.config.MaxBuy {
		return ErrIllegalAction
	}

	if p.In {
		// Rebuy during a hand: chips are held until the hand ends.
		p.PendingBuyIn += data
	} else {
		p.Stack += data
	}

	//And add it to your total
	p.TotalBuyIn += data

	return nil
}

// UndoBuyIn reverses the most recent buy-in, returning chips to the player's
// stack and total. data is the amount to withdraw (one buy-in). It is only
// valid before a hand starts and before the player has readied up.
func UndoBuyIn(g *Game, pn uint, data uint) error {
	g.mtx.Lock()
	defer g.mtx.Unlock()

	p := g.getPlayer(pn)
	if p.In || p.Ready {
		return ErrIllegalAction
	}
	if p.Stack < data {
		return ErrIllegalAction
	}
	p.Stack -= data
	if p.TotalBuyIn >= data {
		p.TotalBuyIn -= data
	} else {
		p.TotalBuyIn = 0
	}
	return nil
}

// SetUsername sets a player's username
func SetUsername(g *Game, pn uint, data string) error {
	g.mtx.Lock()
	defer g.mtx.Unlock()
	return setUsername(g, pn, data)
}

// SetAvatar sets a player's display avatar (an emoji and/or an image flag).
func SetAvatar(g *Game, pn uint, avatar string, hasImage bool) error {
	g.mtx.Lock()
	defer g.mtx.Unlock()

	g.getPlayer(pn).Avatar = avatar
	g.getPlayer(pn).AvatarImage = hasImage
	return nil
}

func setUsername(g *Game, pn uint, data string) error {
	p := g.getPlayer(pn)

	p.Username = data

	return nil
}

// ShowHand marks a player's hole cards as voluntarily revealed (e.g. an
// all-in player choosing to show). data is ignored.
func ShowHand(g *Game, pn uint, data uint) error {
	g.mtx.Lock()
	defer g.mtx.Unlock()
	g.getPlayer(pn).Revealed = true
	return nil
}

// SetSeatID assigns a seat to each player. Seat position is not the same as the index of each player in g.players.
// While positions must be contiguous, seatIDs do not have to be.
// i.e. pn1 has seat 1, pn2 has seat 4, and pn3 has seat 5.
func SetSeatID(g *Game, pn uint, data uint) error {
	g.mtx.Lock()
	defer g.mtx.Unlock()
	return setSeatID(g, pn, data)
}

func setSeatID(g *Game, pn uint, data uint) error {

	// Seat must be less than maximum number of allowable players.
	// if data > g.config.MaxPlayers {
	// 	return Error
	// }
	if data == 0 {
		panic("cannot insert player at position zero")
	}

	for _, p := range g.players {
		if data == p.SeatID {
			return ErrInvalidPosition
		}
	}
	p := g.getPlayer(pn)
	p.SeatID = data

	// rearrange player order to match positions
	sort.Slice(g.players, func(i, j int) bool {
		return g.players[i].SeatID < g.players[j].SeatID
	})

	// update player position
	for i := range g.players {
		g.players[i].Position = uint(i)
	}

	return nil
}

// Deal deals the next set of cards, as appropriate per g's internal state. If g is currently betting,
// or pn is not the dealer, Deal will return an error. Otherwise, if g is stage PreDeal when Deal is called,
// Deal shuffles the deck and deals each player who is ready 2 cards. If g is stage PreFlop, Deal deals the flop; if g
// is stage Flop, Deal deals the turn, and if g is stage Turn, Deal deals the river. g is never stage River and not betting,
// so calling Deal during stage River will result in an error.
// Deal ignores the value passed in as data.
func Deal(g *Game, pn uint, data uint) error {
	g.mtx.Lock()
	defer g.mtx.Unlock()
	return deal(g, pn, data)
}

// nextToAct advances actionNum to the next player who can still act (in the
// hand and not all-in). If every in-hand player is all-in, actionNum is left
// as-is; callers that run out the board disable betting in that case.
func (g *Game) nextToAct() {
	n := uint(len(g.players))
	seen := uint(0)
	for (g.players[g.actionNum].allIn() || !g.players[g.actionNum].In) && seen < n {
		g.actionNum = (g.actionNum + 1) % n
		seen++
	}
}

func deal(g *Game, pn uint, data uint) error {
	if pn != g.dealerNum {
		return ErrIllegalAction
	}

	stage, betting := g.getStageAndBetting()

	if betting {
		return ErrIllegalAction
	}

	if g.readyCount() < 2 {
		return ErrIllegalAction
	}

	for i := range g.players {
		g.players[i].Bet = 0
		g.players[i].Called = false
	}

	g.betsThisStreet = 0
	g.minRaise = g.config.SmallBlind

	//TODO: if all or all but one are all-in and its not the end, don't set betting to true on the next deal

	switch stage {
	case PreDeal:

		// Zero all the community cards from last round
		for i := range g.communityCards {
			g.communityCards[i] = 0
		}

		g.pots = []Pot{}

		g.updateBlindNums()

		g.actionNum = g.utgNum

		for i := 0; i < 3; i++ {
			g.deck.Shuffle()
		}

		for i, p := range g.players {
			if p.Ready {
				g.players[i].Cards[0] = g.deck.Pop()
				g.players[i].Cards[1] = g.deck.Pop()
				g.players[i].In = true
				g.players[i].Stats.HandsPlayed++
			} else {
				g.players[i].Cards[0] = 0
				g.players[i].Cards[1] = 0
			}

			g.players[i].Called = false
			g.players[i].Revealed = false
		}

		g.players[g.sbNum].putInChips(g.config.SmallBlind)
		g.players[g.bbNum].putInChips(g.config.BigBlind)

	case PreFlop:

		g.actionNum = (g.dealerNum + 1) % uint(len(g.players))
		g.nextToAct()
		g.calledNum = g.actionNum

		g.communityCards[0] = g.deck.Pop()
		g.communityCards[1] = g.deck.Pop()
		g.communityCards[2] = g.deck.Pop()

	case Flop:
		g.actionNum = (g.dealerNum + 1) % uint(len(g.players))
		g.nextToAct()
		g.calledNum = g.actionNum

		g.communityCards[3] = g.deck.Pop()

	case Turn:
		g.actionNum = (g.dealerNum + 1) % uint(len(g.players))
		g.nextToAct()
		g.calledNum = g.actionNum

		g.communityCards[4] = g.deck.Pop()

	default:
		return errInternalBadGameStage
	}

	g.setStageAndBetting(stage+1, true)

	return nil
}

// Fold folds a player's hand. Fold will return an error if
// the player cannot legally move when it is called. If Fold succeeds, it will update
// g's internal state as appropriate, including advancing to the next stage of the hand (if all other
// players have called) or terminating the hand (if after folding, only one other player is in).
// Fold ignores the value passed in as data
func Fold(g *Game, pn uint, data uint) error {
	g.mtx.Lock()
	defer g.mtx.Unlock()
	return fold(g, pn, data)
}

func fold(g *Game, pn uint, data uint) error {

	p := g.getPlayer(pn)

	if g.actionNum != pn {
		return ErrIllegalAction
	}

	// A player who is all-in cannot fold.
	if p.allIn() {
		return ErrIllegalAction
	}

	p.In = false
	p.Stats.Folds++

	g.updateRoundInfo()

	return nil

}

// Leave marks a player as having left the game. This is essentially the same as marking a player
// "not ready" (see ToggleReady) except it also marks the player as "left", which provides a distinct
// state (e.g. so that frontends can render "left" players and "not ready" players differently)
func Leave(g *Game, pn uint, data uint) error {
	g.mtx.Lock()
	defer g.mtx.Unlock()
	return leave(g, pn, data)
}

func leave(g *Game, pn uint, data uint) error {
	p := g.getPlayer(pn)
	var err error

	if p.Ready {
		err = toggleReady(g, pn, data)
		if err != nil {
			return err
		}
	}

	p.Left = true

	return nil
}

// LeaveHand marks a player as having left the table and folds them if it is
// currently their turn. A departing player is therefore folded on their turn
// rather than immediately when it is someone else's turn. A departing player
// who is already all-in is not folded: their cards are revealed and they stay
// in the hand until showdown (see updateRoundInfo).
func LeaveHand(g *Game, pn uint) error {
	g.mtx.Lock()
	defer g.mtx.Unlock()
	return leaveHand(g, pn)
}

func leaveHand(g *Game, pn uint) error {
	p := g.getPlayer(pn)

	// Unready the player. Mid-hand the ready flag is cleared directly so their
	// hole cards remain until they fold; otherwise toggleReady fixes up the
	// dealer and blinds.
	if p.Ready {
		if p.In {
			p.Ready = false
		} else if err := toggleReady(g, pn, 0); err != nil {
			return err
		}
	}

	p.Left = true

	// A departing all-in player shows down instead of folding: their cards are
	// revealed and they remain in the hand, so the hand runs to a showdown. If
	// they would have won, their winnings are forfeited in updateRoundInfo.
	if p.allIn() {
		p.Revealed = true
		return nil
	}

	// If it is already their turn, fold them now so the hand doesn't hang.
	if g.actionNum == pn && p.In {
		p.In = false
		p.Stats.Folds++
		g.updateRoundInfo()
	}
	return nil
}

// SitOut folds a player out of the current hand (if any) and marks them as
// having left. Unlike Fold+Leave called separately, this works even when it is
// not the player's turn — it is used to remove offline or departing players.
func SitOut(g *Game, pn uint, data uint) error {
	g.mtx.Lock()
	defer g.mtx.Unlock()

	p := g.getPlayer(pn)
	if p.In {
		p.In = false
		p.Stats.Folds++
		g.updateRoundInfo()
	}

	return leave(g, pn, data)
}

// ToggleReady marks a player as "ready" if they are currently "not ready"
// or "not ready" if they are currently "ready." If the player attempting it is in the current round
// ToggleReady will return an error. If the player attempting it has no money, ToggleReady will return an error.
// ToggleReady ignores the value passed in as data.
func ToggleReady(g *Game, pn uint, data uint) error {
	g.mtx.Lock()
	defer g.mtx.Unlock()
	return toggleReady(g, pn, data)
}

func toggleReady(g *Game, pn uint, data uint) error {
	p := g.getPlayer(pn)

	if p.In {
		return ErrIllegalAction
	}

	if p.Ready {
		p.Ready = false
		p.Cards[0] = 0
		p.Cards[1] = 0
	} else {
		if p.Stack == 0 {
			return ErrIllegalAction
		}
		p.Ready = true
	}

	if pn == g.dealerNum {
		n := uint(len(g.players))
		seen := uint(0)
		for !(g.players[g.dealerNum].Ready) && seen < n {
			g.dealerNum = (g.dealerNum + 1) % n
			seen++
		}
	}

	if g.getStage() == PreDeal {
		g.updateBlindNums()
	}

	p.Left = false

	return nil
}
