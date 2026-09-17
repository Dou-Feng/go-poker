package server

import (
	"errors"
	"sync"
	"testing"

	"github.com/evanofslack/go-poker/poker"
)

func TestDepartedSeatCannotReconnectOrRefundTwice(t *testing.T) {
	tbl, rec := newTestTable(t)
	a := seat(t, tbl, "acc-a", 1, true)
	seat(t, tbl, "acc-b", 2, true)
	seat(t, tbl, "acc-c", 3, true)
	hub := newSessionHub(tbl)
	if !autoStartIfReady(tbl) {
		t.Fatal("start failed")
	}
	c := newTestClient(hub, "acc-a")
	c.uuid, c.table = a, tbl
	handleLeaveTable(c, tbl.name)
	handleReconnectTable(c, tbl.name, "", a)
	if c.table != nil || c.uuid != "" {
		t.Fatal("departed seat reconnected")
	}
	if tableHasPlayer(tbl, a) || tablePlayerBelongsTo(tbl, a, "acc-a") {
		t.Fatal("departed seat remains claimable")
	}
	fresh := newTestClient(hub, "acc-a")
	hub.bindSession(fresh)
	if fresh.table != nil {
		t.Fatal("login restored a departed seat")
	}
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); tbl.evictPlayer(a) }()
	}
	wg.Wait()
	if calls := rec.snapshot(); len(calls) != 1 || calls[0].Stack != 200 {
		t.Fatalf("refunds: %+v", calls)
	}
}

func TestResetRefundsAndRejectsActiveHand(t *testing.T) {
	for _, running := range []bool{false, true} {
		t.Run(map[bool]string{false: "waiting", true: "playing"}[running], func(t *testing.T) {
			tbl, rec := newTestTable(t)
			a := seat(t, tbl, "acc-a", 1, running)
			seat(t, tbl, "acc-b", 2, running)
			if running && !autoStartIfReady(tbl) {
				t.Fatal("start failed")
			}
			c := &Client{table: tbl, accountUUID: "acc-a", uuid: a, send: make(chan []byte, 16)}
			handleResetGame(c)
			view := tbl.game.GenerateOmniView()
			if running {
				if len(rec.snapshot()) != 0 || !view.Running || len(view.Players) != 2 {
					t.Fatal("reset changed active hand")
				}
				if lastError(t, c) != "game already running" {
					t.Fatal("missing reset rejection")
				}
			} else {
				var refunded uint
				for _, call := range rec.snapshot() {
					refunded += call.Stack
				}
				if refunded != 400 || len(view.Players) != 0 {
					t.Fatalf("refunded=%d players=%d", refunded, len(view.Players))
				}
			}
		})
	}
}

func TestResetRetryDoesNotLoseOrRepeatRefunds(t *testing.T) {
	tbl, rec := newTestTable(t)
	seat(t, tbl, "acc-a", 1, false)
	seat(t, tbl, "acc-b", 2, false)
	fail := true
	tbl.flush = func(account, room string, buy, stack uint, stats poker.PlayerStats) (uint, error) {
		if account == "acc-a" && fail {
			return 0, errors.New("storage unavailable")
		}
		return rec.flush(account, room, buy, stack, stats)
	}
	if err := tbl.resetWithRefunds(); err == nil {
		t.Fatal("expected storage failure")
	}
	view := tbl.game.GenerateOmniView()
	if len(view.Players) != 1 || view.Players[0].AccountUUID != "acc-a" || view.Players[0].Stack != 200 {
		t.Fatalf("unpaid stack not retained: %+v", view.Players)
	}
	fail = false
	if err := tbl.resetWithRefunds(); err != nil {
		t.Fatal(err)
	}
	calls := rec.snapshot()
	if len(calls) != 2 || calls[0].AccountUUID == calls[1].AccountUUID {
		t.Fatalf("refunds: %+v", calls)
	}
}

func TestOccupiedSeatDoesNotDebitOrCreatePlayer(t *testing.T) {
	tbl, store, _, _, c := reserveRoom(t)
	handleTakeSeat(c, "", 1, 200)
	if store.chips(c.accountUUID) != 1000 || len(tbl.game.GenerateOmniView().Players) != 2 || c.uuid != "" {
		t.Fatal("occupied seat changed wallet or roster")
	}
	if lastError(t, c) != "seat is taken" {
		t.Fatal("missing seat error")
	}
}

type failingSeatStore struct{ *memUserStore }

func (s failingSeatStore) save(*UserRecord) error { return errors.New("storage unavailable") }

func TestSeatWalletFailureLeavesNoPlayer(t *testing.T) {
	tbl, store, _, _, c := reserveRoom(t)
	tbl.users = failingSeatStore{store}
	handleTakeSeat(c, "", 3, 200)
	if store.chips(c.accountUUID) != 1000 || len(tbl.game.GenerateOmniView().Players) != 2 || c.uuid != "" || tbl.ledger.total(c.accountUUID) != 0 {
		t.Fatal("failed debit changed wallet or roster")
	}
	if lastError(t, c) != "could not save user" {
		t.Fatal("missing storage error")
	}
}

