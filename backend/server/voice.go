package server

import (
	"encoding/json"
	"errors"
	"log/slog"
)

// Voice chat is peer-to-peer WebRTC between the browsers in one room; the
// server only relays the signalling. It has no notion of who is "in voice":
// clients announce themselves with kind "join"/"leave"/"state" and negotiate
// directly with "offer"/"answer"/"ice". Everything travels as voice-signal
// messages addressed by account UUID, delivered straight to the target
// connection (no Redis round trip: the hub runs in one process and signalling
// is latency-sensitive).

// voiceKinds lists the accepted signal kinds; anything else is dropped so a
// client cannot use the relay as a generic message channel.
var voiceKinds = map[string]bool{
	"join":   true, // sender turned voice on; payload {mic: bool}
	"leave":  true, // sender turned voice off (or left the room)
	"state":  true, // sender's mic toggled; payload {mic: bool}
	"offer":  true, // SDP offer (unicast)
	"answer": true, // SDP answer (unicast)
	"ice":    true, // batch of ICE candidates (unicast)
}

var (
	errVoiceNotInRoom = errors.New("voice signal outside a room")
	errVoiceNoAccount = errors.New("voice signal without an account")
	errVoiceBadKind   = errors.New("voice signal of unknown kind")
	errVoiceSelf      = errors.New("voice signal addressed to self")
)

// handleVoiceSignal validates one inbound signal and relays it inside the
// sender's room. The sender must be logged in (peers are keyed by account
// UUID) and attached to a table; join/leave/state may be broadcast (empty To),
// SDP and ICE must name a target.
func handleVoiceSignal(c *Client, sig voiceSignal) error {
	if c.table == nil {
		return errVoiceNotInRoom
	}
	if c.accountUUID == "" {
		return errVoiceNoAccount
	}
	if !voiceKinds[sig.Kind] {
		return errVoiceBadKind
	}
	if sig.To == c.accountUUID {
		return errVoiceSelf
	}
	if sig.To == "" && (sig.Kind == "offer" || sig.Kind == "answer" || sig.Kind == "ice") {
		return errVoiceBadKind
	}
	c.table.relayVoice(c, sig)
	return nil
}

// relayVoice stamps the signal with the sender's account UUID and delivers it
// to the addressed account, or to every other logged-in client in the room
// when To is empty. The sender never receives its own signal.
func (t *table) relayVoice(from *Client, sig voiceSignal) {
	sig.Action = actionVoiceSignal
	sig.From = from.accountUUID
	out, err := json.Marshal(sig)
	if err != nil {
		slog.Default().Warn("Marshal voice signal", "error", err)
		return
	}

	t.clientsMu.Lock()
	defer t.clientsMu.Unlock()
	for client := range t.clients {
		if client == from || client.accountUUID == "" || client.accountUUID == from.accountUUID {
			continue
		}
		if sig.To != "" && client.accountUUID != sig.To {
			continue
		}
		select {
		case client.send <- out:
		default:
			// A client whose outbound queue is full is not going to keep up
			// with real-time signalling anyway; dropping is safer than
			// blocking the caller (the reader goroutine of another client).
			slog.Default().Warn("Drop voice signal, client queue full", "account", client.accountUUID)
		}
	}
}

// announceVoiceLeave tells the rest of the room that a client is gone so
// their browsers tear down the peer connection instead of waiting for ICE to
// time out. It is issued when a client detaches from the table for any
// reason (leave button, socket drop, session takeover); a client that is
// still in voice re-announces itself when it reconnects.
func (t *table) announceVoiceLeave(c *Client) {
	if c.accountUUID == "" {
		return
	}
	t.relayVoice(c, voiceSignal{Kind: "leave"})
}
