package server

import (
	"errors"
	"reflect"
	"sync/atomic"
	"testing"
	"time"

	"github.com/evanofslack/go-poker/poker"
)

func settlementFixture(t *testing.T) (*table, *flushRecorder, *Client) {
	t.Helper()
	tbl, rec := newTestTable(t)
	a := seat(t, tbl, "a", 1, true)
	seat(t, tbl, "b", 2, true)
	view := tbl.game.GenerateOmniView()
	for i := range view.Players {
		view.Players[i].Stats.HandsPlayed = 1
	}
	tbl.game.FillFromView(view)
	tbl.settlementDelay = time.Hour
	c := newTestClient(nil, "a")
	c.table = tbl
	c.uuid = a
	return tbl, rec, c
}

func TestSettlementFailureFreezesRoomAndRetriesOnlyUnpaidSeats(t *testing.T) {
	tbl, rec, c := settlementFixture(t)
	sessionID := tbl.sessionID
	fail := true
	tbl.flush = func(account, room string, buy, stack uint, stats poker.PlayerStats) (uint, error) {
		if account == "b" && fail {
			return 0, errors.New("storage unavailable")
		}
		return rec.flush(account, room, buy, stack, stats)
	}
	tbl.settleAfterHand = true
	if !tbl.maybeSettleAfterHand() {
		t.Fatal("vote did not trigger settlement")
	}
	before := tbl.game.GenerateOmniView()
	if !tbl.settlementPending.Load() || len(before.Players) != 2 || len(rec.snapshot()) != 1 || tbl.sessionID != sessionID {
		t.Fatal("failed settlement discarded unpaid state")
	}
	handleToggleReady(c)
	handleMoveSeat(c, 3)
	handleRebuy(c, 100)
	handleUndoRebuy(c)
	handleResetGame(c)
	handleDealGame(c)
	if autoStartIfReady(tbl) {
		t.Fatal("pending room started a hand")
	}
	if _, ok := tbl.evictPlayer(c.uuid); ok {
		t.Fatal("eviction changed pending payouts")
	}
	if tbl.applySpectate(c) {
		t.Fatal("spectate changed pending payouts")
	}
	if err := tbl.seatHuman(newTestClient(nil, "c"), 3, 200); err == nil {
		t.Fatal("pending room admitted a seat")
	}
	if !reflect.DeepEqual(before, tbl.game.GenerateOmniView()) {
		t.Fatal("pending settlement can be mutated")
	}
	fail = false
	tbl.settle()
	calls := rec.snapshot()
	if tbl.settlementPending.Load() || len(tbl.game.GenerateOmniView().Players) != 0 || len(calls) != 2 || calls[0].AccountUUID == calls[1].AccountUUID {
		t.Fatalf("retry lost or duplicated refunds: %+v", calls)
	}
	if tbl.sessionID == sessionID {
		t.Fatal("successful settlement did not reset session")
	}
}

func TestSettlementHistoryFailureDoesNotRepeatPayouts(t *testing.T) {
	tbl, rec, _ := settlementFixture(t)
	fail := true
	var saved SessionRecord
	tbl.persist = func(record SessionRecord) error {
		if fail {
			return errors.New("history unavailable")
		}
		saved = record
		return nil
	}
	tbl.settle()
	if !tbl.settlementPending.Load() || len(rec.snapshot()) != 2 || len(tbl.game.GenerateOmniView().Players) != 2 {
		t.Fatal("history failure cleared settlement")
	}
	fail = false
	tbl.settle()
	if tbl.settlementPending.Load() || len(rec.snapshot()) != 2 || !saved.Settled || len(saved.Players) != 2 {
		t.Fatal("history retry repeated refunds or lost roster")
	}
}

func TestSettlementAutomaticallyRetriesAndDefersEmptyRoomExpiry(t *testing.T) {
	tbl, rec, c := settlementFixture(t)
	tbl.settlementDelay = 5 * time.Millisecond
	drainBroadcasts(t, tbl)
	hub := newSessionHub(tbl)
	// Keep a spectator online when the retry succeeds; expiry is checked
	// separately while storage is unavailable.
	tbl.registerClient(c)
	var recoverStore atomic.Bool
	tbl.flush = func(account, room string, buy, stack uint, stats poker.PlayerStats) (uint, error) {
		if !recoverStore.Load() {
			return 0, errors.New("storage unavailable")
		}
		return rec.flush(account, room, buy, stack, stats)
	}
	tbl.settle()
	hub.destroyTable(tbl)
	if hub.findTable(tbl.name) != tbl {
		t.Fatal("room with unpaid balances was destroyed")
	}
	recoverStore.Store(true)
	waitFor(t, "automatic settlement retry", func() bool { return !tbl.settlementPending.Load() })
	if len(rec.snapshot()) != 2 || len(tbl.game.GenerateOmniView().Players) != 0 {
		t.Fatal("retry did not complete payouts")
	}
}

func TestShutdownStopsSettlementRetry(t *testing.T) {
	tbl, _, _ := settlementFixture(t)
	var calls atomic.Int32
	tbl.flush = func(string, string, uint, uint, poker.PlayerStats) (uint, error) {
		calls.Add(1)
		return 0, errors.New("storage unavailable")
	}
	tbl.settle()
	tbl.shutdown()
	tbl.retrySettlement()
	if calls.Load() != 1 {
		t.Fatal("settlement ran after shutdown")
	}
}
