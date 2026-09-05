package server

import (
	"bytes"
	"encoding/json"
	"errors"
	"testing"
)

// Tests for the voice-chat signalling relay (voice.go). No Redis is needed:
// signals go straight from the sender to the target connections' send queues.

// voiceRoom builds a table with the given accounts registered as clients. An
// empty account string registers an anonymous spectator.
func voiceRoom(t *testing.T, accounts ...string) (*table, []*Client) {
	t.Helper()
	tbl, _ := newTestTable(t)
	hub := newSessionHub(tbl)
	clients := make([]*Client, 0, len(accounts))
	for _, acc := range accounts {
		c := newTestClient(hub, acc)
		c.table = tbl
		tbl.registerClient(c)
		clients = append(clients, c)
	}
	return tbl, clients
}

// recvVoice pops one queued message from the client and decodes it as a voice
// signal, failing if nothing is queued.
func recvVoice(t *testing.T, c *Client) voiceSignal {
	t.Helper()
	select {
	case raw := <-c.send:
		var sig voiceSignal
		if err := json.Unmarshal(raw, &sig); err != nil {
			t.Fatalf("decode voice signal: %v", err)
		}
		if sig.Action != actionVoiceSignal {
			t.Fatalf("expected action %q, got %q", actionVoiceSignal, sig.Action)
		}
		return sig
	default:
		t.Fatalf("expected a queued message for %q", c.accountUUID)
	}
	return voiceSignal{}
}

// expectSilent fails if the client has anything queued.
func expectSilent(t *testing.T, c *Client) {
	t.Helper()
	select {
	case raw := <-c.send:
		t.Fatalf("client %q should receive nothing, got %s", c.accountUUID, raw)
	default:
	}
}

// An SDP offer addressed to one account reaches only that account, stamped
// with the sender's identity and with the payload passed through untouched.
func TestVoiceSignalUnicastReachesOnlyTarget(t *testing.T) {
	_, cs := voiceRoom(t, "acc-a", "acc-b", "acc-c")
	a, b, c := cs[0], cs[1], cs[2]

	payload := json.RawMessage(`{"type":"offer","sdp":"v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n"}`)
	if err := handleVoiceSignal(a, voiceSignal{To: "acc-b", Kind: "offer", Payload: payload}); err != nil {
		t.Fatalf("relay offer: %v", err)
	}

	got := recvVoice(t, b)
	if got.From != "acc-a" || got.To != "acc-b" || got.Kind != "offer" {
		t.Fatalf("unexpected envelope: %+v", got)
	}
	if !bytes.Equal(got.Payload, payload) {
		t.Fatalf("payload must pass through verbatim: %s", got.Payload)
	}
	expectSilent(t, a)
	expectSilent(t, c)
}

// A join announcement with no target fans out to every other logged-in client
// in the room; the sender and anonymous spectators get nothing.
func TestVoiceSignalBroadcastSkipsSenderAndAnonymous(t *testing.T) {
	_, cs := voiceRoom(t, "acc-a", "acc-b", "acc-c", "")
	a, b, c, anon := cs[0], cs[1], cs[2], cs[3]

	if err := handleVoiceSignal(a, voiceSignal{Kind: "join", Payload: json.RawMessage(`{"mic":true}`)}); err != nil {
		t.Fatalf("relay join: %v", err)
	}

	for _, peer := range []*Client{b, c} {
		got := recvVoice(t, peer)
		if got.From != "acc-a" || got.To != "" || got.Kind != "join" {
			t.Fatalf("unexpected envelope for %q: %+v", peer.accountUUID, got)
		}
		if string(got.Payload) != `{"mic":true}` {
			t.Fatalf("payload lost: %s", got.Payload)
		}
	}
	expectSilent(t, a)
	expectSilent(t, anon)
}

// A client cannot forge the sender: whatever From it puts on the wire is
// replaced by its own account.
func TestVoiceSignalOverwritesForgedFrom(t *testing.T) {
	_, cs := voiceRoom(t, "acc-a", "acc-b")
	a, b := cs[0], cs[1]

	if err := handleVoiceSignal(a, voiceSignal{To: "acc-b", From: "acc-mallory", Kind: "ice", Payload: json.RawMessage(`[]`)}); err != nil {
		t.Fatalf("relay ice: %v", err)
	}
	if got := recvVoice(t, b); got.From != "acc-a" {
		t.Fatalf("From must be the real sender, got %q", got.From)
	}
}

