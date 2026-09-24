package server

import (
	"fmt"
	"sync"
	"time"

	"github.com/evanofslack/go-poker/poker"
)

// Browsers normally advance runouts after 900 ms and showdown after 5 s.
// This watchdog keeps the whole table moving if that browser disconnects,
// sleeps or loses its request. Rebroadcasting the same stage never postpones it.
type progressionClock struct {
	mu            sync.Mutex
	key           string
	timer         *time.Timer
	runoutDelay   time.Duration
	showdownDelay time.Duration
}

func progressionKey(view *poker.GameView) string {
	if view.Betting || (!view.Running && view.Stage != poker.Showdown) {
		return ""
	}
	if view.Stage < poker.PreFlop || view.Stage > poker.Showdown {
		return ""
	}
	// A seat UUID also distinguishes a reset session with the same hand number.
	if len(view.Players) == 0 {
		return ""
	}
	return fmt.Sprintf("%s/%d/%d", view.Players[0].UUID, view.HandsPlayed, view.Stage)
}

func (t *table) armProgression(view *poker.GameView) {
	c := &t.progression
	c.mu.Lock()
	defer c.mu.Unlock()
	select {
	case <-t.stop:
		return
	default:
	}
	key := progressionKey(view)
	if c.key == key {
		return
	}
	if c.timer != nil {
		c.timer.Stop()
		c.timer = nil
	}
	c.key = key
	if key == "" {
		return
	}
	delay := c.runoutDelay
	if view.Stage == poker.Showdown {
		delay = c.showdownDelay
	}
	c.timer = time.AfterFunc(delay, func() { t.enforceProgression(key) })
}

func (t *table) stopProgression() {
	c := &t.progression
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.timer != nil {
		c.timer.Stop()
		c.timer = nil
	}
	c.key = ""
}

func (t *table) enforceProgression(key string) {
	t.actionMu.Lock()
	defer t.actionMu.Unlock()
	select {
	case <-t.stop:
		return
	default:
	}
	c := &t.progression
	c.mu.Lock()
	current := c.key == key && key != ""
	c.mu.Unlock()
	if !current || t.settlementPending.Load() || progressionKey(t.game.GenerateOmniView()) != key {
		return
	}
	t.advanceGame()
}
