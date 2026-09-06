package server

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/evanofslack/go-poker/poker"
)

// Tests for joining a table while a hand runs (reserve.go): tapping an empty
// seat claims it for the next hand, and the claim becomes a not-ready seat
// when the hand ends. No Redis: the wallet is an in-memory store.

// memUserStore is the wallet used by these tests.
type memUserStore struct{ users map[string]*UserRecord }

func newMemUserStore() *memUserStore { return &memUserStore{users: map[string]*UserRecord{}} }

func (s *memUserStore) load(uuid string) (*UserRecord, error) {
	if u, ok := s.users[uuid]; ok {
		cp := *u
		return &cp, nil
	}
	return nil, errors.New("no such user")
}

func (s *memUserStore) save(u *UserRecord) error {
	cp := *u
	s.users[u.UUID] = &cp
	return nil
}

func (s *memUserStore) chips(uuid string) uint { return s.users[uuid].Chips }

// reserveRoom is a table with two seated, ready humans (acc-a seat 1, acc-b
// seat 2) whose connections are registered, plus a spectator acc-c with 1000
// chips in the wallet. Broadcasts are drained.
func reserveRoom(t *testing.T) (*table, *memUserStore, *Client, *Client, *Client) {
	t.Helper()
	tbl, _ := newTestTable(t)
	drainBroadcasts(t, tbl)
	store := newMemUserStore()
	tbl.users = store
	hub := newSessionHub(tbl)

	join := func(account string, chips uint) *Client {
		c := newTestClient(hub, account)
		c.username = account
		c.table = tbl
		tbl.registerClient(c)
		store.save(&UserRecord{UUID: account, Username: account, Chips: chips, Avatar: "🙂"})
		return c
	}
	a := join("acc-a", 0)
	b := join("acc-b", 0)
	c := join("acc-c", 1000)
	a.uuid = seat(t, tbl, "acc-a", 1, true)
	b.uuid = seat(t, tbl, "acc-b", 2, true)
	return tbl, store, a, b, c
}

// lastError drains a client's queue and returns the last error message, or "".
func lastError(t *testing.T, c *Client) string {
	t.Helper()
	msg := ""
	for {
		select {
		case raw := <-c.send:
			var e errorMessage
			if json.Unmarshal(raw, &e) == nil && e.Action == actionError {
				msg = e.Message
			}
		default:
			return msg
		}
	}
}

// foldOut has whoever is to act fold, which heads-up ends the hand.
func foldOut(t *testing.T, tbl *table, clients map[string]*Client) {
	t.Helper()
	view := tbl.game.GenerateOmniView()
	actor := clients[view.Players[view.ActionNum].UUID]
	if actor == nil {
		t.Fatalf("no client for the acting player")
	}
	handleFold(actor)
	if got := tbl.game.GenerateOmniView().Stage; got != poker.Showdown {
		t.Fatalf("fold must end the heads-up hand, stage=%d", got)
	}
}

// The core scenario: a spectator taps seat 3 mid-hand, is seated there when
// the hand ends, NOT ready, so the table waits in the not-ready phase instead
// of dealing again. Readying up starts the three-handed hand.
func TestReservedSeatIsFilledNotReadyAtHandEnd(t *testing.T) {
	tbl, store, a, b, c := reserveRoom(t)
	if !autoStartIfReady(tbl) {
		t.Fatalf("both ready: the hand must start")
	}

	handleTakeSeat(c, "acc-c", 3, 200)
	if msg := lastError(t, c); msg != "" {
		t.Fatalf("claim refused: %s", msg)
	}
	res := tbl.reservations()
	if len(res) != 1 || res[0].SeatID != 3 || res[0].AccountUUID != "acc-c" || res[0].Username != "acc-c" || res[0].Avatar != "🙂" {
		t.Fatalf("unexpected reservations: %+v", res)
	}
	if n := len(tbl.game.GenerateOmniView().Players); n != 2 {
		t.Fatalf("nobody sits down mid-hand, players=%d", n)
	}
	if store.chips("acc-c") != 1000 {
		t.Fatalf("a claim must not debit the wallet")
	}

	foldOut(t, tbl, map[string]*Client{a.uuid: a, b.uuid: b})
	handleDealGame(a) // closes the showdown

	view := tbl.game.GenerateOmniView()
	if view.Running || view.Stage != poker.NotReady {
		t.Fatalf("table must wait for the newcomer, running=%v stage=%d", view.Running, view.Stage)
	}
	pos, ok := findPlayer(view, c.uuid)
	if !ok {
		t.Fatalf("spectator must be seated after the hand")
	}
	p := view.Players[pos]
	if p.SeatID != 3 || p.Ready || p.Stack != 200 || p.AccountUUID != "acc-c" || p.Username != "acc-c" || p.Avatar != "🙂" {
		t.Fatalf("unexpected seat: %+v", p)
	}
	if store.chips("acc-c") != 800 {
		t.Fatalf("buy-in must come out of the wallet, got %d", store.chips("acc-c"))
	}
	if tbl.ledger.total("acc-c") != 200 {
		t.Fatalf("ledger must record the buy-in")
	}
	if len(tbl.reservations()) != 0 {
		t.Fatalf("claim must be consumed")
	}
	if msg := lastError(t, c); msg != "" {
		t.Fatalf("unexpected error for the newcomer: %s", msg)
	}
	// The others kept their ready state; only the newcomer is missing.
	for _, uuid := range []string{a.uuid, b.uuid} {
		i, _ := findPlayer(view, uuid)
		if !view.Players[i].Ready {
			t.Fatalf("existing players stay ready")
		}
	}

	handleToggleReady(c)
	view = tbl.game.GenerateOmniView()
	if !view.Running || len(view.Players) != 3 {
		t.Fatalf("readying the newcomer must start the hand, running=%v players=%d", view.Running, len(view.Players))
	}
}

