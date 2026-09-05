package server

import (
	"testing"
	"time"

	"github.com/alexclewontin/riverboat/eval"
	"github.com/evanofslack/go-poker/poker"
)

// Bot tests run without Redis: bots have no wallet, and the table's flush hook
// is the in-memory recorder. Every bot action broadcasts, so the table's
// broadcast channel is drained in the background (there is no run loop).

func drainBroadcasts(t *testing.T, tbl *table) {
	t.Helper()
	done := make(chan struct{})
	go func() {
		for {
			select {
			case <-tbl.broadcast:
			case <-done:
				return
			}
		}
	}()
	t.Cleanup(func() { close(done) })
}

// botTable is a test table with instant bot pacing.
func botTable(t *testing.T) (*table, *flushRecorder) {
	t.Helper()
	tbl, rec := newTestTable(t)
	tbl.botDelays = botDelays{act: time.Millisecond, jitter: time.Millisecond, deal: time.Millisecond, showdown: time.Millisecond, ready: time.Millisecond}
	drainBroadcasts(t, tbl)
	return tbl, rec
}

// Adding a bot seats it at the first free seat, bought in and ready, with the
// robot avatar and a ledger entry; it is not a human for room lifetime.
func TestAddBotSeatsReadyBot(t *testing.T) {
	tbl, rec := botTable(t)
	hub := newSessionHub(tbl)
	human := newTestClient(hub, "acc-h")
	human.table = tbl
	tbl.registerClient(human)
	human.uuid = seat(t, tbl, "acc-h", 2, false)

	bot, err := tbl.addBot(0)
	if err != nil {
		t.Fatalf("add bot: %v", err)
	}
	view := tbl.game.GenerateOmniView()
	pos, ok := findPlayer(view, bot.uuid)
	if !ok {
		t.Fatalf("bot must be seated")
	}
	p := view.Players[pos]
	if !p.Ready || p.Stack != 200 || p.SeatID != 1 || p.Avatar != botAvatar || p.Username != "Bot Ace" || !isBotAccount(p.AccountUUID) {
		t.Fatalf("unexpected bot seat: %+v", p)
	}
	if tbl.ledger.total(bot.accountUUID) != 200 {
		t.Fatalf("bot buy-in must be on the ledger")
	}
	if tbl.info().Players != 2 || tbl.info().Spectators != 0 {
		t.Fatalf("lobby info: %+v", tbl.info())
	}

	// A second bot gets the next name and seat.
	bot2, err := tbl.addBot(0)
	if err != nil {
		t.Fatalf("add second bot: %v", err)
	}
	if bot2.username != "Bot Bella" {
		t.Fatalf("second bot name: %q", bot2.username)
	}

	// Removing between hands drops the seat and the client at once; the
	// flush hook is never called for bots.
	name, err := tbl.removeBot("")
	if err != nil || name != "Bot Bella" {
		t.Fatalf("remove: %q %v", name, err)
	}
	if _, still := findPlayer(tbl.game.GenerateOmniView(), bot2.uuid); still {
		t.Fatalf("removed bot must leave its seat")
	}
	if len(tbl.botClients()) != 1 {
		t.Fatalf("one bot must remain, got %d", len(tbl.botClients()))
	}
	if len(rec.snapshot()) != 0 {
		t.Fatalf("bots must not be flushed to a wallet: %+v", rec.snapshot())
	}

	// Bots never keep the room alive: with the human gone the empty timer arms.
	tbl.unregisterClient(human)
	if tbl.emptyTimer == nil {
		t.Fatalf("a room with only bots must be scheduled for recycling")
	}
	// And a bot registering does not disarm it.
	if _, err := tbl.addBot(0); err != nil {
		t.Fatalf("add bot: %v", err)
	}
	if tbl.emptyTimer == nil {
		t.Fatalf("a bot must not cancel the empty timer")
	}
}

