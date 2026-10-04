package server

import (
	"testing"
	"time"

	"github.com/evanofslack/go-poker/poker"
)

func TestProgressionRecoversShowdownWithoutBrowser(t *testing.T) {
	tbl := clockRoom(t, 0)
	tbl.progression.showdownDelay = 20 * time.Millisecond
	handleFold(actionClient(t, tbl))
	waitFor(t, "server starts next hand", func() bool {
		v := tbl.game.GenerateOmniView()
		return v.Stage == poker.PreFlop && v.HandsPlayed == 1
	})
}

func TestProgressionRunsOutWithoutBrowser(t *testing.T) {
	tbl := clockRoom(t, 0)
	tbl.progression.runoutDelay = 10 * time.Millisecond
	tbl.progression.showdownDelay = time.Hour
	view := tbl.game.GenerateOmniView()
	handleRaise(actionClient(t, tbl), view.Players[view.ActionNum].Stack)
	handleCall(actionClient(t, tbl))
	waitFor(t, "server completes all-in board", func() bool {
		return tbl.game.GenerateOmniView().Stage == poker.Showdown
	})
	if v := tbl.game.GenerateOmniView(); len(v.Pots) == 0 {
		t.Fatal("runout did not settle the pot")
	}
}

func TestProgressionRebroadcastKeepsTimerAndIgnoresOldStage(t *testing.T) {
	tbl := clockRoom(t, 0)
	tbl.progression.showdownDelay = time.Hour
	handleFold(actionClient(t, tbl))
	key, timer := tbl.progression.key, tbl.progression.timer
	tbl.broadcastGame()
	if tbl.progression.timer != timer {
		t.Fatal("rebroadcast postponed progression")
	}
	handleDealGame(actionClient(t, tbl))
	before := tbl.game.GenerateOmniView()
	tbl.enforceProgression(key)
	after := tbl.game.GenerateOmniView()
	if after.Stage != before.Stage || after.HandsPlayed != before.HandsPlayed || after.ActionNum != before.ActionNum {
		t.Fatal("stale timer advanced the next hand")
	}
}

func TestProgressionHonorsHandLimit(t *testing.T) {
	tbl := clockRoom(t, 0)
	view := tbl.game.GenerateOmniView()
	view.Config.HandsLimit = 1
	tbl.game.FillFromView(view)
	tbl.progression.showdownDelay = 20 * time.Millisecond
	handleFold(actionClient(t, tbl))
	waitFor(t, "session settles at limit", func() bool { return len(tbl.game.GenerateOmniView().Players) == 0 })
}

func TestProgressionStopsWithRoom(t *testing.T) {
	tbl := clockRoom(t, 0)
	tbl.progression.showdownDelay = time.Hour
	handleFold(actionClient(t, tbl))
	key := tbl.progression.key
	tbl.shutdown()
	tbl.enforceProgression(key)
	if tbl.game.GenerateOmniView().Stage != poker.Showdown {
		t.Fatal("closed room advanced")
	}
}

