package server

import (
	"errors"
	"fmt"
	"log/slog"
	"sort"

	"github.com/evanofslack/go-poker/poker"
	"github.com/go-redis/redis/v8"
)

// Joining a table while a hand is in progress.
//
// A spectator cannot sit down mid-hand, so tapping an empty seat during a
// hand *reserves* it instead: the seat shows the spectator's avatar with a
// "next hand" tag, tapping it again cancels, and nobody else can take it. The
// moment the hand ends (the deal-game that closes the showdown) every
// reservation is turned into a real seat — bought in, NOT ready. A freshly
// seated player who is not ready keeps autoStartIfReady from dealing, so the
// table stops in the not-ready phase and the newcomer readies up like anyone
// else. (The old "join next hand" button seated and readied the newcomer in
// one go, which let the next hand start under them.)
//
// Reservations are keyed by account, not connection, so a phone that drops
// and reconnects during the hand keeps its claim; the claim goes when the
// account's last connection leaves the room.

// seatReservation is a spectator's claim on an empty seat for the next hand.
// It travels in update-game so every client can draw the claimed seat.
type seatReservation struct {
	SeatID      uint   `json:"seatID"`
	Username    string `json:"username"`
	AccountUUID string `json:"accountUuid"`
	Avatar      string `json:"avatar"`
	AvatarImage bool   `json:"avatarImage"`
}

// userStore is the account wallet the seating code reads and debits. Tests
// inject an in-memory one; production uses Redis (see redisUserStore).
type userStore interface {
	load(uuid string) (*UserRecord, error)
	save(u *UserRecord) error
}

type redisUserStore struct{ rdb *redis.Client }

func (s redisUserStore) load(uuid string) (*UserRecord, error) { return loadUser(s.rdb, uuid) }
func (s redisUserStore) save(u *UserRecord) error              { return saveUser(s.rdb, u) }

// userStore returns the injected store, or Redis.
func (t *table) userStore() userStore {
	if t.users != nil {
		return t.users
	}
	return redisUserStore{t.rdb}
}

// reservations lists the current seat claims, lowest seat first.
func (t *table) reservations() []seatReservation {
	t.reserveMu.Lock()
	defer t.reserveMu.Unlock()
	out := make([]seatReservation, 0, len(t.reserved))
	for _, r := range t.reserved {
		out = append(out, r)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].SeatID < out[j].SeatID })
	return out
}

// seatReservedBy returns the account holding a claim on seatID, if any.
func (t *table) seatReservedBy(seatID uint) (string, bool) {
	t.reserveMu.Lock()
	defer t.reserveMu.Unlock()
	for acc, r := range t.reserved {
		if r.SeatID == seatID {
			return acc, true
		}
	}
	return "", false
}

// dropReservation forgets an account's claim.
func (t *table) dropReservation(account string) {
	t.reserveMu.Lock()
	delete(t.reserved, account)
	t.reserveMu.Unlock()
}

// dropReservationIfGone forgets an account's claim unless one of its
// connections is still in the room (a reconnect replaces the connection but
// keeps the account).
func (t *table) dropReservationIfGone(account string) {
	if account == "" || t.clientForAccount(account) != nil {
		return
	}
	t.dropReservation(account)
}

// clientForAccount returns a live human connection of the account in this
// room, or nil.
func (t *table) clientForAccount(account string) *Client {
	t.clientsMu.Lock()
	defer t.clientsMu.Unlock()
	for c := range t.clients {
		if !c.isBot && c.accountUUID == account {
			return c
		}
	}
	return nil
}

