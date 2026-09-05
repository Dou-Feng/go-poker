package server

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	mrand "math/rand"
	"strings"
	"sync"
	"time"

	"github.com/evanofslack/go-poker/poker"
)

// Bots are seats played by the server. A bot is an ordinary *Client with no
// socket: it is registered with the table like a browser (so broadcasts and
// the unicast helpers just work; its send queue is drained and discarded) and
// it acts through the very same handlers a browser message would reach, so
// the engine sees no difference. What is special:
//
//   - identity: account "bot-…", avatar 🤖, no wallet — buy-ins come from
//     nowhere and flushSession skips bots (no history, no Redis record);
//   - lifetime: bots never keep a room alive (emptiness counts humans only),
//     are removed when the room is recycled, and only ready up while a human
//     is seated, so a table can never run on bots alone;
//   - pacing: after every broadcast the table schedules one bot tick
//     (scheduleBots). The tick re-reads the state and does the one thing that
//     is due: act on a bot's turn, drive the runout / showdown deal when the
//     first seat is a bot (mirroring the browser's runout driver), or between
//     hands rebuy, re-seat and ready every bot.

const (
	botAccountPrefix = "bot-"
	botAvatar        = "🤖"
	maxBotsPerTable  = 7
)

var botNames = []string{"Ace", "Bella", "Cash", "Dodge", "Echo", "Flush", "Gigi", "Hawk", "Ivy", "Jolt"}

// botDelays paces the bot so it feels like a player; tests shorten them.
type botDelays struct {
	act      time.Duration // thinking time before an action (plus jitter)
	jitter   time.Duration
	deal     time.Duration // between runout streets (browser uses 900 ms)
	showdown time.Duration // showdown display before the next deal (browser: 5 s)
	ready    time.Duration // between hands before bots ready up
}

var defaultBotDelays = botDelays{
	act:      700 * time.Millisecond,
	jitter:   800 * time.Millisecond,
	deal:     900 * time.Millisecond,
	showdown: 5 * time.Second,
	ready:    900 * time.Millisecond,
}

const (
	msgHostOnly  = "only the host can manage bots"
	msgSeatTaken = "seat is taken"
)

var (
	errBotsFull   = errors.New("table is full")
	errNoBots     = errors.New("no bots at the table")
	errBotRunning = errors.New("game already running")
	errSeatTaken  = errors.New(msgSeatTaken)
)

// isHost reports whether the client is the room's host: the creator, or the
// human the role passed to when the creator left. A room without a host yet
// (created before hosts existed) adopts the first human who asks.
func (t *table) isHost(c *Client) bool {
	if c.isBot || c.accountUUID == "" {
		return false
	}
	t.hostMu.Lock()
	defer t.hostMu.Unlock()
	if t.host == "" {
		t.host = c.accountUUID
	}
	return t.host == c.accountUUID
}

// hostAccount returns the current host's account (for the game view).
func (t *table) hostAccount() string {
	t.hostMu.Lock()
	defer t.hostMu.Unlock()
	return t.host
}

// reassignHostIfGone passes the host role on when the host's last connection
// has left the room: to the seated human with the lowest seat, else to any
// connected human. Reports whether the host changed. Caller holds clientsMu.
func (t *table) reassignHostIfGoneLocked() bool {
	t.hostMu.Lock()
	defer t.hostMu.Unlock()
	if t.host == "" {
		return false
	}
	for c := range t.clients {
		if c.accountUUID == t.host {
			return false // still connected (e.g. a reconnect replaced the socket)
		}
	}
	view := t.game.GenerateOmniView()
	next := ""
	bestSeat := ^uint(0)
	for i := range view.Players {
		p := &view.Players[i]
		if isBotAccount(p.AccountUUID) || p.Left {
			continue
		}
		if !t.accountConnectedLocked(p.AccountUUID) {
			continue
		}
		if p.SeatID < bestSeat {
			bestSeat, next = p.SeatID, p.AccountUUID
		}
	}
	if next == "" {
		for c := range t.clients {
			if !c.isBot && c.accountUUID != "" {
				next = c.accountUUID
				break
			}
		}
	}
	if next == "" || next == t.host {
		return false
	}
	t.host = next
	return true
}

func (t *table) accountConnectedLocked(account string) bool {
	for c := range t.clients {
		if c.accountUUID == account {
			return true
		}
	}
	return false
}

func isBotAccount(account string) bool {
	return strings.HasPrefix(account, botAccountPrefix)
}

