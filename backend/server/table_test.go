package server

import (
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/evanofslack/go-poker/poker"
)

// These tests exercise the offline-eviction path of a table without Redis:
// the table's flush hook is replaced with an in-memory recorder, and the
// offline grace period is shortened so timer-driven evictions can be observed.

// flushRecorder captures every session flush a table performs.
type flushRecorder struct {
	mu    sync.Mutex
	calls []flushCall
}

type flushCall struct {
	AccountUUID string
	Room        string
	TotalBuyIn  uint
	Stack       uint
	Stats       poker.PlayerStats
}

func (r *flushRecorder) flush(accountUUID string, room string, totalBuyIn uint, stack uint, stats poker.PlayerStats) (uint, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, flushCall{accountUUID, room, totalBuyIn, stack, stats})
	return stack, nil
}

func (r *flushRecorder) snapshot() []flushCall {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]flushCall{}, r.calls...)
}

// newTestTable builds a table with no Redis, no hub, a recording flush hook
// and a very short offline grace period.
func newTestTable(t *testing.T) (*table, *flushRecorder) {
	t.Helper()
	rec := &flushRecorder{}
	tbl := newTable("test-room", nil, nil)
	// Pin the room config the tests' chip arithmetic assumes (blinds 1/2,
	// buy-in 200, cap 400) instead of inheriting the production defaults.
	poker.Configure(tbl.game, 1, 2, 200, 400, 6, 0)
	tbl.flush = rec.flush
	tbl.offlineAfter = 30 * time.Millisecond
	t.Cleanup(tbl.shutdown)
	return tbl, rec
}

// seat adds a player with a 200 buy-in at the next seat and returns their
// per-session uuid. Seats are assigned in ascending order so positions stay
// stable across SetSeatID's re-sort.
func seat(t *testing.T, tbl *table, account string, seatID uint, ready bool) string {
	t.Helper()
	pos := tbl.game.AddPlayer()
	if err := poker.SetAccountUUID(tbl.game, pos, account); err != nil {
		t.Fatalf("set account %s: %v", account, err)
	}
	if err := poker.SetUsername(tbl.game, pos, account); err != nil {
		t.Fatalf("set username %s: %v", account, err)
	}
	if err := poker.BuyIn(tbl.game, pos, 200); err != nil {
		t.Fatalf("buy in %s: %v", account, err)
	}
	if err := poker.SetSeatID(tbl.game, pos, seatID); err != nil {
		t.Fatalf("set seat %s: %v", account, err)
	}
	if ready {
		if err := poker.ToggleReady(tbl.game, pos, 0); err != nil {
			t.Fatalf("ready %s: %v", account, err)
		}
	}
	return tbl.game.GenerateOmniView().Players[pos].UUID
}

// findPlayer returns the current view of the player with the given uuid.
func findPlayer(view *poker.GameView, uuid string) (int, bool) {
	for i := range view.Players {
		if view.Players[i].UUID == uuid {
			return i, true
		}
	}
	return -1, false
}

// waitFor polls cond until it holds or the deadline passes.
func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func totalChips(view *poker.GameView, flushed []flushCall) uint {
	var total uint
	for _, p := range view.Players {
		total += p.Stack + p.TotalBet
	}
	for _, f := range flushed {
		total += f.Stack
	}
	return total
}

// Between hands, an offline player is removed as soon as the grace period
// elapses, their full stack goes back to their wallet, and the remaining
// players are returned to the not-ready phase.
func TestOfflineTimeoutEvictsBetweenHands(t *testing.T) {
	tbl, rec := newTestTable(t)
	a := seat(t, tbl, "acc-a", 1, true)
	b := seat(t, tbl, "acc-b", 2, false)

	if view := tbl.game.GenerateOmniView(); view.Stage != poker.NotReady {
		t.Fatalf("expected NotReady stage, got %v", view.Stage)
	}

	tbl.markPlayerOffline(a)

	waitFor(t, "player a to be evicted", func() bool {
		_, seated := findPlayer(tbl.game.GenerateOmniView(), a)
		return !seated
	})

	view := tbl.game.GenerateOmniView()
	if len(view.Players) != 1 {
		t.Fatalf("expected 1 player left, got %d", len(view.Players))
	}
	if pos, ok := findPlayer(view, b); !ok || view.Players[pos].Ready {
		t.Fatalf("remaining player should still be seated and not ready: %+v", view.Players)
	}
	if view.Stage != poker.NotReady {
		t.Fatalf("table should stay in NotReady, got %v", view.Stage)
	}

	calls := rec.snapshot()
	if len(calls) != 1 {
		t.Fatalf("expected exactly one session flush, got %d", len(calls))
	}
	if calls[0].AccountUUID != "acc-a" || calls[0].Stack != 200 || calls[0].TotalBuyIn != 200 || calls[0].Room != "test-room" {
		t.Fatalf("unexpected flush: %+v", calls[0])
	}
	if calls[0].Stats.Folds != 0 {
		t.Fatalf("no fold should be counted between hands, got %d", calls[0].Stats.Folds)
	}

	tbl.offlineMu.Lock()
	_, pending := tbl.offlineTimers[a]
	tbl.offlineMu.Unlock()
	if pending {
		t.Fatalf("offline timer should be cleared after eviction")
	}
}

