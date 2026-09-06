package server

import (
	"fmt"
	"sync"
	"time"

	"github.com/evanofslack/go-poker/poker"
)

// Action clock: a room may give each player a fixed time to act (set when the
// room is created; 0 = no clock). This is the one place the server advances a
// hand on its own: when the clock runs out the player to act is checked if a
// check is legal and folded otherwise, and the table is broadcast as if they
// had acted.
//
// The deadline belongs to a *turn*, identified by the hand, street, acting
// position and the acting player's seat uuid. Every broadcast re-arms the
// clock: an unchanged turn keeps its deadline (so rebroadcasts caused by a
// chat message, a reservation or a join never reset the clock), a new turn
// starts a fresh one, and no turn (between hands, runout, showdown) clears it.
// Clients receive the remaining time, not the absolute deadline, so phone
// clocks that are off by minutes still draw the right countdown.

type actionClock struct {
	mu       sync.Mutex
	timeout  time.Duration // 0 = off
	key      string        // turn the deadline belongs to; "" = no deadline
	deadline time.Time
	timer    *time.Timer
}

// minActionTimeout / maxActionTimeout bound what a room creator may set.
const (
	minActionTimeout = 5 * time.Second
	maxActionTimeout = 5 * time.Minute
)

// normalizeActionTimeout turns the create-table seconds into a duration:
// 0 stays off, anything else is clamped to a sane range.
func normalizeActionTimeout(seconds uint) time.Duration {
	if seconds == 0 {
		return 0
	}
	d := time.Duration(seconds) * time.Second
	if d < minActionTimeout {
		return minActionTimeout
	}
	if d > maxActionTimeout {
		return maxActionTimeout
	}
	return d
}

// turnKey identifies the turn a view is in, or "" when nobody is on the clock.
func turnKey(view *poker.GameView) string {
	if !view.Running || !view.Betting || int(view.ActionNum) >= len(view.Players) {
		return ""
	}
	return fmt.Sprintf("%d/%d/%d/%s", view.HandsPlayed, view.Stage, view.ActionNum, view.Players[view.ActionNum].UUID)
}

// armActionClock brings the clock in line with the current view: start it for
// a new turn, keep it for the same turn, clear it when nobody is to act.
// Called from broadcastGame before the view is serialised.
func (t *table) armActionClock(view *poker.GameView) {
	c := &t.clock
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.timeout <= 0 {
		return
	}
	key := turnKey(view)
	if key == c.key {
		return
	}
	if c.timer != nil {
		c.timer.Stop()
		c.timer = nil
	}
	c.key = key
	if key == "" {
		c.deadline = time.Time{}
		return
	}
	c.deadline = time.Now().Add(c.timeout)
	c.timer = time.AfterFunc(c.timeout, func() { t.enforceActionClock(key) })
}

// stopActionClock cancels a pending timeout (room recycled).
func (t *table) stopActionClock() {
	c := &t.clock
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.timer != nil {
		c.timer.Stop()
		c.timer = nil
	}
	c.key = ""
}

// actionClockState reports the clock's length in seconds and, when a turn is
// on the clock, the milliseconds left; both 0 when the clock is off.
func (t *table) actionClockState() (timeoutSec int, remainingMs int64) {
	c := &t.clock
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.timeout <= 0 {
		return 0, 0
	}
	timeoutSec = int(c.timeout / time.Second)
	if c.key == "" {
		return timeoutSec, 0
	}
	left := time.Until(c.deadline)
	if left < time.Millisecond {
		left = time.Millisecond // still on the clock; the timer is about to fire
	}
	return timeoutSec, int64(left / time.Millisecond)
}

// enforceActionClock fires when a turn's clock runs out: if that turn is still
// in progress the player is checked when legal, otherwise folded.
func (t *table) enforceActionClock(key string) {
	c := &t.clock
	c.mu.Lock()
	stale := c.key != key
	c.mu.Unlock()
	if stale {
		return
	}
	view := t.game.GenerateOmniView()
	if turnKey(view) != key {
		return
	}
	pn := view.ActionNum
	p := view.Players[pn]
	maxBet := uint(0)
	for _, q := range view.Players {
		if q.Bet > maxBet {
			maxBet = q.Bet
		}
	}
	var err error
	what := "folds"
	if p.Bet >= maxBet {
		what = "checks"
		err = poker.Bet(t.game, pn, 0)
	} else {
		err = poker.Fold(t.game, pn, 0)
	}
	if err != nil {
		// The engine moved on between our snapshot and the action: nothing to
		// enforce any more.
		return
	}
	t.broadcast <- createNewLog(fmt.Sprintf("%s ran out of time and %s", p.Username, what))
	t.broadcastGame()
}
