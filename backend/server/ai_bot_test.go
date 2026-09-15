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
	tbl := bettingHandTable(t)
	return tbl.game.GenerateOmniView()
}

func bettingHandTable(t *testing.T) *table {
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
	return tbl
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

// The Deep CFR model is 6-handed: AI rooms may not seat more than six
// players, whatever the service's health. Six (or fewer) is fine. Tested
// against the pure validator because a successful handleCreateTable would
// start the table's run loop, which needs a real Redis client.
func TestCreateTableAILimitedToSixSeats(t *testing.T) {
	srv, _ := newInferenceServer(t)
	withAIEnv(t, srv.URL)

	// 7+ seats are refused even with a healthy service.
	for _, seats := range []uint{7, 8} {
		err := validateBotType(botKindAI, seats)
		if err == nil || err.Error() != msgAIBotsTooManyPlayers {
			t.Fatalf("ai with %d seats should fail with %q, got %v", seats, msgAIBotsTooManyPlayers, err)
		}
	}
	// Six or fewer is accepted with the service up.
	for _, seats := range []uint{2, 6} {
		if err := validateBotType(botKindAI, seats); err != nil {
			t.Fatalf("ai with %d seats should pass, got %v", seats, err)
		}
	}
	// Normal rooms are never bound by the model's seat count.
	for _, seats := range []uint{6, 7, 8} {
		if err := validateBotType(botKindNormal, seats); err != nil {
			t.Fatalf("normal with %d seats should pass, got %v", seats, err)
		}
	}
	// The seat cap does not mask the health gate: at six seats an unhealthy
	// service still refuses, at seven the seat error wins.
	withAIEnv(t, "http://127.0.0.1:1")
	if err := validateBotType(botKindAI, 6); err == nil || err.Error() != msgAIBotsUnavailable {
		t.Fatalf("ai with 6 seats and no service should fail with %q, got %v", msgAIBotsUnavailable, err)
	}
	if err := validateBotType(botKindAI, 7); err == nil || err.Error() != msgAIBotsTooManyPlayers {
		t.Fatalf("ai with 7 seats and no service should fail with %q, got %v", msgAIBotsTooManyPlayers, err)
	}
}

// A normal room's bots never consult the inference server even when it is
// up; an AI room's bots do, and fall back to the heuristic when it is gone.
func TestDecideBotActionGatedByRoomKind(t *testing.T) {
	view := bettingHandView(t)

	// Service up: normal rooms still decide locally.
	srv, acts := newInferenceServer(t)
	withAIEnv(t, srv.URL)
	if act := decideBotAction(botKindNormal, view, view.ActionNum, nil); !legalAction(act) {
		t.Fatalf("normal bot should produce a legal heuristic action, got %+v", act)
	}
	if n := atomic.LoadInt32(acts); n != 0 {
		t.Fatalf("normal bot must not ask the inference server, got %d requests", n)
	}

	// AI rooms ask the service (the fake always folds).
	if act := decideBotAction(botKindAI, view, view.ActionNum, nil); act.kind != "fold" {
		t.Fatalf("ai bot should follow the service (fold), got %+v", act)
	}
	if n := atomic.LoadInt32(acts); n != 1 {
		t.Fatalf("ai bot should have asked the service once, got %d", n)
	}

	// Service gone: the AI room falls back to a legal heuristic action.
	withAIEnv(t, "http://127.0.0.1:1")
	if act := decideBotAction(botKindAI, view, view.ActionNum, nil); !legalAction(act) {
		t.Fatalf("ai bot should fall back to the heuristic, got %+v", act)
	}
}

// Successful actions are retained per player for this hand using the five OM
// action buckets and the exact 25-value training context. A request only sees
// opponents, never the deciding bot's own actions.
func TestAIHandActionHistory(t *testing.T) {
	tbl := bettingHandTable(t)
	tbl.resetAIActionHistory()

	// Heads-up preflop starts on the small blind, who calls the outstanding
	// blind. The first context has no previous-action feature.
	beforeCall := tbl.game.GenerateOmniView()
	caller := beforeCall.ActionNum
	callAmount := beforeCall.Players[beforeCall.BBNum].Bet - beforeCall.Players[caller].Bet
	handleCall(actionClient(t, tbl))

	beforeRaise := tbl.game.GenerateOmniView()
	raiser := beforeRaise.ActionNum
	raiseAmount := uint(aiPot(beforeRaise)) // a pot-sized opening raise
	handleRaise(actionClient(t, tbl), raiseAmount)

	view := tbl.game.GenerateOmniView()
	histories := tbl.aiOpponentHistories(view, view.ActionNum)
	if len(histories) != 1 || histories[0].OpponentID != int(raiser) {
		t.Fatalf("expected only raiser history for player %d, got %+v", view.ActionNum, histories)
	}
	if got := histories[0].Actions[0].ActionID; got != 3 {
		t.Fatalf("pot-sized raise action_id = %d, want 3", got)
	}
	context := histories[0].Actions[0].Context
	if context[0] != 1 {
		t.Fatalf("preflop context flag = %v, want 1", context[0])
	}
	if context[6] != float64(2)/aiModelSeats {
		t.Fatalf("active-player context = %v, want %v", context[6], float64(2)/aiModelSeats)
	}
	if context[11] != 1 { // previous action was a pokers Call (enum 2)
		t.Fatalf("previous-call context flag = %v, want 1", context[11])
	}
	if callAmount == 0 { // guards the test setup: the first action was a call
		t.Fatalf("expected the small blind to have an outstanding call")
	}

	// The deciding player is excluded even though they also acted earlier.
	for _, history := range histories {
		if history.OpponentID == int(view.ActionNum) {
			t.Fatalf("request leaked deciding player's own history: %+v", histories)
		}
	}

	// A hand/session reset cannot leak observations into the next hand.
	tbl.resetAIActionHistory()
	if got := tbl.aiOpponentHistories(view, view.ActionNum); len(got) != 0 {
		t.Fatalf("history survived hand reset: %+v", got)
	}

	// Fold uses the same production handler path and records bucket 0.
	foldTable := bettingHandTable(t)
	foldView := foldTable.game.GenerateOmniView()
	folder := foldView.ActionNum
	handleFold(actionClient(t, foldTable))
	foldHistories := foldTable.aiOpponentHistories(
		foldTable.game.GenerateOmniView(), (folder+1)%uint(len(foldView.Players)),
	)
	if len(foldHistories) != 1 || foldHistories[0].Actions[0].ActionID != 0 {
		t.Fatalf("fold was not recorded as action_id 0: %+v", foldHistories)
	}
}

// aiDecide serializes the per-opponent sequence under opponent_histories so
// an OM-capable inference server can replay it before the forward pass.
func TestAIDecideSendsOpponentHistories(t *testing.T) {
	view := bettingHandView(t)
	context := [aiHistoryContextSize]float64{}
	context[0], context[5], context[24] = 1, 0.25, 1
	want := []aiOpponentHistory{{
		OpponentID: 1,
		Actions: []aiActionHistoryItem{{
			ActionID: 4,
			Context:  context,
		}},
	}}

	received := make(chan aiActionRequest, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req aiActionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Errorf("decode request: %v", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		received <- req
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"kind":"fold","action_type":0,"label":"fold"}`))
	}))
	defer srv.Close()

	if _, err := aiDecide(srv.URL, view, view.ActionNum, want); err != nil {
		t.Fatalf("ai decide: %v", err)
	}
	got := <-received
	if len(got.OpponentHistories) != 1 || got.OpponentHistories[0].OpponentID != 1 {
		t.Fatalf("opponent histories missing from request: %+v", got.OpponentHistories)
	}
	item := got.OpponentHistories[0].Actions[0]
	if item.ActionID != 4 || item.Context != context {
		t.Fatalf("history item = %+v, want action_id=4 context=%v", item, context)
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