// Reconnecting before the grace period elapses cancels the eviction.
func TestReconnectBeforeTimeoutKeepsSeat(t *testing.T) {
	tbl, rec := newTestTable(t)
	a := seat(t, tbl, "acc-a", 1, true)
	seat(t, tbl, "acc-b", 2, true)

	tbl.markPlayerOffline(a)
	tbl.markPlayerOnline(a)

	time.Sleep(4 * tbl.offlineAfter)

	view := tbl.game.GenerateOmniView()
	if len(view.Players) != 2 {
		t.Fatalf("both players should still be seated, got %d", len(view.Players))
	}
	if pos, ok := findPlayer(view, a); !ok || !view.Players[pos].Ready {
		t.Fatalf("reconnected player should keep their ready state: %+v", view.Players)
	}
	if calls := rec.snapshot(); len(calls) != 0 {
		t.Fatalf("no session should be flushed, got %+v", calls)
	}
}

// During a hand, a timed-out player who is not up to act is marked as left,
// folds when the action reaches them, and is dropped when the hand ends. The
// chips in the pot are not destroyed: the winner collects them.
func TestOfflineTimeoutDuringHandNotOnTurn(t *testing.T) {
	tbl, rec := newTestTable(t)
	a := seat(t, tbl, "acc-a", 1, true) // dealer / UTG, acts first preflop
	b := seat(t, tbl, "acc-b", 2, true) // small blind (1)
	c := seat(t, tbl, "acc-c", 3, true) // big blind (2)

	if err := tbl.game.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	view := tbl.game.GenerateOmniView()
	if view.Stage != poker.PreFlop {
		t.Fatalf("expected PreFlop, got %v", view.Stage)
	}
	posA, _ := findPlayer(view, a)
	if view.ActionNum != uint(posA) {
		t.Fatalf("expected a to act first, action is on %d", view.ActionNum)
	}

	// The big blind goes offline and times out while it is a's turn.
	tbl.markPlayerOffline(c)
	// The flush is the last step of the eviction, so once it is recorded the
	// engine state is settled and safe to inspect.
	waitFor(t, "c to be evicted", func() bool { return len(rec.snapshot()) == 1 })

	view = tbl.game.GenerateOmniView()
	posC, ok := findPlayer(view, c)
	if !ok || !view.Players[posC].Left || !view.Players[posC].In {
		t.Fatalf("leaver should stay seated and in the hand, marked left, until the action reaches them")
	}
	if view.Stage != poker.PreFlop {
		t.Fatalf("hand must continue, got stage %v", view.Stage)
	}

	// The session is settled at the moment of leaving with the post-blind stack.
	calls := rec.snapshot()
	if len(calls) != 1 || calls[0].AccountUUID != "acc-c" || calls[0].Stack != 198 {
		t.Fatalf("expected one flush of acc-c with stack 198, got %+v", calls)
	}
	if calls[0].Stats.Folds != 1 {
		t.Fatalf("the pending fold should be counted in the flushed stats, got %d", calls[0].Stats.Folds)
	}

	// a folds: the departed c is folded too, so b wins uncontested.
	if err := poker.Fold(tbl.game, uint(posA), 0); err != nil {
		t.Fatalf("a fold: %v", err)
	}
	view = tbl.game.GenerateOmniView()
	if view.Stage != poker.Showdown {
		t.Fatalf("hand should end in Showdown, got %v", view.Stage)
	}
	posB, _ := findPlayer(view, b)
	if view.Players[posB].Stack != 202 {
		t.Fatalf("b should collect the blinds (199 + 3), got %d", view.Players[posB].Stack)
	}

	// The client closes the showdown; the leaver is dropped and the table
	// pauses for everyone to re-ready.
	if err := poker.SettleShowdown(tbl.game); err != nil {
		t.Fatalf("settle showdown: %v", err)
	}
	view = tbl.game.GenerateOmniView()
	if _, seated := findPlayer(view, c); seated {
		t.Fatalf("leaver must be removed once the hand ends")
	}
	if len(view.Players) != 2 || view.Stage != poker.NotReady {
		t.Fatalf("expected 2 players in NotReady, got %d players in %v", len(view.Players), view.Stage)
	}
	for _, p := range view.Players {
		if p.Ready {
			t.Fatalf("remaining players should be not-ready after a leaver is dropped: %+v", p)
		}
	}
	if got := totalChips(view, rec.snapshot()); got != 600 {
		t.Fatalf("chips must be conserved (3 x 200), got %d", got)
	}
}

