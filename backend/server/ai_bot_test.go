package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/evanofslack/go-poker/poker"
)

// Tests for the room-level bot type (bot.go / ai_client.go): "normal" rooms
// always decide with the built-in heuristic — a reachable inference service
// never upgrades them — while "ai" rooms ask the model and may only be
// created while the service answers its /healthz probe.

// withAIEnv points AI_INFERENCE_URL at url for the test's duration and drops
// the cached health verdict on both ends.
func withAIEnv(t *testing.T, url string) {
	t.Helper()
	t.Setenv("AI_INFERENCE_URL", url)
	t.Cleanup(resetAIHealthCache)
	resetAIHealthCache()
}

// newInferenceServer fakes the Deep CFR service: /healthz reports ok and
// /v1/act answers "fold", counting the act requests it served.
func newInferenceServer(t *testing.T) (*httptest.Server, *int32) {
	t.Helper()
	var acts int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
		case "/v1/act":
			atomic.AddInt32(&acts, 1)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"kind":"fold","action_type":0,"label":"fold"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, &acts
}

// bettingHandView deals a two-player hand and returns the omni view with
// betting in progress (the decision tests only need a live betting view).
func bettingHandView(t *testing.T) *poker.GameView {
	t.Helper()
	tbl, _ := botTable(t)
	seat(t, tbl, "acc-a", 1, true)
	seat(t, tbl, "acc-b", 2, true)
	if err := tbl.game.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	view := tbl.game.GenerateOmniView()
	if !view.Running || !view.Betting {
		t.Fatalf("expected a running betting view")
	}
	return view
}

// legalAction reports whether act is something the engine could accept.
func legalAction(act botAction) bool {
	switch act.kind {
	case "fold", "check", "call":
		return true
	case "raise":
		return act.amount > 0
	}
	return false
}

// The health gate is false without AI_INFERENCE_URL and true while /healthz
// answers; the verdict is cached so repeated calls do not re-probe.
func TestAIServiceAvailableProbesHealthz(t *testing.T) {
	if aiServiceAvailable() {
		t.Fatalf("unconfigured service must be unavailable")
	}

	srv, _ := newInferenceServer(t)
	withAIEnv(t, srv.URL)
	if !aiServiceAvailable() {
		t.Fatalf("healthy service must be available")
	}
	// Cached: swapping the probe for a failing one inside the TTL keeps the
	// last verdict without a new request.
	aiHealthMu.Lock()
	prev := aiHealthProbe
	aiHealthProbe = func(string) bool { return false }
	aiHealthMu.Unlock()
	if !aiServiceAvailable() {
		t.Fatalf("verdict should be cached within the TTL")
	}
	resetAIHealthCache()
	aiHealthMu.Lock()
	aiHealthProbe = prev
	aiHealthMu.Unlock()
}

// handleCreateTable rejects the "ai" bot type while the service is down and
// unknown types outright — before any room is created.
func TestCreateTableValidatesBotType(t *testing.T) {
	hub := newSessionHub()
	create := func(kind string) result {
		t.Helper()
		c := newTestClient(hub, "acc-host")
		handleCreateTable(c, "room-"+kind, "", 0, 0, 0, 0, 0, 0, false, 0, kind)
		var res result
		if err := json.Unmarshal(<-c.send, &res); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		return res
	}

	// No service configured → "ai" is refused and no room is left behind.
	if res := create(botKindAI); res.Ok || res.Message != msgAIBotsUnavailable {
		t.Fatalf("ai without service should fail with %q, got ok=%v %q", msgAIBotsUnavailable, res.Ok, res.Message)
	}
	if len(hub.tables) != 0 {
		t.Fatalf("failed creation must not leave a room behind")
	}

	// Unknown types are refused too (case matters).
	for _, kind := range []string{"turbo", "AI"} {
		if res := create(kind); res.Ok || res.Message != "unknown bot type" {
			t.Fatalf("botType %q should be rejected, got ok=%v %q", kind, res.Ok, res.Message)
		}
	}
}

