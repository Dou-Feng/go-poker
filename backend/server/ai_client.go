package server

// HTTP bridge from go-poker bots to the Deep CFR inference server.
//
// The model lives in the deepcfr-texas-no-limit-holdem-6-players repo
// (server/inference_server.py). This file translates a *poker.GameView into
// the neutral JSON state that service expects, sends it over HTTP, and maps
// the reply back onto the botAction kinds used by bot.go.
//
// Enable with AI_INFERENCE_URL, e.g.
//
//	AI_INFERENCE_URL=http://127.0.0.1:8001 ./go-poker
//
// Setting the URL alone does NOT make bots smart: every room picks its bot
// type at creation (see handleCreateTable); only rooms created as "ai" ask
// the model for decisions, and the built-in heuristic (botDecide) is both
// the default for normal rooms and the safety net whenever the service
// errors out mid-hand. The lobby may only offer the AI bot type while the
// service answers its /healthz probe (aiServiceAvailable, cached).
//
// Convention notes (go-poker -> pokers, as used at training time):
//
//	suit: 0x8000 C -> 0, 0x4000 D -> 1, 0x2000 H -> 2, 0x1000 S -> 3
//	rank: (c>>8)&0xf is already 0=deuce..12=ace in both encodings
//	stage: GameStage - 2 (PreFlop=2 -> 0 ... Showdown=6 -> 4)
//	min_bet: the highest bet this street (what a call matches) == toCall()
//	pot: sum of every player's TotalBet (collected streets + current bets)
//	players: exactly 6 slots keyed by seat position (the net was trained
//	6-handed; unused seats are zeroed and marked inactive)

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"sync"
	"time"

	mrand "math/rand"

	"github.com/alexclewontin/riverboat/eval"
	"github.com/evanofslack/go-poker/poker"
)

const aiRequestTimeout = 3 * time.Second

// aiCard is a [suit, rank] pair in pokers numbering.
type aiCard [2]int

type aiPlayerSlot struct {
	Active   bool    `json:"active"`
	Bet      float64 `json:"bet"`
	PotChips float64 `json:"pot_chips"`
	Stake    float64 `json:"stake"`
}

type aiActionRequest struct {
	PlayerID      int            `json:"player_id"`
	Hand          []aiCard       `json:"hand"`
	Community     []aiCard       `json:"community"`
	Stage         int            `json:"stage"`
	Pot           float64        `json:"pot"`
	MinBet        float64        `json:"min_bet"`
	MinRaise      float64        `json:"min_raise"`
	BB            float64        `json:"bb"`
	Button        int            `json:"button"`
	CurrentPlayer int            `json:"current_player"`
	Players       []aiPlayerSlot `json:"players"`
	LegalActions  []string       `json:"legal_actions"`
	Sample        bool           `json:"sample"`
}

type aiActionResponse struct {
	Kind       string             `json:"kind"`
	Amount     int                `json:"amount"`
	ActionType int                `json:"action_type"`
	Label      string             `json:"label"`
	Probabilities map[string]float64 `json:"probabilities"`
	ElapsedMS  float64            `json:"elapsed_ms"`
}

// aiSuitBit maps a riverboat suit bitmask onto the pokers suit number.
func aiSuitBit(bit int) (int, error) {
	switch bit {
	case 0x8000:
		return 0, nil // clubs
	case 0x4000:
		return 1, nil // diamonds
	case 0x2000:
		return 2, nil // hearts
	case 0x1000:
		return 3, nil // spades
	}
	return 0, fmt.Errorf("unknown suit bit %#x", bit)
}

func aiCardFrom(c eval.Card) (aiCard, error) {
	if c == 0 {
		// Undealt slot: the engine pre-allocates the community cards as
		// five zero entries and players hold zero cards before the deal,
		// so callers skip these rather than treat them as corruption.
		return aiCard{}, nil
	}
	suit, err := aiSuitBit(poker.CardSuit(c))
	if err != nil {
		// uint32: eval.Card formats itself with a custom verb that would
		// obscure the raw bits in diagnostics.
		return aiCard{}, fmt.Errorf("card %#x: %w", uint32(c), err)
	}
	return aiCard{suit, poker.CardRank(c)}, nil
}

// The /healthz probe result is cached so a lobby refresh or a burst of
// create-table requests cannot hammer the service (or stall on a dead one).
const (
	aiHealthTTL     = 10 * time.Second
	aiHealthTimeout = 2 * time.Second
)

var (
	aiHealthMu    sync.Mutex
	aiHealthAt    time.Time
	aiHealthOK    bool
	// aiHealthProbe is swappable in tests.
	aiHealthProbe = probeAIHealth
)

// resetAIHealthCache drops the cached /healthz verdict so the next
// aiServiceAvailable call probes again (used by tests).
func resetAIHealthCache() {
	aiHealthMu.Lock()
	defer aiHealthMu.Unlock()
	aiHealthAt = time.Time{}
}