// Heads-up, the player up to act times out: they are folded immediately, the
// opponent wins the hand, and the leaver is removed when the showdown closes.
func TestOfflineTimeoutOnTurnHeadsUp(t *testing.T) {
	tbl, rec := newTestTable(t)
	a := seat(t, tbl, "acc-a", 1, true) // dealer / small blind, acts first
	b := seat(t, tbl, "acc-b", 2, true) // big blind

	if err := tbl.game.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	view := tbl.game.GenerateOmniView()
	posA, _ := findPlayer(view, a)
	if view.ActionNum != uint(posA) {
		t.Fatalf("expected a to act first, action is on %d", view.ActionNum)
	}

	tbl.timeoutPlayer(a)

	view = tbl.game.GenerateOmniView()
	if view.Stage != poker.Showdown {
		t.Fatalf("folding the only opponent should end the hand, got %v", view.Stage)
	}
	posB, _ := findPlayer(view, b)
	if view.Players[posB].Stack != 201 {
		t.Fatalf("b should win the blinds (198 + 3), got %d", view.Players[posB].Stack)
	}

	calls := rec.snapshot()
	if len(calls) != 1 || calls[0].AccountUUID != "acc-a" || calls[0].Stack != 199 {
		t.Fatalf("expected one flush of acc-a with stack 199, got %+v", calls)
	}

	if err := poker.SettleShowdown(tbl.game); err != nil {
		t.Fatalf("settle showdown: %v", err)
	}
	view = tbl.game.GenerateOmniView()
	if len(view.Players) != 1 || view.Players[0].UUID != b {
		t.Fatalf("only b should remain, got %+v", view.Players)
	}
	if view.Stage != poker.NotReady || view.Players[0].Ready {
		t.Fatalf("table should wait in NotReady with b not ready, got stage %v ready=%v", view.Stage, view.Players[0].Ready)
	}
	if got := totalChips(view, calls); got != 400 {
		t.Fatalf("chips must be conserved (2 x 200), got %d", got)
	}
}

// An all-in player who times out is not folded: they stay in the hand with
// their cards revealed so the showdown can still be contested (their winnings
// are forfeited by the engine if they would have won).
func TestOfflineTimeoutAllInStaysForShowdown(t *testing.T) {
	tbl, rec := newTestTable(t)
	a := seat(t, tbl, "acc-a", 1, true)
	b := seat(t, tbl, "acc-b", 2, true)

	if err := tbl.game.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	view := tbl.game.GenerateOmniView()
	posA, _ := findPlayer(view, a)
	// a shoves the rest of their stack; action moves to b.
	if err := poker.Bet(tbl.game, uint(posA), view.Players[posA].Stack); err != nil {
		t.Fatalf("a all-in: %v", err)
	}
	view = tbl.game.GenerateOmniView()
	if view.Players[posA].Stack != 0 {
		t.Fatalf("a should be all-in, stack %d", view.Players[posA].Stack)
	}

	tbl.timeoutPlayer(a)

	view = tbl.game.GenerateOmniView()
	posA, ok := findPlayer(view, a)
	if !ok {
		t.Fatalf("all-in leaver must stay seated until the hand ends")
	}
	p := view.Players[posA]
	if !p.In || !p.Left || !p.Revealed {
		t.Fatalf("all-in leaver should be in, left and revealed: in=%v left=%v revealed=%v", p.In, p.Left, p.Revealed)
	}
	if view.Stage != poker.PreFlop || !view.Betting {
		t.Fatalf("b must still get to act, got stage %v betting=%v", view.Stage, view.Betting)
	}

	calls := rec.snapshot()
	if len(calls) != 1 || calls[0].AccountUUID != "acc-a" || calls[0].Stack != 0 {
		t.Fatalf("expected one flush of acc-a with an empty stack, got %+v", calls)
	}
	if calls[0].Stats.Folds != 0 {
		t.Fatalf("an all-in leaver is shown down, not folded; got %d folds", calls[0].Stats.Folds)
	}
	_ = b
}

