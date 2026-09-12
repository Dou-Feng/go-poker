package server

import (
	"testing"
	"time"

	"github.com/evanofslack/go-poker/poker"
)

func TestTableInfoIncludesLobbyConfig(t *testing.T) {
	tbl, _ := newTestTable(t)
	poker.Configure(tbl.game, 5, 10, 250, 0, 8, 30)
	tbl.clock.timeout = 45 * time.Second

	info := tbl.info()
	if info.SmallBlind != 5 || info.BigBlind != 10 || info.BuyIn != 250 {
		t.Fatalf("lobby stakes: %+v", info)
	}
	if info.MaxPlayers != 8 || info.HandsLimit != 30 || info.ActionTimeout != 45 {
		t.Fatalf("lobby limits: %+v", info)
	}
}
