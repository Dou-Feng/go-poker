package server

import (
	"math"
	"sync"

	"github.com/evanofslack/go-poker/poker"
)

// Opponent-model checkpoints consume the same five action buckets used by
// training: fold, check/call, half-pot raise, pot raise and overbet. Each
// action is paired with the 25-value context produced by
// DeepCFRAgentWithOpponentModeling.extract_state_context.
const aiHistoryContextSize = 25

type aiActionHistoryItem struct {
	ActionID int                           `json:"action_id"`
	Context  [aiHistoryContextSize]float64 `json:"context"`
}

type aiOpponentHistory struct {
	OpponentID int                   `json:"opponent_id"`
	Actions    []aiActionHistoryItem `json:"actions"`
}

// aiPreviousAction retains the extra information extract_state_context puts
// in the next action's context. actionType follows pokers.ActionEnum:
// fold=0, check=1, call=2, raise=3. amount is the raise increment after the
// call, matching pokers' Raise amount (and is zero for non-raises).
type aiPreviousAction struct {
	actionType int
	amount     float64
}

type aiHandActionHistory struct {
	mu       sync.Mutex
	byPlayer map[string][]aiActionHistoryItem
	previous *aiPreviousAction
}

func (t *table) resetAIActionHistory() {
	h := &t.aiActions
	h.mu.Lock()
	h.byPlayer = make(map[string][]aiActionHistoryItem)
	h.previous = nil
	h.mu.Unlock()
}

// recordAIBet records a successful poker.Bet using the snapshot immediately
// before the action. amount is go-poker's chips-put-in amount, so a raise's
// pokers-compatible increment is amount minus the outstanding call.
func (t *table) recordAIBet(before *poker.GameView, pn uint, amount uint) {
	if before == nil || pn >= uint(len(before.Players)) {
		return
	}

	minBet := uint(0)
	for i := range before.Players {
		if before.Players[i].Bet > minBet {
			minBet = before.Players[i].Bet
		}
	}
	player := before.Players[pn]
	callAmount := minBet - player.Bet

	actionID := 1
	actionType := 1 // check
	raiseAmount := 0.0
	if callAmount > 0 {
		actionType = 2 // call, including a short all-in call
	}
	if amount > callAmount {
		actionType = 3 // raise
		raiseAmount = float64(amount - callAmount)
		ratio := raiseAmount / math.Max(1, aiPot(before))
		switch {
		case ratio <= 0.75:
			actionID = 2
		case ratio <= 1.5:
			actionID = 3
		default:
			actionID = 4
		}
	}

	t.recordAIAction(before, pn, actionID, aiPreviousAction{
		actionType: actionType,
		amount:     raiseAmount,
	})
}

// recordAIFold records a successful poker.Fold.
func (t *table) recordAIFold(before *poker.GameView, pn uint) {
	t.recordAIAction(before, pn, 0, aiPreviousAction{actionType: 0})
}

func (t *table) recordAIAction(before *poker.GameView, pn uint, actionID int, current aiPreviousAction) {
	if before == nil || pn >= uint(len(before.Players)) {
		return
	}
	playerUUID := before.Players[pn].UUID
	if playerUUID == "" {
		return
	}

	h := &t.aiActions
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.byPlayer == nil {
		h.byPlayer = make(map[string][]aiActionHistoryItem)
	}
	item := aiActionHistoryItem{
		ActionID: actionID,
		Context:  aiActionContext(before, h.previous),
	}
	h.byPlayer[playerUUID] = append(h.byPlayer[playerUUID], item)
	previous := current
	h.previous = &previous
}

// aiOpponentHistories returns an immutable request snapshot for pn. Histories
// are ordered by current player position and the acting player is excluded.
func (t *table) aiOpponentHistories(view *poker.GameView, pn uint) []aiOpponentHistory {
	if view == nil {
		return []aiOpponentHistory{}
	}
	h := &t.aiActions
	h.mu.Lock()
	defer h.mu.Unlock()

	out := make([]aiOpponentHistory, 0, len(view.Players))
	for i := range view.Players {
		if uint(i) == pn {
			continue
		}
		actions := h.byPlayer[view.Players[i].UUID]
		if len(actions) == 0 {
			continue
		}
		out = append(out, aiOpponentHistory{
			OpponentID: i,
			Actions:    append([]aiActionHistoryItem(nil), actions...),
		})
	}
	return out
}

func aiPot(view *poker.GameView) float64 {
	pot := 0.0
	for i := range view.Players {
		pot += float64(view.Players[i].TotalBet)
	}
	for i := range view.DepartedPlayers {
		pot += float64(view.DepartedPlayers[i].TotalBet)
	}
	return pot
}

// aiActionContext mirrors
// DeepCFRAgentWithOpponentModeling.extract_state_context exactly. The view is
// the state before the action being recorded; previous is the prior table
// action in this hand.
func aiActionContext(view *poker.GameView, previous *aiPreviousAction) [aiHistoryContextSize]float64 {
	var context [aiHistoryContextSize]float64
	if view == nil || len(view.Players) == 0 || view.ActionNum >= uint(len(view.Players)) {
		return context
	}

	stage := int(view.Stage) - int(poker.PreFlop)
	if stage >= 0 && stage < 5 {
		context[stage] = 1
	}

	initialStake := math.Max(1, float64(view.Players[0].Stack+view.Players[0].Bet))
	pot := aiPot(view)
	context[5] = pot / initialStake

	active := 0
	for i := range view.Players {
		if view.Players[i].In {
			active++
		}
	}
	context[6] = float64(active) / float64(aiModelSeats)

	distance := (int(view.ActionNum) - int(view.DealerNum) + aiModelSeats) % aiModelSeats
	context[7] = float64(distance) / float64(aiModelSeats)

	community := 0
	for _, card := range view.CommunityCards {
		if card != 0 {
			community++
		}
	}
	context[8] = float64(community) / 5

	if previous != nil && previous.actionType >= 0 && previous.actionType < 4 {
		context[9+previous.actionType] = 1
		if previous.actionType == 3 {
			context[13] = previous.amount / initialStake
		}
	}

	minBet := 0.0
	for i := range view.Players {
		minBet = math.Max(minBet, float64(view.Players[i].Bet))
	}
	context[14] = minBet / math.Max(1, pot)

	avgStack := 0.0
	for i := range view.Players {
		avgStack += float64(view.Players[i].Stack)
	}
	avgStack /= float64(aiModelSeats) // unused model slots contribute zero
	current := view.Players[view.ActionNum]
	context[15] = float64(current.Stack) / math.Max(1, avgStack)
	context[16] = float64(current.Bet) / math.Max(1, pot)

	if previous != nil && previous.actionType == 3 {
		ratio := previous.amount / math.Max(1, pot)
		context[20] = ratio
		switch {
		case ratio < 0.5:
			context[21] = 1
		case ratio < 1:
			context[22] = 1
		case ratio < 2:
			context[23] = 1
		default:
			context[24] = 1
		}
	}

	return context
}