// A normal room's bots never consult the inference server even when it is
// up; an AI room's bots do, and fall back to the heuristic when it is gone.
func TestDecideBotActionGatedByRoomKind(t *testing.T) {
	view := bettingHandView(t)

	// Service up: normal rooms still decide locally.
	srv, acts := newInferenceServer(t)
	withAIEnv(t, srv.URL)
	if act := decideBotAction(botKindNormal, view, view.ActionNum); !legalAction(act) {
		t.Fatalf("normal bot should produce a legal heuristic action, got %+v", act)
	}
	if n := atomic.LoadInt32(acts); n != 0 {
		t.Fatalf("normal bot must not ask the inference server, got %d requests", n)
	}

	// AI rooms ask the service (the fake always folds).
	if act := decideBotAction(botKindAI, view, view.ActionNum); act.kind != "fold" {
		t.Fatalf("ai bot should follow the service (fold), got %+v", act)
	}
	if n := atomic.LoadInt32(acts); n != 1 {
		t.Fatalf("ai bot should have asked the service once, got %d", n)
	}

	// Service gone: the AI room falls back to a legal heuristic action.
	withAIEnv(t, "http://127.0.0.1:1")
	if act := decideBotAction(botKindAI, view, view.ActionNum); !legalAction(act) {
		t.Fatalf("ai bot should fall back to the heuristic, got %+v", act)
	}
}

// AI rooms seat "AI …" bots with the brain avatar, keyed by their own
// account namespace, and announce their kind in the room payloads.
func TestAIBotRoomNamingAndPayloads(t *testing.T) {
	tbl, _ := botTable(t)
	tbl.botKind = botKindAI

	hub := newSessionHub(tbl)
	human := newTestClient(hub, "acc-h")
	human.table = tbl
	tbl.registerClient(human)
	human.uuid = seat(t, tbl, "acc-h", 2, false)

	bot, err := tbl.addBot(0)
	if err != nil {
		t.Fatalf("add bot: %v", err)
	}
	if bot.username != "AI Ace" || bot.accountUUID != "bot-ai-ace" || !isBotAccount(bot.accountUUID) {
		t.Fatalf("unexpected ai bot identity: %q %q", bot.username, bot.accountUUID)
	}
	view := tbl.game.GenerateOmniView()
	pos, ok := findPlayer(view, bot.uuid)
	if !ok {
		t.Fatalf("ai bot must be seated")
	}
	if p := view.Players[pos]; p.Avatar != aiBotAvatar || p.Username != "AI Ace" {
		t.Fatalf("unexpected ai bot seat: avatar=%q username=%q", p.Avatar, p.Username)
	}

	// The room payloads carry the kind so clients can label the bots.
	if info := tbl.info(); info.BotType != botKindAI {
		t.Fatalf("table info should carry botType %q, got %q", botKindAI, info.BotType)
	}
	var payload updateGame
	if err := json.Unmarshal(createUpdatedGameBytes(tbl), &payload); err != nil {
		t.Fatalf("unmarshal update game: %v", err)
	}
	if payload.BotType != botKindAI {
		t.Fatalf("update-game should carry botType %q, got %q", botKindAI, payload.BotType)
	}
}

// Normal rooms keep the robot identity ("Bot Ace", 🤖) and default kind.
func TestNormalBotRoomUnchanged(t *testing.T) {
	tbl, _ := botTable(t)
	if tbl.botKind != botKindNormal {
		t.Fatalf("new tables default to normal bots, got %q", tbl.botKind)
	}
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
	pos, _ := findPlayer(view, bot.uuid)
	if p := view.Players[pos]; p.Avatar != botAvatar || p.Username != "Bot Ace" || p.AccountUUID != "bot-ace" {
		t.Fatalf("normal bot identity changed: %+v", p)
	}
	if info := tbl.info(); info.BotType != botKindNormal {
		t.Fatalf("normal room info botType = %q", info.BotType)
	}
}