// Malformed or out-of-place signals are refused before touching the room.
func TestVoiceSignalRejections(t *testing.T) {
	tbl, cs := voiceRoom(t, "acc-a", "acc-b", "")
	a, b, anon := cs[0], cs[1], cs[2]

	lobby := newTestClient(tbl.hub, "acc-lobby") // logged in, not in a room

	cases := []struct {
		name string
		from *Client
		sig  voiceSignal
		want error
	}{
		{"outside a room", lobby, voiceSignal{Kind: "join"}, errVoiceNotInRoom},
		{"anonymous sender", anon, voiceSignal{Kind: "join"}, errVoiceNoAccount},
		{"unknown kind", a, voiceSignal{To: "acc-b", Kind: "chat"}, errVoiceBadKind},
		{"addressed to self", a, voiceSignal{To: "acc-a", Kind: "offer"}, errVoiceSelf},
		{"broadcast offer", a, voiceSignal{Kind: "offer"}, errVoiceBadKind},
		{"broadcast answer", a, voiceSignal{Kind: "answer"}, errVoiceBadKind},
		{"broadcast ice", a, voiceSignal{Kind: "ice"}, errVoiceBadKind},
	}
	for _, tc := range cases {
		err := handleVoiceSignal(tc.from, tc.sig)
		if !errors.Is(err, tc.want) {
			t.Fatalf("%s: want %v, got %v", tc.name, tc.want, err)
		}
	}
	// Nothing leaked to the room.
	expectSilent(t, a)
	expectSilent(t, b)
	expectSilent(t, anon)
}

// A signal to an account that is not in this room is silently dropped, never
// delivered to a same-named account elsewhere.
func TestVoiceSignalToAbsentAccountGoesNowhere(t *testing.T) {
	_, cs := voiceRoom(t, "acc-a", "acc-b")
	a, b := cs[0], cs[1]

	other, others := voiceRoom(t, "acc-z")
	_ = other

	if err := handleVoiceSignal(a, voiceSignal{To: "acc-z", Kind: "offer", Payload: json.RawMessage(`{}`)}); err != nil {
		t.Fatalf("relay: %v", err)
	}
	expectSilent(t, b)
	expectSilent(t, others[0])
}

// When a connection detaches from the table (leave button, socket drop, or
// takeover) the room is told the peer left, so browsers close the peer
// connection at once. A new connection of the same account that is already
// in the room must not receive its own account's leave, or it would drop the
// mesh it just built.
func TestUnregisterAnnouncesVoiceLeave(t *testing.T) {
	tbl, cs := voiceRoom(t, "acc-a", "acc-b")
	a, b := cs[0], cs[1]

	// A second connection for acc-a (session takeover) is already registered.
	a2 := newTestClient(tbl.hub, "acc-a")
	a2.table = tbl
	tbl.registerClient(a2)

	tbl.unregisterClient(a)

	got := recvVoice(t, b)
	if got.From != "acc-a" || got.Kind != "leave" || got.To != "" {
		t.Fatalf("expected broadcast leave from acc-a, got %+v", got)
	}
	expectSilent(t, a2)
	expectSilent(t, a)

	// Unregistering a client that was never registered announces nothing.
	stranger := newTestClient(tbl.hub, "acc-s")
	stranger.table = tbl
	tbl.unregisterClient(stranger)
	expectSilent(t, b)
}

// A peer whose outbound queue is saturated is skipped rather than blocking the
// sender's reader goroutine.
func TestVoiceSignalDropsWhenPeerQueueFull(t *testing.T) {
	_, cs := voiceRoom(t, "acc-a", "acc-b")
	a, b := cs[0], cs[1]

	for i := 0; i < cap(b.send); i++ {
		b.send <- []byte(`{"action":"pong"}`)
	}

	done := make(chan struct{})
	go func() {
		defer close(done)
		if err := handleVoiceSignal(a, voiceSignal{To: "acc-b", Kind: "ice", Payload: json.RawMessage(`[]`)}); err != nil {
			t.Errorf("relay: %v", err)
		}
	}()
	waitFor(t, "relay to return without blocking", func() bool {
		select {
		case <-done:
			return true
		default:
			return false
		}
	})
	if len(b.send) != cap(b.send) {
		t.Fatalf("queue must be untouched when full")
	}
}

// A client whose connection the hub has already torn down (send channel
// closed) may still be in the table's client set for a moment. Relaying to it
// must be a no-op, never a panic: this exact race (two players disconnecting
// together, the leave announcement of one reaching the closed queue of the
// other) took the whole process down.
func TestVoiceRelaySkipsClosedClients(t *testing.T) {
	tbl, cs := voiceRoom(t, "acc-a", "acc-b", "acc-c")
	a, b, c := cs[0], cs[1], cs[2]

	b.closeSend()
	b.closeSend() // idempotent

	// Must not panic; c still gets the announcement.
	tbl.unregisterClient(a)
	got := recvVoice(t, c)
	if got.From != "acc-a" || got.Kind != "leave" {
		t.Fatalf("expected leave from acc-a, got %+v", got)
	}
	if b.trySend([]byte(`{}`)) {
		t.Fatalf("trySend on a closed client must report false")
	}

	// The other cross-client paths share the guard.
	tbl.notifyAccount("acc-b", createError("x"))
	tbl.clearClientUUID("")
	tbl.broadcastToClients([]byte(`{"action":"new-log"}`))
}
