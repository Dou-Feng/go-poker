package poker

import (
	. "github.com/alexclewontin/riverboat/eval"
	"github.com/google/uuid"
)

// PositionLabel classifies a player's preflop seat relative to the button.
type PositionLabel int

const (
	PosBTN PositionLabel = iota
	PosSB
	PosBB
	PosUTG // under the gun
	PosMP  // middle position
	PosCO  // cutoff
	PosLabelCount
)

// PlayerStats accumulates a single session's worth of per-player statistics.
// The server merges these into a user's lifetime record when they leave.
type PlayerStats struct {
	HandsPlayed uint                `json:"handsPlayed"`
	HandsWon    uint                `json:"handsWon"`
	Folds       uint                `json:"folds"`
	Calls       uint                `json:"calls"`
	Raises      uint                `json:"raises"`
	ThreeBets   uint                `json:"threeBets"`
	MaxPotWon   uint                `json:"maxPotWon"`
	VPIP        uint                `json:"vpip"`
	VPIPByPos   [PosLabelCount]uint `json:"vpipByPos"`
}

// PlayerState is the player state machine (change.md「玩家状态」章节):
//
//	NotReady   — seated but not readied: rebuy / move seat / spectate allowed
//	Ready      — readied up; waiting for the table to start (auto when all ready)
//	Playing    — in the current hand, can act when it is their turn
//	AllIn      — in the current hand but committed all chips: turns are skipped,
//	             may voluntarily show their cards, still contest the pot
//	Spectating — watching from the spectator side; may queue for the next hand
//	Offline    — disconnected: auto-fold on turn and removed before the next
//	             hand unless all-in (then showdown with forfeit penalty)
//
// Note: Ready/In below are retained as fast-path flags derived from State —
// Ready mirrors State==Ready, In mirrors State in {Playing, AllIn}.
type PlayerState uint8

const (
	PlayerNotReady PlayerState = iota + 1
	PlayerReady
	PlayerPlaying
	PlayerAllIn
	PlayerSpectating
	PlayerOffline
)

type player struct {
	Username     string      `json:"username"`
	UUID         string      `json:"uuid"`
	AccountUUID  string      `json:"accountUuid"`
	Position     uint        `json:"position"`
	SeatID       uint        `json:"seatID"`
	State        PlayerState `json:"state"`
	Ready        bool        `json:"ready"`
	In           bool        `json:"in"`
	Called       bool        `json:"called"`
	Left         bool        `json:"left"`
	TotalBuyIn   uint        `json:"totalBuyIn"`
	PendingBuyIn uint        `json:"-"`
	Stack        uint        `json:"stack"`
	Bet          uint        `json:"bet"`
	TotalBet     uint        `json:"totalBet"`
	Cards        [2]Card     `json:"cards"`
	Stats        PlayerStats `json:"stats"`
	Avatar       string      `json:"avatar"`
	AvatarImage  bool        `json:"avatarImage"`
	Revealed     bool        `json:"revealed"`
	// BestHand is populated on showdown for revealed/all-in players: the
	// name of their best five-card hand (e.g. "full house").
	BestHand string `json:"bestHand,omitempty"`
}

// setState assigns a state and keeps the derived fast-path flags in sync.
func (p *player) setState(s PlayerState) {
	p.State = s
	p.Ready = s == PlayerReady
	p.In = s == PlayerPlaying || s == PlayerAllIn
}

func (p *player) allIn() bool {
	return p.In && (p.Stack == 0)
}

func (p *player) initialize() {
	*p = player{}

	p.UUID = uuid.New().String()
	p.setState(PlayerNotReady)
	p.Called = false

}

// putInChips is simply a helper function that transfers the amounts between fields
func (p *player) putInChips(amt uint) {
	if p.Stack > amt {
		p.Bet += amt
		p.TotalBet += amt
		p.Stack -= amt
	} else {
		p.Bet += p.Stack
		p.TotalBet += p.Stack
		p.Stack = 0
	}
}

func (p *player) returnChips(amt uint) {
	if p.TotalBet > amt {
		p.TotalBet -= amt
		p.Stack += amt
	} else {
		p.Stack += p.TotalBet
		p.TotalBet = 0
	}
}
