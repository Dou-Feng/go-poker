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