// Claims toggle and move, and everything that would block sitting down later
// is refused up front.
func TestReserveSeatToggleAndRefusals(t *testing.T) {
	tbl, _, a, _, c := reserveRoom(t)
	hub := tbl.hub
	poker.Configure(tbl.game, 1, 2, 200, 400, 4, 0) // 4 seats: two taken
	autoStartIfReady(tbl)

	// Tap seat 3: claimed. Tap again: released. Tap 3 then 4: moved.
	handleTakeSeat(c, "acc-c", 3, 200)
	handleTakeSeat(c, "acc-c", 3, 200)
	if len(tbl.reservations()) != 0 {
		t.Fatalf("second tap must cancel the claim")
	}
	handleTakeSeat(c, "acc-c", 3, 200)
	handleTakeSeat(c, "acc-c", 4, 200)
	if res := tbl.reservations(); len(res) != 1 || res[0].SeatID != 4 {
		t.Fatalf("a new tap moves the claim, got %+v", res)
	}
	if msg := lastError(t, c); msg != "" {
		t.Fatalf("unexpected error: %s", msg)
	}

	d := newTestClient(hub, "acc-d")
	d.username = "acc-d"
	d.table = tbl
	tbl.registerClient(d)
	tbl.users.save(&UserRecord{UUID: "acc-d", Chips: 1000})

	cases := []struct {
		name string
		from *Client
		seat uint
		want string
	}{
		{"claimed by someone else", d, 4, "seat is taken"},
		{"occupied seat", d, 1, "seat is taken"},
		{"seated player", a, 3, "already seated"},
	}
	for _, tc := range cases {
		handleTakeSeat(tc.from, tc.from.username, tc.seat, 200)
		if got := lastError(t, tc.from); got != tc.want {
			t.Fatalf("%s: want %q, got %q", tc.name, tc.want, got)
		}
	}
	// Capacity counts pending claims: with three seats, two players and one
	// claim leave no room.
	poker.Configure(tbl.game, 1, 2, 200, 400, 3, 0)
	tbl.dropReservation("acc-c")
	handleTakeSeat(c, "acc-c", 3, 200)
	handleTakeSeat(d, "acc-d", 3, 200)
	if got := lastError(t, d); got != "seat is taken" {
		t.Fatalf("claimed seat: got %q", got)
	}
	tbl.dropReservation("acc-c")
	e := newTestClient(hub, "acc-e")
	e.username = "acc-e"
	e.table = tbl
	tbl.registerClient(e)
	tbl.users.save(&UserRecord{UUID: "acc-e", Chips: 1000})
	poker.Configure(tbl.game, 1, 2, 200, 400, 4, 0)
	handleTakeSeat(e, "acc-e", 3, 200) // 2 seated + 1 claim
	poker.Configure(tbl.game, 1, 2, 200, 400, 3, 0)
	handleTakeSeat(d, "acc-d", 4, 200)
	if got := lastError(t, d); got != "seat is taken" {
		t.Fatalf("seat beyond the table: got %q", got)
	}
	poker.Configure(tbl.game, 1, 2, 200, 400, 4, 0)
	tbl.dropReservation("acc-e")
	handleTakeSeat(e, "acc-e", 4, 200)
	poker.Configure(tbl.game, 1, 2, 200, 400, 3, 0)
	handleTakeSeat(d, "acc-d", 3, 200)
	if got := lastError(t, d); got != "table is full" {
		t.Fatalf("table full counting claims: got %q", got)
	}
	poker.Configure(tbl.game, 1, 2, 200, 400, 4, 0)
	tbl.dropReservation("acc-e")
	tbl.dropReservation("acc-c")
	handleTakeSeat(c, "acc-c", 4, 200)

	// Anonymous spectators and empty wallets are refused too.
	anon := newTestClient(hub, "")
	anon.table = tbl
	tbl.registerClient(anon)
	handleTakeSeat(anon, "", 3, 200)
	if got := lastError(t, anon); got != "not logged in" {
		t.Fatalf("anonymous: got %q", got)
	}
	tbl.dropReservation("acc-c")
	tbl.users.save(&UserRecord{UUID: "acc-d", Chips: 50})
	handleTakeSeat(d, "acc-d", 3, 200)
	if got := lastError(t, d); got != "not enough chips" {
		t.Fatalf("poor spectator: got %q", got)
	}
	if len(tbl.reservations()) != 0 {
		t.Fatalf("refused claims must not be recorded")
	}
}