// Bots cannot be added while a hand runs, nor beyond the seat cap.
func TestAddBotRefusals(t *testing.T) {
	tbl, _ := botTable(t)
	poker.Configure(tbl.game, 1, 2, 200, 400, 2, 0)
	seat(t, tbl, "acc-h", 1, true)
	if _, err := tbl.addBot(0); err != nil {
		t.Fatalf("first bot: %v", err)
	}
	if _, err := tbl.addBot(0); err != errBotsFull {
		t.Fatalf("seat cap must refuse, got %v", err)
	}
	if err := tbl.game.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	if _, err := tbl.addBot(0); err != errBotRunning {
		t.Fatalf("running hand must refuse, got %v", err)
	}
	if _, err := tbl.removeBot("nope"); err != errNoBots {
		t.Fatalf("unknown bot uuid: %v", err)
	}
}

// Human-only majority: one human plus one bot, the human's vote settles.
func TestVoteSettleIgnoresBots(t *testing.T) {
	tbl, _ := botTable(t)
	hub := newSessionHub(tbl)
	human := newTestClient(hub, "acc-h")
	human.table = tbl
	human.username = "acc-h"
	tbl.registerClient(human)
	human.uuid = seat(t, tbl, "acc-h", 1, false)
	if _, err := tbl.addBot(0); err != nil {
		t.Fatalf("add bot: %v", err)
	}

	tbl.voteSettle(human)
	// Between hands an approved vote settles at once (broadcastGame →
	// maybeSettleAfterHand → settle), which resets the table for a new
	// session: every seat is cleared.
	if n := len(tbl.game.GenerateOmniView().Players); n != 0 {
		t.Fatalf("one human of one must be a majority (bots do not count); %d seats still occupied", n)
	}
}

// Only the host manages bots; the role passes to another human when the host
// leaves; the host may pick the bot's seat, and a taken seat is refused.
func TestHostOnlyBotManagementAndSeatChoice(t *testing.T) {
	tbl, _ := botTable(t)
	hub := newSessionHub(tbl)
	host := newTestClient(hub, "acc-host")
	host.table = tbl
	tbl.registerClient(host)
	tbl.host = "acc-host"
	host.uuid = seat(t, tbl, "acc-host", 1, false)
	guest := newTestClient(hub, "acc-guest")
	guest.table = tbl
	tbl.registerClient(guest)
	guest.uuid = seat(t, tbl, "acc-guest", 2, false)

	handleAddBot(guest, 3)
	if m := <-guest.send; string(m) != string(createError(msgHostOnly)) {
		t.Fatalf("guest must be refused: %s", m)
	}
	if len(tbl.botClients()) != 0 {
		t.Fatalf("no bot may be added by a guest")
	}

	handleAddBot(host, 4)
	view := tbl.game.GenerateOmniView()
	bots := tbl.botClients()
	if len(bots) != 1 {
		t.Fatalf("host must be able to add a bot")
	}
	pos, _ := findPlayer(view, bots[0].uuid)
	if view.Players[pos].SeatID != 4 {
		t.Fatalf("bot must take the chosen seat 4, got %d", view.Players[pos].SeatID)
	}
	handleAddBot(host, 2) // guest's seat
	if m := <-host.send; string(m) != string(createError(msgSeatTaken)) {
		t.Fatalf("taken seat must be refused: %s", m)
	}
	handleRemoveBot(guest, bots[0].uuid)
	if m := <-guest.send; string(m) != string(createError(msgHostOnly)) {
		t.Fatalf("guest must not remove bots: %s", m)
	}

	// Host leaves: the guest inherits the role and can now manage bots.
	tbl.unregisterClient(host)
	if tbl.host != "acc-guest" {
		t.Fatalf("host role must pass to the remaining human, got %q", tbl.host)
	}
	handleRemoveBot(guest, "")
	if len(tbl.botClients()) != 0 {
		t.Fatalf("new host must be able to remove the bot")
	}
}