// newBotClient builds a socketless client whose outbound queue is discarded.
func newBotClient(hub *Hub, name string) *Client {
	buf := make([]byte, 4)
	_, _ = rand.Read(buf)
	c := &Client{
		hub:         hub,
		send:        make(chan []byte, 64),
		kick:        make(chan kickRequest, 1),
		accountUUID: botAccountPrefix + hex.EncodeToString(buf),
		username:    name,
		isBot:       true,
	}
	go func() {
		for range c.send {
		}
	}()
	return c
}

// botClients snapshots the bots currently registered with the table.
func (t *table) botClients() []*Client {
	t.clientsMu.Lock()
	defer t.clientsMu.Unlock()
	var bots []*Client
	for c := range t.clients {
		if c.isBot {
			bots = append(bots, c)
		}
	}
	return bots
}

// humanCount reports how many real connections the table has.
func (t *table) humanCount() int {
	n := 0
	for c := range t.clients {
		if !c.isBot {
			n++
		}
	}
	return n
}

// botName picks a name not already used at the table.
func (t *table) botName() string {
	used := map[string]bool{}
	for _, b := range t.botClients() {
		used[b.username] = true
	}
	for _, n := range botNames {
		name := "Bot " + n
		if !used[name] {
			return name
		}
	}
	return fmt.Sprintf("Bot %d", len(used)+1)
}

// addBot seats a new bot between hands at seatID (0 = first free seat). The
// room must have a free seat.
func (t *table) addBot(seatID uint) (*Client, error) {
	view := t.game.GenerateOmniView()
	if view.Running {
		return nil, errBotRunning
	}
	if len(t.botClients()) >= maxBotsPerTable {
		return nil, errBotsFull
	}
	if view.Config.MaxPlayers != 0 && uint(len(view.Players)) >= view.Config.MaxPlayers {
		return nil, errBotsFull
	}
	if seatID != 0 && seatTaken(view, seatID) {
		return nil, errSeatTaken
	}
	bot := newBotClient(t.hub, t.botName())
	bot.table = t
	t.registerClient(bot)
	if err := t.seatBot(bot, seatID); err != nil {
		t.dropBotClient(bot)
		return nil, err
	}
	return bot, nil
}

func seatTaken(view *poker.GameView, seatID uint) bool {
	if view.Config.MaxPlayers != 0 && seatID > view.Config.MaxPlayers {
		return true
	}
	for _, p := range view.Players {
		if p.SeatID == seatID {
			return true
		}
	}
	return false
}

// seatBot buys the bot into seatID (0 = first free seat) and readies it.
// Between hands only; the caller broadcasts.
func (t *table) seatBot(bot *Client, seatID uint) error {
	view := t.game.GenerateOmniView()
	if view.Running {
		return errBotRunning
	}
	if view.Config.MaxPlayers != 0 && uint(len(view.Players)) >= view.Config.MaxPlayers {
		return errBotsFull
	}
	amount := view.Config.BuyIn
	if amount == 0 {
		amount = 200
	}
	if !t.canBuyIn(bot.accountUUID, amount) {
		return errors.New(msgNoBuyInsLeft)
	}
	if seatID == 0 {
		seatID = 1
		for seatTaken(view, seatID) {
			seatID++
		}
	} else if seatTaken(view, seatID) {
		return errSeatTaken
	}

	position := t.game.AddPlayer()
	bot.uuid = t.game.GenerateOmniView().Players[position].UUID
	if err := poker.SetAccountUUID(t.game, position, bot.accountUUID); err != nil {
		return err
	}
	if err := poker.SetBot(t.game, position, true); err != nil {
		return err
	}
	if err := poker.SetUsername(t.game, position, bot.username); err != nil {
		return err
	}
	if err := poker.SetAvatar(t.game, position, botAvatar, false); err != nil {
		return err
	}
	if err := poker.BuyIn(t.game, position, amount); err != nil {
		return err
	}
	t.ledger.add(bot.accountUUID, amount)
	// Ready before SetSeatID re-sorts players (see seatQueuedClient).
	if err := poker.ToggleReady(t.game, position, 0); err != nil {
		return err
	}
	return poker.SetSeatID(t.game, position, seatID)
}

