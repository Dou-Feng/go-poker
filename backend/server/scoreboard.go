package server

import (
	"log/slog"
	"sync"

	"github.com/evanofslack/go-poker/poker"
)

// Room-session accounting shared by the scoreboard and the buy-in cap.
//
// A player entry in the engine only lives while the player is seated; leaving
// (or being moved to the spectator side after busting) snapshots it into
// DepartedPlayers and a later re-seat starts a fresh entry with TotalBuyIn 0.
// Two things follow from that and are handled here:
//
//   - the scoreboard would list the same account twice, so rows are merged by
//     account (buy-ins and nets summed);
//   - the room's max buy-in (MaxBuy) is per seat entry in the engine, so a
//     player could bust, leave, and re-sit to buy in again. sessionBuyIn keeps
//     the account's total across the whole room session and is checked before
//     any seat is taken or queued.

const (
	msgNoBuyInsLeft = "no buy-ins left"
	msgBustedOut    = "busted: no buy-ins left"
)

// sessionLedger tracks every account's total buy-in for the current room
// session (reset when the session settles or the room resets).
type sessionLedger struct {
	mu     sync.Mutex
	buyIns map[string]uint
}

func newSessionLedger() *sessionLedger {
	return &sessionLedger{buyIns: make(map[string]uint)}
}

// add records a buy-in (or, with a negative sign handled by sub, an undo).
func (l *sessionLedger) add(account string, amount uint) {
	if account == "" || amount == 0 {
		return
	}
	l.mu.Lock()
	l.buyIns[account] += amount
	l.mu.Unlock()
}

// sub reverses part of an account's buy-in (undo before the hand starts).
func (l *sessionLedger) sub(account string, amount uint) {
	if account == "" || amount == 0 {
		return
	}
	l.mu.Lock()
	if l.buyIns[account] <= amount {
		delete(l.buyIns, account)
	} else {
		l.buyIns[account] -= amount
	}
	l.mu.Unlock()
}

// total returns the account's buy-ins so far this session.
func (l *sessionLedger) total(account string) uint {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.buyIns[account]
}

// reset forgets every account (new session).
func (l *sessionLedger) reset() {
	l.mu.Lock()
	l.buyIns = make(map[string]uint)
	l.mu.Unlock()
}

// canBuyIn reports whether the account may add `amount` more chips under the
// room's MaxBuy (0 = unlimited), counting everything it bought this session.
func (t *table) canBuyIn(account string, amount uint) bool {
	maxBuy := t.game.GenerateOmniView().Config.MaxBuy
	if maxBuy == 0 {
		return true
	}
	return t.ledger.total(account)+amount <= maxBuy
}

// resetSession clears the per-session state that must not survive a
// settlement or a room reset: settle votes and the buy-in ledger. It is the
// single place to extend when more session state appears.
func (t *table) resetSession() {
	t.startNewSession()
	t.ledger.reset()
}

// settlementRows builds the scoreboard: one row per account, merging a
// player's seated entry with any earlier departed snapshots of the same
// account (a player who left or busted and sat down again). Departed players
// who never bought in (a queued seat never dealt in) are skipped. The nets of
// all rows sum to zero, since every chip that changed hands is still counted
// exactly once. Rows keep the engine's order: seated players first, then
// departed-only accounts in departure order.
func settlementRows(view *poker.GameView) []settlementPlayer {
	rows := make([]settlementPlayer, 0, len(view.Players)+len(view.DepartedPlayers))
	index := make(map[string]int, len(view.Players))

	// The engine's player type is unexported, so rows are fed field by field.
	addOrMerge := func(account, seatUUID, username, avatar string, avatarImage bool, buyIn, stack uint) {
		key := account
		if key == "" {
			// No account (should not happen for a seated player): keep as its
			// own row rather than merging strangers together.
			key = "seat:" + seatUUID
		}
		net := int(stack) - int(buyIn)
		if i, ok := index[key]; ok {
			rows[i].BuyIn += buyIn
			rows[i].Net += net
			return
		}
		index[key] = len(rows)
		rows = append(rows, settlementPlayer{
			Username:    username,
			UUID:        account,
			Avatar:      avatar,
			AvatarImage: avatarImage,
			BuyIn:       buyIn,
			Net:         net,
		})
	}

	for i := range view.Players {
		p := &view.Players[i]
		addOrMerge(p.AccountUUID, p.UUID, p.Username, p.Avatar, p.AvatarImage, p.TotalBuyIn, p.Stack)
	}
	for i := range view.DepartedPlayers {
		p := &view.DepartedPlayers[i]
		if p.TotalBuyIn == 0 {
			continue
		}
		addOrMerge(p.AccountUUID, p.UUID, p.Username, p.Avatar, p.AvatarImage, p.TotalBuyIn, p.Stack)
	}
	return rows
}

// notifyAccount sends one message to every connected client of the account.
func (t *table) notifyAccount(account string, msg []byte) {
	if account == "" {
		return
	}
	t.clientsMu.Lock()
	defer t.clientsMu.Unlock()
	for c := range t.clients {
		if c.accountUUID != account {
			continue
		}
		select {
		case c.send <- msg:
		default:
			slog.Default().Warn("Drop notice, client queue full", "account", account)
		}
	}
}