// probeAIHealth asks the inference server for its /healthz endpoint.
func probeAIHealth(baseURL string) bool {
	client := &http.Client{Timeout: aiHealthTimeout}
	resp, err := client.Get(baseURL + "/healthz")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

// aiServiceAvailable reports whether the inference server is configured and
// currently healthy. This gates the "ai" bot type: a room may only be created
// with AI bots while this holds, and the lobby uses it to enable the choice.
func aiServiceAvailable() bool {
	url := os.Getenv("AI_INFERENCE_URL")
	if url == "" {
		return false
	}
	aiHealthMu.Lock()
	defer aiHealthMu.Unlock()
	if time.Since(aiHealthAt) < aiHealthTTL {
		return aiHealthOK
	}
	aiHealthOK = aiHealthProbe(url)
	aiHealthAt = time.Now()
	if !aiHealthOK {
		slog.Default().Warn("AI inference service unavailable", "url", url)
	}
	return aiHealthOK
}

// aiDecide asks the inference server for an action. It returns the same
// botAction shape as botDecide: for "raise", Amount is the chips to put in
// this action (call amount + raise), matching what handleRaise expects.
func aiDecide(baseURL string, view *poker.GameView, pn uint) (botAction, error) {
	if len(view.Players) > 6 {
		return botAction{}, fmt.Errorf("model is 6-handed, table has %d seats", len(view.Players))
	}
	p := view.Players[pn]

	// Pot: every chip committed this hand, collected streets included.
	pot := 0.0
	minBet := 0.0
	for i := range view.Players {
		pot += float64(view.Players[i].TotalBet)
		if b := float64(view.Players[i].Bet); b > minBet {
			minBet = b
		}
	}
	for i := range view.DepartedPlayers {
		pot += float64(view.DepartedPlayers[i].TotalBet)
	}

	// Six slots keyed by position; unused seats stay zeroed/inactive.
	slots := make([]aiPlayerSlot, 6)
	for i := range view.Players {
		q := view.Players[i]
		slots[q.Position] = aiPlayerSlot{
			Active:   q.In,
			Bet:      float64(q.Bet),
			PotChips: float64(q.TotalBet - q.Bet),
			Stake:    float64(q.Stack),
		}
	}

	hand := make([]aiCard, 0, 2)
	for _, c := range p.Cards {
		card, err := aiCardFrom(c)
		if err != nil {
			return botAction{}, err
		}
		if card != (aiCard{}) {
			hand = append(hand, card)
		}
	}
	community := make([]aiCard, 0, len(view.CommunityCards))
	for _, c := range view.CommunityCards {
		card, err := aiCardFrom(c)
		if err != nil {
			return botAction{}, err
		}
		if card != (aiCard{}) {
			community = append(community, card)
		}
	}

	// Legal set, mirroring the engine's bet() rules: fold is always available;
	// with nothing to match it is a check, otherwise a call; a raise needs
	// chips left beyond the call and betting not closed to us.
	callAmount := uint(minBet) - p.Bet
	legal := []string{"fold"}
	if callAmount == 0 {
		legal = append(legal, "check")
	} else {
		legal = append(legal, "call")
	}
	if (!p.Called || callAmount == 0) && p.Stack > callAmount {
		legal = append(legal, "raise")
	}

	bb := float64(view.Config.BigBlind)
	if bb == 0 {
		bb = 2
	}
	minRaise := float64(view.MinRaise)
	if minRaise == 0 {
		minRaise = bb
	}

	// GameStage.PreFlop=2..Showdown=6 -> pokers 0..4.
	stage := int(view.Stage) - 2
	if stage < 0 || stage > 4 {
		return botAction{}, fmt.Errorf("stage %d outside betting stages", view.Stage)
	}

	req := aiActionRequest{
		PlayerID:      int(pn),
		Hand:          hand,
		Community:     community,
		Stage:         stage,
		Pot:           pot,
		MinBet:        minBet,
		MinRaise:      minRaise,
		BB:            bb,
		Button:        int(view.DealerNum),
		CurrentPlayer: int(view.ActionNum),
		Players:       slots,
		LegalActions:  legal,
		Sample:        true,
	}

	body, err := json.Marshal(req)
	if err != nil {
		return botAction{}, err
	}
	client := &http.Client{Timeout: aiRequestTimeout}
	resp, err := client.Post(baseURL+"/v1/act", "application/json", bytes.NewReader(body))
	if err != nil {
		return botAction{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return botAction{}, fmt.Errorf("inference server: HTTP %d", resp.StatusCode)
	}
	var out aiActionResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return botAction{}, err
	}

	slog.Default().Info("AI action",
		"player", pn, "kind", out.Kind, "amount", out.Amount,
		"label", out.Label, "inference_ms", out.ElapsedMS)

	switch out.Kind {
	case "fold", "check", "call":
		return botAction{kind: out.Kind}, nil
	case "raise":
		return botAction{kind: "raise", amount: uint(out.Amount)}, nil
	}
	return botAction{}, fmt.Errorf("inference server: unknown kind %q", out.Kind)
}

// decideBotAction is the single decision entry point used by the bot loop.
// The room's bot kind decides the brain: only botKindAI rooms consult the
// model (AI_INFERENCE_URL must be set), every other room always uses the
// built-in heuristic — a reachable service alone never turns normal bots
// into AI bots. The heuristic is also the safety net whenever the service
// errors out for an AI room mid-hand.
func decideBotAction(kind string, view *poker.GameView, pn uint) botAction {
	if kind == botKindAI {
		if url := os.Getenv("AI_INFERENCE_URL"); url != "" {
			if act, err := aiDecide(url, view, pn); err == nil {
				return act
			} else {
				slog.Default().Warn("AI decide failed; using heuristic", "error", err)
			}
		}
	}
	return botDecide(view, pn, mrand.Float64)
}