// removeBot takes the most recently added bot (or the one holding seat uuid)
// out of the room: mid-hand it folds on its turn like a leaving player and is
// dropped when the hand ends; between hands it leaves at once.
func (t *table) removeBot(uuid string) (string, error) {
	bots := t.botClients()
	if len(bots) == 0 {
		return "", errNoBots
	}
	var target *Client
	for _, b := range bots {
		if uuid == "" || b.uuid == uuid {
			if target == nil || b.username > target.username {
				target = b
			}
		}
	}
	if target == nil {
		return "", errNoBots
	}
	if target.uuid != "" {
		t.evictPlayer(target.uuid)
	}
	t.dropBotClient(target)
	return target.username, nil
}

// dropBotClient unregisters a bot from the table synchronously (there is no
// socket teardown to wait for) and frees its queue.
func (t *table) dropBotClient(bot *Client) {
	t.clientsMu.Lock()
	delete(t.clients, bot)
	t.clientsMu.Unlock()
	bot.closeSend()
}

// ---- pacing --------------------------------------------------------------

// scheduleBots arms a single timer for the next bot task, replacing any
// pending one. Called after every broadcast; no-op without bots or work.
func (t *table) scheduleBots() {
	bots := t.botClients()
	t.botMu.Lock()
	defer t.botMu.Unlock()
	if t.botTimer != nil {
		t.botTimer.Stop()
		t.botTimer = nil
	}
	if len(bots) == 0 {
		return
	}
	delay, ok := t.botDue(bots)
	if !ok {
		return
	}
	t.botTimer = time.AfterFunc(delay, t.botTick)
}

// botDue reports whether a bot has something to do and how long to wait first.
func (t *table) botDue(bots []*Client) (time.Duration, bool) {
	view := t.game.GenerateOmniView()
	d := t.botDelays
	if !view.Running {
		if view.Stage != poker.NotReady || !t.humanSeated(view) {
			return 0, false
		}
		for _, b := range bots {
			p := playerByUUID(view, b.uuid)
			if p == nil || p.Stack == 0 || (!p.Ready && !p.Left) {
				return d.ready, true
			}
		}
		return 0, false
	}
	if view.Betting {
		if int(view.ActionNum) < len(view.Players) && isBotAccount(view.Players[view.ActionNum].AccountUUID) {
			return d.act + time.Duration(mrand.Int63n(int64(d.jitter)+1)), true
		}
		return 0, false
	}
	// Runout or showdown: the browser lets the first non-left seat drive the
	// deals; when that seat is a bot, the bot drives.
	if driver := runoutDriver(view); driver != nil && isBotAccount(driver.AccountUUID) {
		if view.Stage == poker.Showdown {
			return d.showdown, true
		}
		if view.Stage >= poker.PreFlop && view.Stage <= poker.River {
			return d.deal, true
		}
	}
	return 0, false
}

// botTick performs the due task. Every branch ends in a broadcast, which
// schedules the next tick; branches that change nothing schedule nothing.
func (t *table) botTick() {
	bots := t.botClients()
	if len(bots) == 0 {
		return
	}
	view := t.game.GenerateOmniView()

	if !view.Running {
		if view.Stage != poker.NotReady || !t.humanSeated(view) {
			return
		}
		changed := false
		for _, b := range bots {
			p := playerByUUID(view, b.uuid)
			amount := view.Config.BuyIn
			if amount == 0 {
				amount = 200
			}
			switch {
			case p == nil:
				// Lost the seat (settlement reset, or benched after busting):
				// sit back down if the room allows, otherwise leave.
				if err := t.seatBot(b, 0); err != nil {
					t.dropBotClient(b)
					t.broadcast <- createNewLog(fmt.Sprintf("%s left the table", b.username))
				}
				changed = true
			case p.Stack == 0:
				if t.canBuyIn(b.accountUUID, amount) {
					if err := poker.BuyIn(t.game, p.Position, amount); err == nil {
						t.ledger.add(b.accountUUID, amount)
					}
				} else {
					t.evictPlayer(b.uuid)
					t.dropBotClient(b)
					t.broadcast <- createNewLog(fmt.Sprintf("%s is out of buy-ins and left", b.username))
				}
				changed = true
			case !p.Ready && !p.Left:
				if err := poker.ToggleReady(t.game, p.Position, 0); err != nil {
					slog.Default().Warn("Bot ready", "error", err)
				}
				changed = true
			}
			// Positions shift after seating/eviction: refresh the view.
			view = t.game.GenerateOmniView()
		}
		if changed {
			autoStartIfReady(t)
			t.broadcastGame()
		}
		return
	}

	if view.Betting {
		if int(view.ActionNum) >= len(view.Players) {
			return
		}
		actor := view.Players[view.ActionNum]
		bot := t.botByUUID(actor.UUID)
		if bot == nil {
			return
		}
		decision := botDecide(view, view.ActionNum, mrand.Float64)
		switch decision.kind {
		case "fold":
			t.broadcast <- createNewLog(fmt.Sprintf("%s folds", actor.Username))
			handleFold(bot)
		case "check":
			t.broadcast <- createNewLog(fmt.Sprintf("%s checks", actor.Username))
			handleCheck(bot)
		case "call":
			t.broadcast <- createNewLog(fmt.Sprintf("%s calls", actor.Username))
			handleCall(bot)
		case "raise":
			if decision.amount >= actor.Stack {
				t.broadcast <- createNewLog(fmt.Sprintf("%s is all in", actor.Username))
			} else {
				t.broadcast <- createNewLog(fmt.Sprintf("%s bets %d", actor.Username, decision.amount))
			}
			handleRaise(bot, decision.amount)
		}
		return
	}

	if driver := runoutDriver(view); driver != nil {
		if bot := t.botByUUID(driver.UUID); bot != nil {
			handleDealGame(bot)
		}
	}
}

