package server

import (
	"fmt"
	"testing"

	"github.com/evanofslack/go-poker/poker"
)

func TestReuseSettledRoomWithFewerPlayers(t *testing.T) {
	tbl, _ := newTestTable(t)
	drainBroadcasts(t, tbl)
	poker.Configure(tbl.game, 1, 2, 200, 0, 6, 3)
	config := tbl.game.GenerateOmniView().Config
	store := newMemUserStore()
	tbl.users = store
	hub := newSessionHub(tbl)
	clients := make([]*Client, 6)
	for i := range clients {
		account := fmt.Sprintf("account-%d", i)
		c := newTestClient(hub, account)
		c.username = account
		c.table = tbl
		tbl.registerClient(c)
		store.save(&UserRecord{UUID: account, Username: account, Chips: 1000})
		if err := c.processEvents([]byte(fmt.Sprintf(`{"action":"take-seat","seatID":%d,"buyIn":200}`, i+1))); err != nil {
			t.Fatal(err)
		}
		clients[i] = c
	}
	for _, c := range clients {
		if err := c.processEvents([]byte(`{"action":"toggle-ready"}`)); err != nil {
			t.Fatal(err)
		}
	}
	for hand := 0; hand < 3; hand++ {
		for step := 0; tbl.game.GenerateOmniView().Stage != poker.Showdown; step++ {
			if step > 6 {
				t.Fatal("hand did not end")
			}
			if err := actionClient(t, tbl).processEvents([]byte(`{"action":"player-fold"}`)); err != nil {
				t.Fatal(err)
			}
		}
		if err := clients[0].processEvents([]byte(`{"action":"deal-game"}`)); err != nil {
			t.Fatal(err)
		}
	}
	v := tbl.game.GenerateOmniView()
	if len(v.Players) != 0 {
		t.Fatalf("expected settled empty room; players=%d", len(v.Players))
	}
	if v.Stage != poker.NotReady || v.HandsPlayed != 0 || v.Config != config {
		t.Fatalf("unexpected settled state: %+v", v)
	}
	for i, c := range clients[:2] {
		if err := c.processEvents([]byte(fmt.Sprintf(`{"action":"take-seat","seatID":%d,"buyIn":200}`, i+1))); err != nil {
			t.Fatal(err)
		}
	}
	for _, c := range clients[:2] {
		if err := c.processEvents([]byte(`{"action":"toggle-ready"}`)); err != nil {
			t.Fatal(err)
		}
	}

	v = tbl.game.GenerateOmniView()
	if v.Stage != poker.PreFlop || !v.Betting || len(v.Players) != 2 {
		t.Fatalf("two-player restart did not start betting: %+v", v)
	}
	if v.DealerNum != 0 || v.SBNum != 0 || v.BBNum != 1 || v.ActionNum != 0 {
		t.Fatalf("incorrect heads-up positions: dealer=%d sb=%d bb=%d action=%d", v.DealerNum, v.SBNum, v.BBNum, v.ActionNum)
	}
	if v.Players[0].Stack != 199 || v.Players[0].Bet != 1 || v.Players[1].Stack != 198 || v.Players[1].Bet != 2 {
		t.Fatalf("incorrect blinds after restart: %+v", v.Players)
	}
	// Complete another hand to verify that turn order still advances normally.
	if err := actionClient(t, tbl).processEvents([]byte(`{"action":"player-fold"}`)); err != nil {
		t.Fatal(err)
	}
	if err := clients[0].processEvents([]byte(`{"action":"deal-game"}`)); err != nil {
		t.Fatal(err)
	}
	v = tbl.game.GenerateOmniView()
	if v.Stage != poker.PreFlop || v.HandsPlayed != 1 || v.DealerNum != 1 || v.Config != config {
		t.Fatalf("restarted session did not advance normally: %+v", v)
	}
}
