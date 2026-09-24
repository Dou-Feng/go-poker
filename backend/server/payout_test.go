package server

import (
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/evanofslack/go-poker/poker"
)

func TestDeparturePayoutRetriesBeforeEmptyRoomDestruction(t *testing.T) {
	for _, departure := range []string{"leave", "timeout", "spectate"} {
		t.Run(departure, func(t *testing.T) {
			tbl, rec := newTestTable(t)
			tbl.settlementDelay = 5 * time.Millisecond
			hub := newSessionHub(tbl)
			c := newTestClient(hub, "a")
			c.table = tbl
			c.uuid = seat(t, tbl, "a", 1, false)
			tbl.registerClient(c)
			var recovered atomic.Bool
			tbl.flush = func(account, room string, buy, stack uint, stats poker.PlayerStats) (uint, error) {
				if !recovered.Load() {
					return 0, errors.New("storage unavailable")
				}
				return rec.flush(account, room, buy, stack, stats)
			}
			switch departure {
			case "leave":
				handleLeaveTable(c, tbl.name)
				tbl.unregisterClient(<-tbl.unregister)
			case "timeout":
				tbl.unregisterClient(c)
				tbl.timeoutPlayer(c.uuid)
			case "spectate":
				if !tbl.applySpectate(c) {
					t.Fatal("could not move to spectators")
				}
				tbl.unregisterClient(c)
			}
			if hub.findTable(tbl.name) != tbl || !tbl.hasPendingPayouts() || len(rec.snapshot()) != 0 {
				t.Fatal("failed departure refund was discarded")
			}
			recovered.Store(true)
			waitFor(t, "refund and room shutdown", func() bool {
				select {
				case <-tbl.stop:
					return true
				default:
					return false
				}
			})
			assertTableDestroyed(t, hub, tbl)
			if got := rec.snapshot(); len(got) != 1 || got[0].AccountUUID != "a" || got[0].Stack != 200 {
				t.Fatalf("refund missing or duplicated: %+v", got)
			}
		})
	}
}

func TestPendingPayoutKeepsSnapshotAcrossSessionReset(t *testing.T) {
	tbl, rec := newTestTable(t)
	tbl.settlementDelay = time.Hour
	id := seat(t, tbl, "a", 1, false)
	sessionID := tbl.sessionID
	tbl.flush = func(string, string, uint, uint, poker.PlayerStats) (uint, error) {
		return 0, errors.New("storage unavailable")
	}
	tbl.evictPlayer(id)
	if tbl.sessionID == sessionID {
		t.Fatal("fixture did not reset the empty session")
	}
	tbl.payoutMu.Lock()
	payout := tbl.pendingPayouts[id]
	tbl.payoutMu.Unlock()
	if payout.sessionID != sessionID || payout.stack != 200 || payout.totalBuyIn != 200 {
		t.Fatalf("original payout was lost: %+v", payout)
	}
	tbl.flush = rec.flush
	// Even a caller supplying newer state must retry the original snapshot.
	if _, err := tbl.flushSeat(id, "wrong-account", 999, 1, poker.PlayerStats{}); err != nil {
		t.Fatal(err)
	}
	if _, err := tbl.flushSeat(id, "a", 200, 200, poker.PlayerStats{}); err != nil {
		t.Fatal(err)
	}
	if got := rec.snapshot(); len(got) != 1 || got[0].AccountUUID != "a" || got[0].Stack != 200 || tbl.hasPendingPayouts() {
		t.Fatalf("snapshot changed or duplicate refund: %+v", got)
	}
}

// A player who disconnects on their own turn while facing a preflop open is
// folded by LeaveHand inside evictPlayer: the settled snapshot must carry
// the engine's fold and 3-bet opportunity, not the pre-departure stats.
func TestEvictionOnTurnSettlesFoldAndThreeBetOpportunity(t *testing.T) {
	tbl, rec := newTestTable(t)
	seat(t, tbl, "a", 1, true)
	b := seat(t, tbl, "b", 2, true)
	seat(t, tbl, "c", 3, true)
	if err := tbl.game.Start(); err != nil {
		t.Fatal(err)
	}
	// a (seat 1, UTG) opens for 3x the 2-chip big blind; the action is on b.
	if err := poker.Bet(tbl.game, 0, 6); err != nil {
		t.Fatal(err)
	}
	tbl.evictPlayer(b)
	got := rec.snapshot()
	if len(got) != 1 || got[0].AccountUUID != "b" {
		t.Fatalf("unexpected settled flushes: %+v", got)
	}
	if got[0].Stats.Folds != 1 || got[0].Stats.ThreeBetOpportunities != 1 {
		t.Fatalf("settled stats missed the on-turn fold or opportunity: %+v", got[0].Stats)
	}
}

func TestMidHandPayoutRetriesWithoutRemovingOtherPlayers(t *testing.T) {
	tbl, rec := newTestTable(t)
	tbl.settlementDelay = 5 * time.Millisecond
	hub := newSessionHub(tbl)
	a := seat(t, tbl, "a", 1, true)
	b := seat(t, tbl, "b", 2, true)
	seat(t, tbl, "c", 3, true)
	if err := tbl.game.Start(); err != nil {
		t.Fatal(err)
	}
	var recovered atomic.Bool
	tbl.flush = func(account, room string, buy, stack uint, stats poker.PlayerStats) (uint, error) {
		if !recovered.Load() {
			return 0, errors.New("storage unavailable")
		}
		return rec.flush(account, room, buy, stack, stats)
	}
	tbl.evictPlayer(a)
	if !tbl.hasPendingPayouts() {
		t.Fatal("missing pending refund")
	}
	recovered.Store(true)
	waitFor(t, "mid-hand refund", func() bool { return !tbl.hasPendingPayouts() })
	if hub.findTable(tbl.name) != tbl {
		t.Fatal("refund completion destroyed a room with seated humans")
	}
	if _, exists := findPlayer(tbl.game.GenerateOmniView(), b); !exists {
		t.Fatal("another player's seat was lost")
	}
	if got := rec.snapshot(); len(got) != 1 || got[0].AccountUUID != "a" || got[0].Stack != 200 || got[0].Stats.Folds != 1 {
		t.Fatalf("incorrect departure snapshot: %+v", got)
	}
}