// handleReserveSeat is take-seat while a hand is running: toggle the sender's
// claim on seatID. Everything that would stop them sitting down later (seat
// taken, table full, no buy-ins left, empty wallet) is refused now so the
// spectator gets immediate feedback; it is all checked again at seating time.
func handleReserveSeat(c *Client, seatID uint) {
	t := c.table
	if t == nil {
		c.send <- createError("not in a room")
		return
	}
	if c.accountUUID == "" || c.username == "" {
		c.send <- createError("not logged in")
		return
	}
	if seatID == 0 {
		c.send <- createError("invalid seat")
		return
	}
	view := t.game.GenerateOmniView()
	for i := range view.Players {
		if view.Players[i].UUID == c.uuid || view.Players[i].AccountUUID == c.accountUUID {
			c.send <- createError("already seated")
			return
		}
	}
	if seatTaken(view, seatID) {
		c.send <- createError("seat is taken")
		return
	}
	if holder, ok := t.seatReservedBy(seatID); ok {
		if holder == c.accountUUID {
			// Tapping the claimed seat again cancels the claim.
			t.dropReservation(c.accountUUID)
			t.broadcastGame()
			return
		}
		c.send <- createError("seat is taken")
		return
	}

	// Capacity counts the other pending claims as well as the seated players.
	if view.Config.MaxPlayers != 0 {
		claimed := uint(len(view.Players))
		for _, r := range t.reservations() {
			if r.AccountUUID != c.accountUUID {
				claimed++
			}
		}
		if claimed >= view.Config.MaxPlayers {
			c.send <- createError("table is full")
			return
		}
	}

	amount := view.Config.BuyIn
	if amount == 0 {
		c.send <- createError("amount must be positive")
		return
	}
	if !t.canBuyIn(c.accountUUID, amount) {
		c.send <- createError(msgNoBuyInsLeft)
		return
	}
	user, err := t.userStore().load(c.accountUUID)
	if err != nil {
		c.send <- createError("could not load user")
		return
	}
	if user.Chips < amount {
		c.send <- createError("not enough chips")
		return
	}

	t.reserveMu.Lock()
	t.reserved[c.accountUUID] = seatReservation{
		SeatID:      seatID,
		Username:    c.username,
		AccountUUID: c.accountUUID,
		Avatar:      user.Avatar,
		AvatarImage: user.AvatarImage,
	}
	t.reserveMu.Unlock()
	t.broadcastGame()
}

// seatReservedPlayers turns every claim into a seat once the table is between
// hands. A claim whose holder has left, or who can no longer pay, is dropped
// (the holder is told why). It is a no-op while a hand is running.
func (t *table) seatReservedPlayers() {
	if len(t.reservations()) == 0 {
		return
	}
	if t.game.GenerateOmniView().Stage != poker.NotReady {
		return
	}
	for _, r := range t.reservations() {
		c := t.clientForAccount(r.AccountUUID)
		if c == nil {
			t.dropReservation(r.AccountUUID)
			continue
		}
		if err := t.seatReservedClient(c, r); err != nil {
			slog.Default().Info("Seat reserved player", "account", r.AccountUUID, "error", err)
			c.trySend(createError(err.Error()))
		}
		t.dropReservation(r.AccountUUID)
	}
}

// seatReservedClient buys the claim's holder into the claimed seat (or the
// first free one if it was taken meanwhile). Same order as handleTakeSeat:
// wallet debit, account, name, avatar, buy-in, seat id. The player is left
// NOT ready on purpose (see the file comment).
func (t *table) seatReservedClient(c *Client, r seatReservation) error {
	view := t.game.GenerateOmniView()
	for i := range view.Players {
		if view.Players[i].UUID == c.uuid || view.Players[i].AccountUUID == c.accountUUID {
			return nil // already seated (reconnected with a seat, say)
		}
	}
	if view.Config.MaxPlayers != 0 && uint(len(view.Players)) >= view.Config.MaxPlayers {
		return errors.New("table is full")
	}
	amount := view.Config.BuyIn
	if amount == 0 {
		return errors.New("amount must be positive")
	}
	if !t.canBuyIn(c.accountUUID, amount) {
		return errors.New(msgNoBuyInsLeft)
	}
	store := t.userStore()
	user, err := store.load(c.accountUUID)
	if err != nil {
		return errors.New("could not load user")
	}
	if user.Chips < amount {
		return errors.New("not enough chips")
	}
	user.Chips -= amount
	if err := store.save(user); err != nil {
		return errors.New("could not save user")
	}

	seatID := r.SeatID
	if seatTaken(view, seatID) {
		seatID = 1
		for seatTaken(view, seatID) {
			seatID++
		}
	}

	position := t.game.AddPlayer()
	c.uuid = t.game.GenerateOmniView().Players[position].UUID
	c.trySend(createUpdatedPlayerUUID(c))
	if err := poker.SetAccountUUID(t.game, position, c.accountUUID); err != nil {
		slog.Default().Warn("Set account uuid", "error", err)
	}
	if err := poker.SetUsername(t.game, position, c.username); err != nil {
		slog.Default().Warn("Set username", "error", err)
	}
	if err := poker.SetAvatar(t.game, position, user.Avatar, user.AvatarImage); err != nil {
		slog.Default().Warn("Set avatar", "error", err)
	}
	if err := poker.BuyIn(t.game, position, amount); err != nil {
		slog.Default().Warn("Buy in", "error", err)
	} else {
		t.ledger.add(c.accountUUID, amount)
	}
	if err := poker.SetSeatID(t.game, position, seatID); err != nil {
		slog.Default().Warn("Set seat id", "error", err)
	}
	c.trySend(createUserInfo(t.rdb, user, true))
	t.broadcast <- createNewLog(fmt.Sprintf("%s sits down at seat %d for %d", c.username, seatID, amount))
	return nil
}
