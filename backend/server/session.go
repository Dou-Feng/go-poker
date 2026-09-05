package server

import (
	"github.com/gorilla/websocket"
)

// msgSessionTakenover is sent — with an empty tablename, i.e. account-level —
// to a connection whose account was just authenticated on another device.
// The frontend maps it to a translated "logged in elsewhere" error.
const msgSessionTakenover = "account logged in on another device"

// bindSession enforces one live connection per account. It records c as the
// account's holder in the hub's session registry, kicking any previous
// connection, and transfers the account's seat to c: either the seat the
// previous connection held (session takeover) or, when nobody is live, the
// account's orphaned seat at any table (a holder who went offline within the
// grace period). Called at the end of every successful authentication.
func (h *Hub) bindSession(c *Client) {
	if c.accountUUID == "" {
		return
	}

	h.sessionsMu.Lock()
	if h.sessions == nil {
		h.sessions = make(map[string]*Client)
	}
	// The same socket re-authenticated as a different account: release
	// whatever account it held before.
	for acc, held := range h.sessions {
		if held == c && acc != c.accountUUID {
			delete(h.sessions, acc)
		}
	}
	old := h.sessions[c.accountUUID]
	h.sessions[c.accountUUID] = c
	h.sessionsMu.Unlock()

	if old != nil && old != c {
		// Kicking comes first: the flag stops old's inbound processing, so
		// its table/uuid fields stop moving and its teardown will skip the
		// offline timer for the seat we are about to hand over.
		kickClient(old)
	}

	// Seat to transfer: the one the previous connection held, or — when
	// nobody is live (holder went offline within the grace period, or the
	// previous connection was a spectator) — this account's orphaned seat.
	t, seat := (*table)(nil), ""
	if old != nil && old != c && old.table != nil && old.uuid != "" && tableHasPlayer(old.table, old.uuid) {
		t, seat = old.table, old.uuid
	}
	if t == nil && c.table == nil {
		t, seat = h.findSeatByAccount(c.accountUUID)
	}
	if t == nil {
		return
	}

	c.table = t
	t.register <- c
	if !reconnectPlayer(c, seat) {
		// The seat vanished between the scan and the restore: stay in the
		// room as a spectator rather than leaving the client stateless.
		c.send <- createUpdatedGame(c)
	}
}

// kickClient arms old's writePump to deliver the takeover notice and then
// the close frame. The send is non-blocking: the channel has capacity 1 and
// is never closed, and a nil channel (test literals) falls through the
// default.
func kickClient(old *Client) {
	// Before anything else: detachTable checks this to skip the offline
	// timer for the transferred seat.
	old.kicked.Store(true)
	select {
	case old.kick <- kickRequest{
		notice:   createSessionExpired("", msgSessionTakenover),
		closeMsg: websocket.FormatCloseMessage(websocket.ClosePolicyViolation, msgSessionTakenover),
	}:
	default:
	}
}

// findSeatByAccount returns the account's orphaned seat — a seat whose player
// belongs to the account and that no live client holds — searching every
// table. The scan is pure; anything with side effects happens at the caller,
// outside the tables lock.
func (h *Hub) findSeatByAccount(accountUUID string) (*table, string) {
	type seatRef struct {
		t    *table
		uuid string
	}
	var found []seatRef
	h.tablesMu.Lock()
	for t := range h.tables {
		view := t.game.GenerateOmniView()
		for i := range view.Players {
			if view.Players[i].AccountUUID == accountUUID {
				found = append(found, seatRef{t, view.Players[i].UUID})
			}
		}
	}
	h.tablesMu.Unlock()

	for _, ref := range found {
		// A seat held by a live connection is the kick path's business, not
		// the orphan path's.
		if !ref.t.seatHasClient(ref.uuid) {
			return ref.t, ref.uuid
		}
	}
	return nil, ""
}

// forgetSession drops the client's session binding, but only if this client
// is still the account's holder (a newer connection may have replaced it).
func (h *Hub) forgetSession(c *Client) {
	if c.accountUUID == "" {
		return
	}
	h.sessionsMu.Lock()
	if h.sessions != nil && h.sessions[c.accountUUID] == c {
		delete(h.sessions, c.accountUUID)
	}
	h.sessionsMu.Unlock()
}