// A saved-session replay for a seat that has already been evicted is answered
// with session-expired (so the client returns to the lobby), while a replay
// within the grace period restores the seat and cancels the pending eviction.
func TestReconnectAfterEvictionExpiresSession(t *testing.T) {
	tbl, _ := newTestTable(t)
	a := seat(t, tbl, "acc-a", 1, false)
	seat(t, tbl, "acc-b", 2, false)

	hub := &Hub{tables: map[*table]bool{tbl: true}}
	tbl.hub = hub

	// Within the grace period: the seat is restored and the timer cancelled.
	tbl.markPlayerOffline(a)
	back := &Client{hub: hub, send: make(chan []byte, 16)}
	handleJoinTable(back, tbl.name, "", a, true)
	if back.table != tbl || back.uuid != a || back.accountUUID != "acc-a" {
		t.Fatalf("reconnect should restore the seat: table=%v uuid=%q account=%q", back.table == tbl, back.uuid, back.accountUUID)
	}
	tbl.offlineMu.Lock()
	_, pending := tbl.offlineTimers[a]
	tbl.offlineMu.Unlock()
	if pending {
		t.Fatalf("a successful reconnect must cancel the eviction timer")
	}
	if got := readAction(t, back.send); got != actionUpdatePlayerUUID {
		t.Fatalf("expected %s first, got %s", actionUpdatePlayerUUID, got)
	}
	if got := readAction(t, back.send); got != actionUpdateGame {
		t.Fatalf("expected %s second, got %s", actionUpdateGame, got)
	}
	// Drain the register request so the table's channel doesn't fill up.
	<-tbl.register

	// Let the eviction run for real.
	tbl.markPlayerOffline(a)
	waitFor(t, "player a to be evicted", func() bool {
		_, seated := findPlayer(tbl.game.GenerateOmniView(), a)
		return !seated
	})

	// After eviction: replaying the stale seat uuid must not rejoin.
	late := &Client{hub: hub, send: make(chan []byte, 16)}
	handleJoinTable(late, tbl.name, "", a, true)
	if late.table != nil {
		t.Fatalf("an expired session must not attach the client to the table")
	}
	if got := readAction(t, late.send); got != actionSessionExpired {
		t.Fatalf("expected %s, got %s", actionSessionExpired, got)
	}
	select {
	case <-tbl.register:
		t.Fatalf("an expired session must not register the client")
	default:
	}

	// Even without the reconnect flag, a stale seat uuid (which only a
	// session replay carries) is treated as a reconnect and rejected.
	legacy := &Client{hub: hub, send: make(chan []byte, 16)}
	handleJoinTable(legacy, tbl.name, "", a, false)
	if legacy.table != nil {
		t.Fatalf("a stale seat uuid must not attach an old client to the table")
	}
	if got := readAction(t, legacy.send); got != actionSessionExpired {
		t.Fatalf("expected %s for legacy client, got %s", actionSessionExpired, got)
	}

	// A replay for a room that no longer exists also expires.
	gone := &Client{hub: hub, send: make(chan []byte, 16)}
	handleJoinTable(gone, "no-such-room", "", "", true)
	if got := readAction(t, gone.send); got != actionSessionExpired {
		t.Fatalf("expected %s for a missing room, got %s", actionSessionExpired, got)
	}
	if hub.findTable("no-such-room") != nil {
		t.Fatalf("a reconnect must never create a room")
	}
}

// readAction pops the next outbound message and returns its action name.
func readAction(t *testing.T, ch chan []byte) string {
	t.Helper()
	select {
	case raw := <-ch:
		var msg base
		if err := json.Unmarshal(raw, &msg); err != nil {
			t.Fatalf("decode message %q: %v", raw, err)
		}
		return msg.Action
	case <-time.After(time.Second):
		t.Fatalf("no message received")
		return ""
	}
}