func (t *table) botByUUID(uuid string) *Client {
	if uuid == "" {
		return nil
	}
	for _, b := range t.botClients() {
		if b.uuid == uuid {
			return b
		}
	}
	return nil
}

// humanSeated reports whether at least one real player holds a seat; bots
// never ready up into a table of bots.
func (t *table) humanSeated(view *poker.GameView) bool {
	for i := range view.Players {
		if !isBotAccount(view.Players[i].AccountUUID) && !view.Players[i].Left {
			return true
		}
	}
	return false
}

// playerByUUID returns the seated player with the given per-seat uuid.
func playerByUUID(view *poker.GameView, uuid string) *playerRef {
	if uuid == "" {
		return nil
	}
	for i := range view.Players {
		if view.Players[i].UUID == uuid {
			p := &view.Players[i]
			return &playerRef{Position: uint(i), Stack: p.Stack, Ready: p.Ready, Left: p.Left, In: p.In}
		}
	}
	return nil
}

// playerRef is the subset of the (unexported) engine player the bot needs.
type playerRef struct {
	Position uint
	Stack    uint
	Ready    bool
	Left     bool
	In       bool
}

// runoutDriver mirrors web/components/Table.tsx: the first player who has not
// left drives deal-game during the runout and after the showdown.
func runoutDriver(view *poker.GameView) *struct{ UUID, AccountUUID string } {
	for i := range view.Players {
		if !view.Players[i].Left {
			return &struct{ UUID, AccountUUID string }{view.Players[i].UUID, view.Players[i].AccountUUID}
		}
	}
	return nil
}

// ---- decisions -----------------------------------------------------------

// botAction is what the bot wants to do; for "raise", amount is the number of
// chips to put in (the same unit the browser sends), never more than the stack.
type botAction struct {
	kind   string // "check" | "call" | "fold" | "raise"
	amount uint
}

// handTier buckets a hand into 0 trash, 1 marginal, 2 strong, 3 monster.
func handTier(view *poker.GameView, pn uint) int {
	p := view.Players[pn]
	if p.Cards[0] == 0 || p.Cards[1] == 0 {
		return 0
	}
	r1, r2 := poker.CardRank(p.Cards[0]), poker.CardRank(p.Cards[1])
	hi, lo := r1, r2
	if lo > hi {
		hi, lo = lo, hi
	}
	suited := poker.CardSuit(p.Cards[0]) == poker.CardSuit(p.Cards[1])

	_, name := poker.HandStrength(p.Cards, view.CommunityCards)
	if name == "" {
		// Preflop heuristic. Ranks: 8 = ten, 9 = jack, 11 = king, 12 = ace.
		switch {
		case hi == lo && hi >= 8:
			return 3
		case hi == lo:
			return 2
		case hi >= 11 && lo >= 8: // AT+, KT+
			return 2
		case hi >= 9 && lo >= 9: // QJ
			return 2
		case suited && hi-lo <= 2 && lo >= 3:
			return 1
		case hi == 12: // any ace
			return 1
		case lo >= 7: // two nines or better
			return 1
		default:
			return 0
		}
	}
	switch name {
	case "royal flush", "straight flush", "four of a kind", "full house":
		return 3
	case "flush", "straight", "three of a kind", "two pair":
		return 2
	case "one pair":
		// A pair that uses a hole card is worth something; a pair sitting on
		// the board is not ours.
		for _, c := range view.CommunityCards {
			if c != 0 && (poker.CardRank(c) == r1 || poker.CardRank(c) == r2) {
				return 1
			}
		}
		if r1 == r2 {
			return 1
		}
		return 0
	default:
		return 0
	}
}