// Without a seated human, bots never ready up (a table cannot run on bots).
func TestBotsIdleWithoutHumans(t *testing.T) {
	tbl, _ := botTable(t)
	human := seat(t, tbl, "acc-h", 1, false)
	bot, err := tbl.addBot(0)
	if err != nil {
		t.Fatalf("add bot: %v", err)
	}
	// Human leaves; bot un-readies (as after a pause).
	pos, _ := findPlayer(tbl.game.GenerateOmniView(), human)
	if err := poker.RemovePlayer(tbl.game, uint(pos)); err != nil {
		t.Fatalf("remove: %v", err)
	}
	pos, _ = findPlayer(tbl.game.GenerateOmniView(), bot.uuid)
	if err := poker.ToggleReady(tbl.game, uint(pos), 0); err != nil {
		t.Fatalf("unready bot: %v", err)
	}
	if _, due := tbl.botDue(tbl.botClients()); due {
		t.Fatalf("no human seated: bots must stay idle")
	}
	// A human sits down: now the bot has work (ready up).
	seat(t, tbl, "acc-h2", 3, false)
	if _, due := tbl.botDue(tbl.botClients()); !due {
		t.Fatalf("with a human seated the bot must ready up")
	}
}

// Decisions are always legal for the engine: a check/call/raise returned for
// the acting player is accepted by Bet, a raise never exceeds the stack, and
// a free check is never turned into a fold. Exercised across many random
// draws and every street of a real dealt hand.
func TestBotDecideIsAlwaysLegal(t *testing.T) {
	tbl, _ := botTable(t)
	a := seat(t, tbl, "acc-a", 1, true)
	b := seat(t, tbl, "acc-b", 2, true)
	_ = a
	_ = b
	if err := tbl.game.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	rnd := uint64(12345)
	next := func() float64 {
		rnd = rnd*6364136223846793005 + 1442695040888963407
		return float64(rnd>>11) / float64(1<<53)
	}
	checks := 0
	for step := 0; step < 400; step++ {
		view := tbl.game.GenerateOmniView()
		if !view.Running {
			// Hand over: settle (if showdown) and start the next one.
			if view.Stage == poker.Showdown {
				if err := poker.SettleShowdown(tbl.game); err != nil {
					t.Fatalf("settle: %v", err)
				}
			}
			view = tbl.game.GenerateOmniView()
			for i := range view.Players {
				if !view.Players[i].Ready && view.Players[i].Stack > 0 {
					_ = poker.ToggleReady(tbl.game, uint(i), 0)
				}
			}
			if err := tbl.game.Start(); err != nil {
				break // someone busted out: the table is paused, enough hands seen
			}
			continue
		}
		if !view.Betting {
			if view.Stage == poker.Showdown {
				if err := poker.SettleShowdown(tbl.game); err != nil {
					t.Fatalf("settle: %v", err)
				}
			} else if err := poker.RunoutNext(tbl.game); err != nil {
				t.Fatalf("runout: %v", err)
			}
			continue
		}
		pn := view.ActionNum
		p := view.Players[pn]
		toCall := uint(0)
		for _, q := range view.Players {
			if q.Bet > toCall {
				toCall = q.Bet
			}
		}
		d := botDecide(view, pn, next)
		if toCall == p.Bet && d.kind == "fold" {
			t.Fatalf("step %d: folded when a check was free: %+v", step, view.Players[pn])
		}
		switch d.kind {
		case "fold":
			if err := poker.Fold(tbl.game, pn, 0); err != nil {
				t.Fatalf("step %d: fold rejected: %v", step, err)
			}
		case "check":
			checks++
			if err := poker.Bet(tbl.game, pn, 0); err != nil {
				t.Fatalf("step %d: check rejected: %v", step, err)
			}
		case "call":
			amt := toCall - p.Bet
			if amt > p.Stack {
				amt = p.Stack
			}
			if err := poker.Bet(tbl.game, pn, amt); err != nil {
				t.Fatalf("step %d: call rejected: %v", step, err)
			}
		case "raise":
			if d.amount > p.Stack || d.amount == 0 {
				t.Fatalf("step %d: raise amount %d out of range (stack %d)", step, d.amount, p.Stack)
			}
			if err := poker.Bet(tbl.game, pn, d.amount); err != nil {
				t.Fatalf("step %d: raise %d rejected: %v (toCall %d bet %d minRaise %d called %v)", step, d.amount, err, toCall, p.Bet, view.MinRaise, p.Called)
			}
		default:
			t.Fatalf("unknown decision %q", d.kind)
		}
	}
}

