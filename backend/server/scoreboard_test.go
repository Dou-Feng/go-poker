package server

import (
	"encoding/json"
	"testing"

	"github.com/evanofslack/go-poker/poker"
)

// Tests for the room-session accounting in scoreboard.go: scoreboard rows are
// merged per account, and the room's max buy-in follows the account across
// leave / re-seat so a busted player cannot buy back in.

// setChips rewrites one seated player's stack and total buy-in by round-tripping
// the engine through its view (the player type is unexported to this package).
func setChips(t *testing.T, tbl *table, uuid string, stack uint, totalBuyIn uint) {
	t.Helper()
	view := tbl.game.GenerateOmniView()
	pos, ok := findPlayer(view, uuid)
	if !ok {
		t.Fatalf("player %s not seated", uuid)
	}
	view.Players[pos].Stack = stack
	view.Players[pos].TotalBuyIn = totalBuyIn
	tbl.game.FillFromView(view)
}

// A player who left (or busted to the spectator side) and sat down again has a
// departed snapshot and a live seat; the scoreboard shows them once with the
// buy-ins and nets summed, and everybody's nets still sum to zero.
func TestSettlementRowsMergeSameAccount(t *testing.T) {
	tbl, _ := newTestTable(t)
	a := seat(t, tbl, "acc-a", 1, false) // will bust: 200 in, 0 out
	b := seat(t, tbl, "acc-b", 2, false) // wins acc-a's first stack

	// The first stack changes hands, then acc-a leaves the seat.
	setChips(t, tbl, a, 0, 200)
	setChips(t, tbl, b, 400, 200)
	posA, _ := findPlayer(tbl.game.GenerateOmniView(), a)
	if err := poker.RemovePlayer(tbl.game, uint(posA)); err != nil {
		t.Fatalf("remove: %v", err)
	}

	// acc-a re-sits with a fresh 200 and wins 50 of it back.
	a2 := seat(t, tbl, "acc-a", 3, false)
	setChips(t, tbl, a2, 250, 200)
	setChips(t, tbl, b, 350, 200)

	rows := settlementRows(tbl.game.GenerateOmniView())
	if len(rows) != 2 {
		t.Fatalf("want one row per account, got %+v", rows)
	}
	byAcc := map[string]settlementPlayer{}
	sum := 0
	for _, r := range rows {
		byAcc[r.UUID] = r
		sum += r.Net
	}
	if got := byAcc["acc-a"]; got.BuyIn != 400 || got.Net != -150 {
		t.Fatalf("acc-a must merge both stints (400 in, 250 out): %+v", got)
	}
	if got := byAcc["acc-b"]; got.BuyIn != 200 || got.Net != 150 {
		t.Fatalf("acc-b: %+v", got)
	}
	if sum != 0 {
		t.Fatalf("nets must sum to zero, got %d", sum)
	}
}

// Departed snapshots that never bought in (a queued seat that was never dealt
// in) are not shown; accounts without an id are kept apart, not merged.
func TestSettlementRowsSkipZeroBuyInAndKeepAnonymousApart(t *testing.T) {
	view := &poker.GameView{}
	raw := `{"players":[{"uuid":"s1","username":"x","totalBuyIn":100,"stack":150},
	                    {"uuid":"s2","username":"y","totalBuyIn":100,"stack":50}],
	         "departedPlayers":[{"uuid":"d1","username":"ghost","totalBuyIn":0,"stack":0}]}`
	if err := json.Unmarshal([]byte(raw), view); err != nil {
		t.Fatalf("decode view: %v", err)
	}
	rows := settlementRows(view)
	if len(rows) != 2 {
		t.Fatalf("zero-buy-in departed must be skipped and anonymous seats kept apart, got %+v", rows)
	}
	if rows[0].Net != 50 || rows[1].Net != -50 {
		t.Fatalf("unexpected nets: %+v", rows)
	}
}

// The ledger sums an account's buy-ins across seats, honours undo, and is
// cleared by a session reset. canBuyIn applies the room's MaxBuy to that
// session total (0 = unlimited).
func TestSessionLedgerAndCanBuyIn(t *testing.T) {
	tbl, _ := newTestTable(t) // default config: buy-in 200, max 400

	if !tbl.canBuyIn("acc-a", 200) {
		t.Fatalf("first buy-in must be allowed")
	}
	tbl.ledger.add("acc-a", 200)
	if !tbl.canBuyIn("acc-a", 200) || tbl.canBuyIn("acc-a", 201) {
		t.Fatalf("second 200 allowed, anything beyond MaxBuy refused")
	}
	tbl.ledger.add("acc-a", 200)
	if tbl.canBuyIn("acc-a", 1) {
		t.Fatalf("at MaxBuy no further buy-in may pass")
	}
	if !tbl.canBuyIn("acc-b", 400) {
		t.Fatalf("other accounts are independent")
	}

	tbl.ledger.sub("acc-a", 200) // undo before the hand started
	if !tbl.canBuyIn("acc-a", 200) {
		t.Fatalf("undo must free the buy-in again")
	}
	tbl.ledger.sub("acc-a", 999) // over-subtracting clamps at zero
	if tbl.ledger.total("acc-a") != 0 {
		t.Fatalf("sub must clamp at zero, got %d", tbl.ledger.total("acc-a"))
	}

	tbl.ledger.add("acc-a", 400)
	tbl.resetSession()
	if !tbl.canBuyIn("acc-a", 400) {
		t.Fatalf("a new session starts with a clean ledger")
	}

	// No cap configured: always allowed.
	poker.Configure(tbl.game, 1, 2, 200, 0, 6, 0)
	tbl.ledger.add("acc-a", 100000)
	if !tbl.canBuyIn("acc-a", 1) {
		t.Fatalf("MaxBuy 0 means unlimited")
	}
}