// botDecide picks an action for the player at pn. random yields [0,1) and is
// injected so tests are deterministic. Only legal actions are returned: a
// raise satisfies the minimum raise (or is all-in), a call never exceeds the
// stack, and a player who may only call or fold (short all-in in front of
// them) never raises.
func botDecide(view *poker.GameView, pn uint, random func() float64) botAction {
	p := view.Players[pn]
	toCall := uint(0)
	pot := uint(0)
	for _, q := range view.Players {
		if q.Bet > toCall {
			toCall = q.Bet
		}
		pot += q.TotalBet
	}
	callAmount := toCall - p.Bet
	if callAmount > p.Stack {
		callAmount = p.Stack
	}
	bb := view.Config.BigBlind
	if bb == 0 {
		bb = 2
	}
	tier := handTier(view, pn)
	canRaise := !p.Called || callAmount == 0

	// raiseBy returns a legal raise putting `extra` chips over the call in
	// (at least the minimum raise), capped at an all-in.
	raiseBy := func(extra uint) botAction {
		if extra < view.MinRaise {
			extra = view.MinRaise
		}
		chips := callAmount + extra
		if chips >= p.Stack {
			return botAction{kind: "raise", amount: p.Stack}
		}
		return botAction{kind: "raise", amount: chips}
	}
	callOrCheck := func() botAction {
		if callAmount == 0 {
			return botAction{kind: "check"}
		}
		return botAction{kind: "call"}
	}
	pct := func(v uint, percent uint) uint { return v * percent / 100 }

	switch tier {
	case 3:
		if callAmount == 0 {
			if canRaise {
				return raiseBy(maxU(pct(pot, 75), 2*bb))
			}
			return botAction{kind: "check"}
		}
		if canRaise && random() < 0.8 {
			return raiseBy(maxU(pct(pot, 100), 2*callAmount))
		}
		return botAction{kind: "call"}
	case 2:
		if callAmount == 0 {
			if canRaise && random() < 0.7 {
				return raiseBy(maxU(pct(pot, 55), 2*bb))
			}
			return botAction{kind: "check"}
		}
		if canRaise && callAmount <= pct(p.Stack, 30) && random() < 0.25 {
			return raiseBy(maxU(pct(pot, 60), 2*callAmount))
		}
		if callAmount > pct(p.Stack, 50) && random() < 0.4 {
			return botAction{kind: "fold"}
		}
		return botAction{kind: "call"}
	case 1:
		if callAmount == 0 {
			if canRaise && random() < 0.35 {
				return raiseBy(maxU(pct(pot, 40), 2*bb))
			}
			return botAction{kind: "check"}
		}
		if callAmount <= maxU(pct(pot, 50), 3*bb) || random() < 0.12 {
			return botAction{kind: "call"}
		}
		return botAction{kind: "fold"}
	default:
		if callAmount == 0 {
			if canRaise && len(view.CommunityCards) > 0 && view.CommunityCards[0] != 0 && random() < 0.12 {
				return raiseBy(maxU(pct(pot, 50), 2*bb)) // occasional bluff
			}
			return callOrCheck()
		}
		if callAmount <= bb && random() < 0.5 {
			return botAction{kind: "call"} // limp along cheaply
		}
		if random() < 0.06 {
			return botAction{kind: "call"}
		}
		return botAction{kind: "fold"}
	}
}

func maxU(a, b uint) uint {
	if a > b {
		return a
	}
	return b
}

// botState is the per-table bot state (embedded in table): pacing, plus the
// host who is allowed to manage bots.
type botState struct {
	botMu     sync.Mutex
	botTimer  *time.Timer
	botDelays botDelays
	hostMu    sync.Mutex
	host      string // account UUID of the room host
}

// stopBots cancels any pending tick and releases every bot (room recycled).
func (t *table) stopBots() {
	t.botMu.Lock()
	if t.botTimer != nil {
		t.botTimer.Stop()
		t.botTimer = nil
	}
	t.botMu.Unlock()
	for _, b := range t.botClients() {
		t.dropBotClient(b)
	}
}