// Hand tiers: pocket aces are a monster preflop, seven-deuce is trash, a pair
// made with a hole card beats a pair that is only on the board.
func TestHandTier(t *testing.T) {
	tbl, _ := botTable(t)
	a := seat(t, tbl, "acc-a", 1, true)
	seat(t, tbl, "acc-b", 2, true)
	if err := tbl.game.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	c := eval.MustParseCardString
	set := func(hole [2]eval.Card, board []eval.Card) *poker.GameView {
		view := tbl.game.GenerateOmniView()
		pos, _ := findPlayer(view, a)
		view.Players[pos].Cards = hole
		for i := range view.CommunityCards {
			view.CommunityCards[i] = 0
		}
		copy(view.CommunityCards, board)
		return view
	}
	posOf := func(view *poker.GameView) uint {
		pos, _ := findPlayer(view, a)
		return uint(pos)
	}
	none := []eval.Card{}
	cases := []struct {
		name  string
		hole  [2]eval.Card
		board []eval.Card
		want  int
	}{
		{"aces preflop", [2]eval.Card{c("As"), c("Ad")}, none, 3},
		{"deuces preflop", [2]eval.Card{c("2s"), c("2d")}, none, 2},
		{"ace-king preflop", [2]eval.Card{c("As"), c("Kd")}, none, 2},
		{"suited connectors", [2]eval.Card{c("7h"), c("8h")}, none, 1},
		{"seven-deuce", [2]eval.Card{c("7c"), c("2d")}, none, 0},
		{"top pair on flop", [2]eval.Card{c("As"), c("Kd")}, []eval.Card{c("Ah"), c("7c"), c("2d")}, 1},
		{"board pair only", [2]eval.Card{c("Ts"), c("4d")}, []eval.Card{c("7h"), c("7c"), c("2d")}, 0},
		{"set on flop", [2]eval.Card{c("7s"), c("7d")}, []eval.Card{c("7h"), c("Kc"), c("2d")}, 2},
		{"full house river", [2]eval.Card{c("7s"), c("7d")}, []eval.Card{c("7h"), c("Kc"), c("Kd"), c("2s"), c("9c")}, 3},
	}
	for _, tc := range cases {
		view := set(tc.hole, tc.board)
		if got := handTier(view, posOf(view)); got != tc.want {
			t.Fatalf("%s: tier %d, want %d", tc.name, got, tc.want)
		}
	}
}

