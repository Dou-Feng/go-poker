package server

import (
	"time"

	"github.com/evanofslack/go-poker/poker"
)

// Keep the original payout even after a departed seat or its room session is
// reset. Retrying against the live player would lose the stack or attach the
// history to a newer session. payoutMu protects both this queue and paidSeats.
type seatPayout struct {
	accountUUID string
	sessionID   string
	totalBuyIn  uint
	stack       uint
	stats       poker.PlayerStats
}

func (t *table) flushPayout(p seatPayout) (uint, error) {
	if isBotAccount(p.accountUUID) {
		return p.stack, nil
	}
	if t.flush != nil {
		return t.flush(p.accountUUID, t.name, p.totalBuyIn, p.stack, p.stats)
	}
	return flushPlayerSession(t.rdb, p.accountUUID, t.name, p.sessionID, p.totalBuyIn, p.stack, p.stats)
}

// flushSeat pays a seat once. Every failed write retains its original inputs
// and schedules a retry, including ordinary departures and spectator moves.
func (t *table) flushSeat(seatUUID, accountUUID string, totalBuyIn, stack uint, stats poker.PlayerStats) (uint, error) {
	t.payoutMu.Lock()
	defer t.payoutMu.Unlock()
	if balance, ok := t.paidSeats[seatUUID]; ok {
		return balance, nil
	}
	p, queued := t.pendingPayouts[seatUUID]
	if !queued {
		p = seatPayout{accountUUID, t.sessionID, totalBuyIn, stack, stats}
	}
	balance, err := t.flushPayout(p)
	if err != nil {
		if t.pendingPayouts == nil {
			t.pendingPayouts = make(map[string]seatPayout)
		}
		t.pendingPayouts[seatUUID] = p
		t.schedulePayoutRetry()
		return 0, err
	}
	t.recordPayout(seatUUID, balance)
	return balance, nil
}

// Called with payoutMu held, including when settlement retries beat the timer.
func (t *table) recordPayout(seatUUID string, balance uint) {
	if t.paidSeats == nil {
		t.paidSeats = make(map[string]uint)
	}
	t.paidSeats[seatUUID] = balance
	delete(t.pendingPayouts, seatUUID)
	if len(t.pendingPayouts) == 0 && t.payoutRetry != nil {
		t.payoutRetry.Stop()
		t.payoutRetry = nil
	}
}

func (t *table) schedulePayoutRetry() {
	if t.payoutRetry == nil {
		t.payoutRetry = time.AfterFunc(t.settlementDelay, t.retryPayouts)
	}
}

func (t *table) hasPendingPayouts() bool {
	t.payoutMu.Lock()
	defer t.payoutMu.Unlock()
	return len(t.pendingPayouts) > 0
}

func (t *table) retryPayouts() {
	t.payoutMu.Lock()
	t.payoutRetry = nil
	select {
	case <-t.stop:
		t.payoutMu.Unlock()
		return
	default:
	}
	for seatUUID, payout := range t.pendingPayouts {
		if balance, err := t.flushPayout(payout); err == nil {
			t.recordPayout(seatUUID, balance)
		}
	}
	if len(t.pendingPayouts) > 0 {
		t.schedulePayoutRetry()
	}
	t.payoutMu.Unlock()
	// Destruction is deferred while any refund is unpaid. A live room can
	// continue; only an empty room is recycled once its refunds succeed.
	t.destroyIfEmpty()
}