// A claim follows the account, not the socket: it survives a reconnect and
// goes when the account's last connection leaves. A holder who can no longer
// pay when the hand ends is told so and not seated.
func TestReservationFollowsAccountAndFailsSafely(t *testing.T) {
	tbl, store, a, b, c := reserveRoom(t)
	autoStartIfReady(tbl)
	handleTakeSeat(c, "acc-c", 3, 200)

	// Reconnect: new connection, same account, old one gone.
	c2 := newTestClient(tbl.hub, "acc-c")
	c2.username = "acc-c"
	c2.table = tbl
	tbl.registerClient(c2)
	tbl.unregisterClient(c)
	if len(tbl.reservations()) != 1 {
		t.Fatalf("claim must survive a reconnect")
	}

	// Meanwhile the wallet was emptied elsewhere.
	store.save(&UserRecord{UUID: "acc-c", Chips: 10})
	foldOut(t, tbl, map[string]*Client{a.uuid: a, b.uuid: b})
	handleDealGame(a)

	view := tbl.game.GenerateOmniView()
	if _, seated := findPlayer(view, c2.uuid); seated || len(view.Players) != 2 {
		t.Fatalf("a holder who cannot pay must not be seated")
	}
	if got := lastError(t, c2); got != "not enough chips" {
		t.Fatalf("holder must be told why, got %q", got)
	}
	if len(tbl.reservations()) != 0 {
		t.Fatalf("failed claim must be dropped")
	}
	// Everyone else was still ready, so the next hand simply started.
	if !view.Running {
		t.Fatalf("with no newcomer the ready players deal on")
	}

	// A claim is dropped when the account leaves the room.
	store.save(&UserRecord{UUID: "acc-c", Chips: 1000})
	handleTakeSeat(c2, "acc-c", 3, 200)
	if len(tbl.reservations()) != 1 {
		t.Fatalf("claim expected")
	}
	tbl.unregisterClient(c2)
	if len(tbl.reservations()) != 0 {
		t.Fatalf("claim must go with the account's last connection")
	}
}

// Claims travel in update-game so every client can draw the claimed seat.
func TestUpdateGameCarriesReservations(t *testing.T) {
	tbl, _, _, _, c := reserveRoom(t)
	autoStartIfReady(tbl)
	handleTakeSeat(c, "acc-c", 3, 200)

	var msg struct {
		Reserved []seatReservation `json:"reserved"`
	}
	if err := json.Unmarshal(createUpdatedGameBytes(tbl), &msg); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(msg.Reserved) != 1 || msg.Reserved[0].SeatID != 3 || msg.Reserved[0].AccountUUID != "acc-c" {
		t.Fatalf("unexpected reserved list: %+v", msg.Reserved)
	}
	// The censored per-client copy keeps it.
	var g updateGame
	if err := json.Unmarshal(createUpdatedGameBytes(tbl), &g); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if err := json.Unmarshal(g.censoredFor(""), &msg); err != nil || len(msg.Reserved) != 1 {
		t.Fatalf("censored copy must keep reservations: %v %+v", err, msg.Reserved)
	}
}