// A bot in the first seat plays a whole hand against a calling human and
// drives the runout/showdown deals itself, and the hand counter advances.
func TestBotPlaysHandsAgainstHuman(t *testing.T) {
	tbl, _ := botTable(t)
	hub := newSessionHub(tbl)
	bot, err := tbl.addBot(0) // seat 1: the bot is the runout driver
	if err != nil {
		t.Fatalf("add bot: %v", err)
	}
	human := newTestClient(hub, "acc-h")
	human.table = tbl
	human.username = "acc-h"
	tbl.registerClient(human)
	human.uuid = seat(t, tbl, "acc-h", 2, true)

	if !autoStartIfReady(tbl) {
		t.Fatalf("both ready: the hand must start")
	}
	tbl.broadcastGame() // arms the bot

	// The human calls whenever it is their turn; the bot does the rest.
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		view := tbl.game.GenerateOmniView()
		if view.HandsPlayed >= 2 {
			break
		}
		if view.Running && view.Betting && int(view.ActionNum) < len(view.Players) && view.Players[view.ActionNum].UUID == human.uuid {
			handleCall(human)
		}
		time.Sleep(2 * time.Millisecond)
	}
	view := tbl.game.GenerateOmniView()
	if view.HandsPlayed < 2 {
		t.Fatalf("bot must play hands through; handsPlayed=%d stage=%d betting=%v running=%v", view.HandsPlayed, view.Stage, view.Betting, view.Running)
	}
	if _, ok := findPlayer(view, bot.uuid); !ok {
		t.Fatalf("bot must still be seated")
	}
	total := uint(0)
	for _, p := range view.Players {
		total += p.Stack + p.TotalBet
	}
	if total != 400 {
		t.Fatalf("chips must be conserved, got %d", total)
	}
}

// The bot account prefix can never collide with a real account: registration
// only accepts letters and digits, and the seat view carries an explicit flag
// so clients need not rely on the prefix.
func TestBotIdentityCannotBeForged(t *testing.T) {
	if validUUID("bot-abcdef") || validUUID("bot-") {
		t.Fatalf("a human must not be able to register an id with the bot prefix")
	}
	if !validUUID("alice1") {
		t.Fatalf("plain alphanumeric ids stay valid")
	}
	tbl, _ := botTable(t)
	seat(t, tbl, "acc-h", 1, false)
	bot, err := tbl.addBot(0)
	if err != nil {
		t.Fatalf("add bot: %v", err)
	}
	view := tbl.game.GenerateOmniView()
	for _, p := range view.Players {
		if (p.UUID == bot.uuid) != p.Bot {
			t.Fatalf("Bot flag must be set exactly on the bot seat: %+v", p)
		}
	}
}

// Removing a bot and adding one again reuses the name and therefore the same
// account, so the scoreboard shows a single "Bot Ace" row with both stints
// merged rather than one row per add/remove cycle. In a tournament room a
// name whose buy-ins are used up is skipped for the next name.
func TestReaddedBotMergesIntoOneScoreboardRow(t *testing.T) {
	tbl, _ := botTable(t)
	seat(t, tbl, "acc-h", 1, false)

	bot, err := tbl.addBot(0)
	if err != nil {
		t.Fatalf("add: %v", err)
	}
	// The bot loses half its stack, then the host removes it.
	setChips(t, tbl, bot.uuid, 100, 200)
	if _, err := tbl.removeBot(bot.uuid); err != nil {
		t.Fatalf("remove: %v", err)
	}
	again, err := tbl.addBot(0)
	if err != nil {
		t.Fatalf("re-add: %v", err)
	}
	if again.username != "Bot Ace" || again.accountUUID != bot.accountUUID {
		t.Fatalf("re-added bot must reuse name and account: %q %q", again.username, again.accountUUID)
	}

	rows := settlementRows(tbl.game.GenerateOmniView())
	aces := 0
	for _, r := range rows {
		if r.Username == "Bot Ace" {
			aces++
			if r.BuyIn != 400 || r.Net != -100 {
				t.Fatalf("both stints must merge (400 in, 100 lost so far): %+v", r)
			}
		}
	}
	if aces != 1 {
		t.Fatalf("want exactly one Bot Ace row, got %d in %+v", aces, rows)
	}

	// Tournament cap (default 400) is now used up for "Bot Ace" after its two
	// buy-ins: remove it and the next bot gets the next name instead.
	if _, err := tbl.removeBot(again.uuid); err != nil {
		t.Fatalf("remove again: %v", err)
	}
	next, err := tbl.addBot(0)
	if err != nil {
		t.Fatalf("add next: %v", err)
	}
	if next.username != "Bot Bella" {
		t.Fatalf("exhausted name must be skipped, got %q", next.username)
	}
}
