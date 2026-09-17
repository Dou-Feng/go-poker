package poker

import (
	"reflect"
	"sync"
	"testing"
)

func TestSeatPlayerRejectsWithoutMutation(t *testing.T) {
	for _, kind := range []string{"occupied", "duplicate account", "zero seat", "out of range", "zero buy-in", "over cap", "running"} {
		t.Run(kind, func(t *testing.T) {
			g := NewGame()
			Configure(g, 1, 2, 200, 400, 6, 0)
			_, err := g.SeatPlayer(SeatConfig{AccountUUID: "a", Username: "Alice", SeatID: 1, BuyIn: 200, Ready: true})
			if err != nil {
				t.Fatal(err)
			}
			cfg := SeatConfig{AccountUUID: "b", SeatID: 2, BuyIn: 200}
			switch kind {
			case "occupied":
				cfg.SeatID = 1
			case "duplicate account":
				cfg.AccountUUID = "a"
			case "zero seat":
				cfg.SeatID = 0
			case "out of range":
				cfg.SeatID = 7
			case "zero buy-in":
				cfg.BuyIn = 0
			case "over cap":
				cfg.BuyIn = 401
			case "running":
				if _, err := g.SeatPlayer(SeatConfig{AccountUUID: "c", SeatID: 3, BuyIn: 200, Ready: true}); err != nil {
					t.Fatal(err)
				}
				if err := g.Start(); err != nil {
					t.Fatal(err)
				}
			}
			before := g.GenerateOmniView()
			if _, err := g.SeatPlayer(cfg); err == nil {
				t.Fatal("invalid seat accepted")
			}
			if !reflect.DeepEqual(before, g.GenerateOmniView()) {
				t.Fatal("rejected seat changed state")
			}
		})
	}
}

func TestSeatPlayerConcurrentClaims(t *testing.T) {
	g := NewGame()
	Configure(g, 1, 2, 200, 400, 6, 0)
	var wg sync.WaitGroup
	for _, account := range []string{"a", "b"} {
		wg.Add(1)
		go func(account string) {
			defer wg.Done()
			g.SeatPlayer(SeatConfig{AccountUUID: account, Username: account, SeatID: 1, BuyIn: 200})
		}(account)
	}
	wg.Wait()
	view := g.GenerateOmniView()
	if len(view.Players) != 1 {
		t.Fatalf("players=%d", len(view.Players))
	}
	p := view.Players[0]
	if p.SeatID != 1 || p.Stack != 200 || p.TotalBuyIn != 200 || p.UUID == "" || p.Ready || p.Position != 0 {
		t.Fatalf("incomplete seat: %+v", p)
	}
}
