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
	HandsPlayed uint `json:"handsPlayed"`
	HandsWon    uint `json:"handsWon"`
	Folds       uint `json:"folds"`
	Calls       uint `json:"calls"`
	Raises      uint `json:"raises"`
	ThreeBets   uint `json:"threeBets"`
	MaxPotWon   uint `json:"maxPotWon"`
	VPIP        uint `json:"vpip"`
	VPIPByPos   [PosLabelCount]uint `json:"vpipByPos"`
}

type player struct {
	Username    string      `json:"username"`
	UUID        string      `json:"uuid"`
	Position    uint        `json:"position"`
	SeatID      uint        `json:"seatID"`
	Ready       bool        `json:"ready"`
	In          bool        `json:"in"`
	Called      bool        `json:"called"`
	Left        bool        `json:"left"`
	TotalBuyIn  uint        `json:"totalBuyIn"`
	Stack       uint        `json:"stack"`
	Bet         uint        `json:"bet"`
	TotalBet    uint        `json:"totalBet"`
	Cards       [2]Card     `json:"cards"`
	Stats       PlayerStats `json:"stats"`
	Avatar      string      `json:"avatar"`
	AvatarImage bool        `json:"avatarImage"`
}

func (p *player) allIn() bool {
	return p.In && (p.Stack == 0)
}

func (p *player) initialize() {
	*p = player{}

	p.UUID = uuid.New().String()
	p.Ready = false
	p.In = false
	p.Called = false

}

//putInChips is simply a helper function that transfers the amounts between fields
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