// A seated player who busts with the max buy-in used up is moved to the
// spectator side, told why, and cannot take a seat again this session; the
// remaining player is untouched.
func TestBustedPlayerIsBenchedAndNotified(t *testing.T) {
	tbl, rec := newTestTable(t)
	hub := newSessionHub(tbl)
	a := seat(t, tbl, "acc-a", 1, false)
	b := seat(t, tbl, "acc-b", 2, false)

	// acc-a bought the full 400 over two stints and lost all of it.
	tbl.ledger.add("acc-a", 400)
	setChips(t, tbl, a, 0, 400)
	setChips(t, tbl, b, 600, 200)

	client := newTestClient(hub, "acc-a")
	client.table = tbl
	client.uuid = a
	tbl.registerClient(client)

	tbl.autoSpectateBusted()

	after := tbl.game.GenerateOmniView()
	if _, still := findPlayer(after, a); still {
		t.Fatalf("busted player must leave the seats")
	}
	if _, ok := findPlayer(after, b); !ok {
		t.Fatalf("the other player must keep their seat")
	}
	if client.uuid != "" {
		t.Fatalf("client must become a spectator (seat uuid cleared)")
	}
	if len(rec.snapshot()) != 1 || rec.snapshot()[0].AccountUUID != "acc-a" {
		t.Fatalf("session must be flushed once for acc-a, got %+v", rec.snapshot())
	}

	// The client got its seat-cleared notice and the busted toast.
	sawBusted := false
	for len(client.send) > 0 {
		var m struct {
			Action  string `json:"action"`
			Message string `json:"message"`
		}
		if err := json.Unmarshal(<-client.send, &m); err == nil && m.Action == actionError && m.Message == msgBustedOut {
			sawBusted = true
		}
	}
	if !sawBusted {
		t.Fatalf("busted player must be told they are out of buy-ins")
	}

	// And they stay out for the rest of the session.
	if tbl.canBuyIn("acc-a", tbl.game.GenerateOmniView().Config.BuyIn) {
		t.Fatalf("no seat for a player with no buy-ins left")
	}
	if !tbl.canBuyIn("acc-b", 200) {
		t.Fatalf("acc-b still has one buy-in left")
	}
}

// The 锦标赛 (tournament) switch on room creation decides whether a buy-in cap
// exists: off → MaxBuy 0 (unlimited), on → the requested cap, defaulting to two
// buy-ins and never below one buy-in. Other defaults are unaffected.
func TestNormalizeRoomConfigTournament(t *testing.T) {
	off := normalizeRoomConfig(0, 0, 0, 600, 0, 20, false)
	if off.maxBuy != 0 {
		t.Fatalf("non-tournament rooms must have no cap, got %d", off.maxBuy)
	}
	if off.sb != 5 || off.bb != 10 || off.buyIn != 200 || off.maxPlayers != 6 || off.handsLimit != 20 {
		t.Fatalf("defaults must still apply: %+v", off)
	}

	on := normalizeRoomConfig(1, 2, 200, 0, 6, 0, true)
	if on.maxBuy != 400 {
		t.Fatalf("tournament default cap is two buy-ins, got %d", on.maxBuy)
	}
	if got := normalizeRoomConfig(1, 2, 200, 600, 6, 0, true).maxBuy; got != 600 {
		t.Fatalf("requested cap must be kept, got %d", got)
	}
	if got := normalizeRoomConfig(1, 2, 200, 50, 6, 0, true).maxBuy; got != 200 {
		t.Fatalf("cap below one buy-in is raised to the buy-in, got %d", got)
	}

	// The lobby flag mirrors the cap.
	tbl, _ := newTestTable(t)
	poker.Configure(tbl.game, 1, 2, 200, 0, 6, 0)
	if tbl.info().Tournament {
		t.Fatalf("no cap → not a tournament")
	}
	poker.Configure(tbl.game, 1, 2, 200, 400, 6, 0)
	if !tbl.info().Tournament {
		t.Fatalf("cap → tournament")
	}
}