func TestConcurrentSeatClaimsChargeOnlyWinner(t *testing.T) {
	tbl, store, _, _, c := reserveRoom(t)
	d := newTestClient(c.hub, "acc-d")
	d.table, d.username = tbl, "acc-d"
	tbl.registerClient(d)
	store.save(&UserRecord{UUID: d.accountUUID, Username: d.username, Chips: 1000})
	start := make(chan struct{})
	var wg sync.WaitGroup
	for _, client := range []*Client{c, d} {
		wg.Add(1)
		go func(c *Client) { defer wg.Done(); <-start; handleTakeSeat(c, "", 3, 200) }(client)
	}
	close(start)
	wg.Wait()
	view := tbl.game.GenerateOmniView()
	if len(view.Players) != 3 || store.chips(c.accountUUID)+store.chips(d.accountUUID) != 1800 {
		t.Fatalf("players=%d wallets=%d/%d", len(view.Players), store.chips(c.accountUUID), store.chips(d.accountUUID))
	}
	for _, p := range view.Players {
		if p.SeatID == 0 {
			t.Fatal("ghost seat")
		}
	}
	if (c.uuid == "") == (d.uuid == "") {
		t.Fatal("expected exactly one winner")
	}
}

func TestRoomSwitchRequiresLeavingFirst(t *testing.T) {
	for _, action := range []string{"join", "reconnect", "create"} {
		t.Run(action, func(t *testing.T) {
			a, _ := newTestTable(t)
			b, _ := newTestTable(t)
			a.name, b.name = "room-a", "room-b"
			hub := newSessionHub(a, b)
			c := newTestClient(hub, "acc-a")
			c.table = a
			a.registerClient(c)
			switch action {
			case "join":
				handleJoinTable(c, b.name, "", "", false)
			case "reconnect":
				handleReconnectTable(c, b.name, "", "")
			case "create":
				handleCreateTable(c, "room-c", "", 1, 2, 200, 400, 6, 0, false, 0, "normal")
			}
			if c.table != a || len(b.register) != 0 || len(hub.tables) != 2 {
				t.Fatal("room switch changed membership")
			}
			handleLeaveTable(c, a.name)
			handleJoinTable(c, b.name, "", "", false)
			if c.table != b || len(a.unregister) != 1 || len(b.register) != 1 {
				t.Fatal("explicit leave/join failed")
			}
		})
	}
}

func TestSameRoomJoinIsIdempotent(t *testing.T) {
	tbl, _ := newTestTable(t)
	hub := newSessionHub(tbl)
	c := newTestClient(hub, "acc-a")
	c.table = tbl
	c.uuid = seat(t, tbl, "acc-a", 1, false)
	before := c.uuid
	handleJoinTable(c, tbl.name, "", "", false)
	if c.uuid != before || len(tbl.register) != 0 || len(tbl.broadcast) != 0 {
		t.Fatal("repeated join changed membership")
	}
}

func TestResetSerializesWithBuyInChanges(t *testing.T) {
	for _, undo := range []bool{false, true} {
		t.Run(map[bool]string{false: "rebuy", true: "undo"}[undo], func(t *testing.T) {
			tbl, _ := newTestTable(t)
			store := newMemUserStore()
			tbl.users = store
			store.save(&UserRecord{UUID: "a", Username: "a", Chips: 800})
			c := newTestClient(newSessionHub(tbl), "a")
			c.table = tbl
			c.uuid = seat(t, tbl, "a", 1, false)
			tbl.registerClient(c)
			tbl.ledger.add("a", 200)
			tbl.flush = func(account, room string, buy, stack uint, stats poker.PlayerStats) (uint, error) {
				u, err := store.load(account)
				if err != nil {
					return 0, err
				}
				u.Chips += stack
				return u.Chips, store.save(u)
			}
			var wg sync.WaitGroup
			wg.Add(2)
			go func() {
				defer wg.Done()
				if undo {
					handleUndoRebuy(c)
				} else {
					handleRebuy(c, 200)
				}
			}()
			go func() {
				defer wg.Done()
				if err := tbl.resetWithRefunds(); err != nil {
					t.Error(err)
				}
			}()
			wg.Wait()
			if store.chips("a") != 1000 || len(tbl.game.GenerateOmniView().Players) != 0 {
				t.Fatalf("wallet=%d; reset lost or duplicated chips", store.chips("a"))
			}
		})
	}
}

func TestResetRefundsPendingBuyInAndPersistsHistory(t *testing.T) {
	tbl, rec := newTestTable(t)
	seat(t, tbl, "a", 1, false)
	view := tbl.game.GenerateOmniView()
	view.Players[0].PendingBuyIn = 50
	view.Players[0].TotalBuyIn = 250
	view.Players[0].Stats.HandsPlayed = 1
	tbl.game.FillFromView(view)
	var saved *SessionRecord
	tbl.persist = func(rec SessionRecord) error { saved = &rec; return nil }
	if err := tbl.resetWithRefunds(); err != nil {
		t.Fatal(err)
	}
	calls := rec.snapshot()
	if len(calls) != 1 || calls[0].Stack != 250 || calls[0].Stats.HandsPlayed != 1 {
		t.Fatalf("refund=%+v", calls)
	}
	if saved == nil || !saved.Settled || len(saved.Players) != 1 || saved.Players[0].Net != 0 {
		t.Fatalf("history not finalized: %+v", saved)
	}
}