// Drive nineteen real hands before the final runout. Neither board dealing
// nor session settlement on the last hand receives a browser deal request.
func TestProgressionSettlesTwentiethHandAllIn(t *testing.T) {
	for _, foldedRaise := range []bool{false, true} {
		name := "four-way"
		if foldedRaise {
			name = "folded-raise"
		}
		t.Run(name, func(t *testing.T) {
			tbl, rec := newTestTable(t)
			drainBroadcasts(t, tbl)
			poker.Configure(tbl.game, 1, 2, 200, 400, 6, 20)
			tbl.progression.runoutDelay = 10 * time.Millisecond
			tbl.progression.showdownDelay = time.Hour
			for i, account := range []string{"a", "b", "c", "d"} {
				seat(t, tbl, account, uint(i+1), false)
			}
			total := uint(800)
			if foldedRaise {
				// On hand 20 the button is seat 4: seat 3 is the short-stack opener,
				// seat 1 raises, and seat 2 shoves over that raise.
				if err := poker.BuyIn(tbl.game, 1, 200); err != nil {
					t.Fatal(err)
				}
				if err := poker.UndoBuyIn(tbl.game, 2, 150); err != nil {
					t.Fatal(err)
				}
				total = 850
			}
			for pn := uint(0); pn < 4; pn++ {
				if err := poker.ToggleReady(tbl.game, pn, 0); err != nil {
					t.Fatal(err)
				}
			}
			if !autoStartIfReady(tbl) {
				t.Fatal("cannot start")
			}
			for hand := uint(0); hand < 19; hand++ {
				for steps := 0; tbl.game.GenerateOmniView().Stage != poker.Showdown; steps++ {
					if steps > 3 {
						t.Fatal("folds did not complete hand")
					}
					handleFold(actionClient(t, tbl))
				}
				handleDealGame(actionClient(t, tbl))
			}
			if v := tbl.game.GenerateOmniView(); v.HandsPlayed != 19 || v.Stage != poker.PreFlop {
				t.Fatalf("unexpected final hand: %+v", v)
			}
			tbl.progression.mu.Lock()
			tbl.progression.showdownDelay = 10 * time.Millisecond
			tbl.progression.mu.Unlock()
			if foldedRaise {
				v := tbl.game.GenerateOmniView()
				short := v.Players[v.ActionNum].Stack
				handleRaise(actionClient(t, tbl), short)
				handleCall(actionClient(t, tbl))
				v = tbl.game.GenerateOmniView()
				handleRaise(actionClient(t, tbl), short*2-v.Players[v.ActionNum].Bet)
				v = tbl.game.GenerateOmniView()
				handleRaise(actionClient(t, tbl), v.Players[v.ActionNum].Stack)
				handleFold(actionClient(t, tbl))
				handleFold(actionClient(t, tbl))
			} else {
				for steps := 0; tbl.game.GenerateOmniView().Betting; steps++ {
					if steps > 4 {
						t.Fatal("all-ins did not finish betting")
					}
					v := tbl.game.GenerateOmniView()
					handleRaise(actionClient(t, tbl), v.Players[v.ActionNum].Stack)
				}
			}
			waitFor(t, "final all-in settlement", func() bool { return len(tbl.game.GenerateOmniView().Players) == 0 })
			payouts := rec.snapshot()
			if len(payouts) != 4 {
				t.Fatalf("expected four payouts, got %+v", payouts)
			}
			var paid uint
			for _, p := range payouts {
				paid += p.Stack
			}
			if paid != total {
				t.Fatalf("paid %d, want %d", paid, total)
			}
		})
	}
}

// A concurrent presence/reveal broadcast can finish arming its timers after
// the next street has already been dealt. Its old snapshot must not cancel
// the current river timer, even when the browser sends no further requests.
func TestProgressionIgnoresStaleBroadcastAtRiver(t *testing.T) {
	for _, staleBetting := range []bool{true, false} {
		name := "old-runout"
		if staleBetting {
			name = "old-betting"
		}
		t.Run(name, func(t *testing.T) {
			tbl := clockRoom(t, 0)
			tbl.progression.runoutDelay = time.Hour
			tbl.progression.showdownDelay = time.Hour
			before := tbl.game.GenerateOmniView()
			handleRaise(actionClient(t, tbl), before.Players[before.ActionNum].Stack)
			handleCall(actionClient(t, tbl))
			stale := before
			for tbl.game.GenerateOmniView().Stage != poker.Turn {
				handleDealGame(actionClient(t, tbl))
			}
			if !staleBetting {
				stale = tbl.game.GenerateOmniView()
			}
			tbl.progression.mu.Lock()
			tbl.progression.runoutDelay = 10 * time.Millisecond
			tbl.progression.mu.Unlock()
			handleDealGame(actionClient(t, tbl))
			tbl.armProgression(stale)
			waitFor(t, "river showdown despite stale broadcast", func() bool { return tbl.game.GenerateOmniView().Stage == poker.Showdown })
		})
	}
}
