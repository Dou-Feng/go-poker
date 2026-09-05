# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Real-time multiplayer Texas Hold'em: Go backend (`backend/`) + Next.js static-export frontend (`web/`), talking over a single WebSocket, with Redis for pub/sub fan-out and as the only persistent store. `AGENTS.md` holds the detailed coding conventions and known pitfalls for both halves — read it before editing; this file covers commands and the cross-file architecture it doesn't.

## Commands

Backend (Go 1.24, module `github.com/evanofslack/go-poker`, run from `backend/`):

```bash
go run ./cmd/go-poker            # needs REDIS_URL; godotenv reads .env from the *working directory*, so export it or copy the root .env into backend/
go test ./...                    # poker: engine tests; server: table eviction/reconnect tests (no Redis needed)
# End-to-end socket scenarios (server/e2e_test.go) need a throwaway Redis and are skipped without REDIS_URL:
../.tools/redis/bin/redis-server --port 6390 --save "" --appendonly no --daemonize yes && REDIS_URL=redis://127.0.0.1:6390 go test ./server -run TestE2E -v
go test ./poker -run 'TestAllInCallForLessThanFullAmount' -v   # single test
go test ./server -run 'TestOfflineTimeout' -v                  # offline-eviction suite
go vet ./...
```

Frontend (run from `web/`):

```bash
npm run dev          # next dev; expects backend WS at ws://<host>:8080/ws unless NEXT_PUBLIC_WS_URL is set
npm run type-check   # tsc --noEmit equivalent (strict); there is no lint or test script
npm run build        # static export to web/out (served by the Go binary in production)
npx prettier --write .   # formatting (prettier + prettier-plugin-tailwindcss in devDependencies, no config file)
```

Docker / deploy (from repo root; copy `.env.example` to `.env` first):

```bash
make redis     # docker compose up -d redis   (Redis is mandatory even for local runs)
make next      # cd web && npm run dev (next dev on :3000, expects backend on :8080)
make hot       # docker-compose-hot.yaml: air-reloaded backend on :3000, next dev on :8080, redis
make deploy    # ./deploy.sh — git pull --ff-only then restart only what the diff requires (hot mode)
docker compose up --build   # production image: root Dockerfile builds web/out + Go binary into one container on :8080
```

`make go` and `make start` are broken: they run `go run .` inside `backend/`, which has no main package. Use `go run ./cmd/go-poker` from `backend/` instead.

Port gotcha: in hot mode the ports are swapped relative to `make start` (backend :3000, web :8080), so `NEXT_PUBLIC_WS_URL` and `NEXT_PUBLIC_API_BASE` are set explicitly in `docker-compose-hot.yaml`. `backend/Dockerfile` (Go 1.18) is legacy; the root `Dockerfile` (Go 1.24.3) is what CI publishes to Docker Hub on pushes to `main`.

## Architecture

### Three layers, one direction of imports

`poker` (pure game engine) ← `server` (transport + persistence) ← `cmd/go-poker` (bootstrap). `poker` has no network or Redis dependencies and never imports `server`.

### Game engine: two explicit state machines (`backend/poker`)

- **Table stage** (`GameStage` in `game.go`): `NotReady → PreFlop → Flop → Turn → River → Showdown`, plus a `Terminal` constant that is declared but not yet set anywhere. Stage and a `Betting` bit are packed into `g.flags`. `Running` in views means "PreFlop..Showdown".
- **Player state** (`PlayerState` in `player.go`): `NotReady, Ready, Playing, AllIn, Spectating, Offline`. `Ready`/`In` booleans are derived fast-path flags kept in sync by `setState`; the server still branches on `Ready`/`In`/`Left`.
- **Hand resolution happens inside `updateRoundInfo`** (called after every bet/fold): it rebuilds side pots, awards chips, stamps `BestHand` names, then parks the table in `Showdown`. Nothing resets automatically. The table leaves `Showdown` only when a client sends `deal-game`, which the server maps to `SettleShowdown` → `resetForNextHand`.
- **All-in runout is client-paced**: when everyone left is all-in, `Betting` goes false and the board stays incomplete; each `deal-game` calls `RunoutNext` (flop as three cards, then turn, then river), and the final one resolves.
- Actions share the signature `func(g *Game, pn uint, data uint) error`; exported wrappers lock `g.mtx` and call a lowercase twin. `RemovePlayer`/`dropPlayer` re-index `Position` and every pot's player-number lists, so never cache positions across a removal.
- `repro_test.go` is the regression suite for betting edge cases (short-stack all-in calls, leave-while-all-in, etc.). Add a scenario there when fixing an engine bug.

### Server: hub → table → client (`backend/server`)

- `Hub` owns the Redis client, the set of live `table`s, and an in-memory reservation of account UUIDs registered since boot.
- **Bots** (`server/bot.go`) are `Client`s with `isBot` and no socket (send queue drained), account `bot-…`, avatar 🤖. They act through the normal handlers (`handleCall`/`handleRaise`/`handleDealGame`…) from a single per-table timer armed at the end of every `broadcastGame` (`scheduleBots` → `botTick`), which mirrors the browser's pacing: act on the bot's turn, drive runout/showdown deals when the first seat is a bot, and between hands rebuy/re-seat/ready. Rules that keep them harmless: `flushSession` skips bot accounts, `voteSettle` counts humans only, table emptiness counts humans only (`humanCount`), bots never ready without a seated human. Only the room **host** (`table.host`, the creator; passed on by `reassignHostIfGoneLocked` when they leave; sent as `host` in `update-game`) may `add-bot`/`remove-bot`. `poker.HandStrength` evaluates a partial board for the bot's decisions.
- **Never write to another client's `send` channel directly.** The hub closes it when the socket goes away while the table may still hold the client; use `Client.trySend` (non-blocking, no-op once closed) and `Client.closeSend` (idempotent). A client's own handlers may still `c.send <-` for replies to itself.
- Each `table` runs its own goroutine (`table.run`) with register/unregister/broadcast channels. **Every broadcast is published to a Redis channel named after the table and re-consumed by the same process** before being fanned out to clients, which is why Redis is required locally.
- `Client.processEvents` (`client.go`) is the single dispatch switch over the `action` field; handlers live in `events.go`, request/response struct shapes in `messages.go`. Add a new message by touching all three plus `web/actions/actions.ts` and `web/providers/WebSocket.tsx`.
- **Client-driven advancement**: the server never uses timers to advance a hand. The frontend (`web/components/Table.tsx`) elects one "runout driver" (first non-left player) whose browser sends `deal-game` after the showdown/runout animation delays. If that client is gone, the table stalls until another `deal-game` arrives.
- Table lifecycle: a table is destroyed 2 min after its last client disconnects (`emptyTableTTL`); a disconnected player is evicted after 60 s (`offlineTimeout`) via `timeoutPlayer` → `table.evictPlayer`, the same path the leave button uses (fold on turn, seat released at hand end, stack back to wallet). `table.flush` and `table.offlineAfter` are injection points for tests (`server/table_test.go`). Reconnects within that window restore the seat by per-session player UUID (`join-table` with `playerUUID`). A `join-table` flagged `reconnect: true` (what the browser replays from localStorage) never creates a room; if the room or seat is gone the server answers `session-expired` and the client clears its session and returns to the lobby.
- Session accounting: `flushPlayerSession` (`store.go`) is the one place chips return to the wallet, lifetime stats are merged, and a history entry is appended. It is called on leave, spectate, offline timeout, bust, and settlement. Settlement (hand limit or majority `vote-settle`) emits a `settlement` message then `Reset()`s the game. The engine's `TotalBuyIn`/`MaxBuy` are per seat entry; `table.ledger` (`scoreboard.go`) totals an account's buy-ins across the whole room session, so every seating/rebuy path must call `canBuyIn` first and `ledger.add` after `poker.BuyIn` succeeds (`sub` on undo), and `resetSession()` must accompany every `game.Reset()`. Scoreboard rows come from `settlementRows`, which merges a departed snapshot and a live seat of the same account.
- **Two UUIDs per client**: `accountUUID` (persistent login identity, chosen by the user at registration, ≥5 alphanumerics) vs `uuid` (per-seat/session id regenerated on each seat). Frontend `appState.clientID` is the latter.
- **Voice chat is peer-to-peer WebRTC; the server only relays signalling** (`server/voice.go`). `voice-signal` messages are addressed by `accountUUID` (spectators have no seat uuid), stamped with `from` server-side, and delivered straight to the target connections' send channels — never through Redis. `table.unregisterClient` broadcasts a synthetic `leave` so peers tear down at once. `maxMessageSize` is 16 KiB to fit SDP. The client side (`web/lib/voice.ts`) is a singleton: mic/speaker toggles, perfect-negotiation mesh, ICE batching (150 ms, to stay under `RATE_WS_MSGS`), per-peer local mute; `Game.tsx` binds it to the room, `WebSocket.tsx` feeds it the socket and inbound signals. STUN/TURN is the bundled `coturn` compose service, **opt-in** via the `voice` profile (`COMPOSE_PROFILES=voice` + `TURN_SECRET` in `.env`; present in all three compose files, host networking, `--use-auth-secret`): `server/turn.go` answers `get-ice-servers` with its URLs on `TURN_HOST` (default: the page host) and a per-account HMAC credential minted from `TURN_SECRET` (24 h), logged-in clients only. With neither `TURN_HOST` nor `TURN_SECRET` set the reply is an empty list and browsers use host candidates only (LAN play). The client asks on room entry and refreshes near expiry. No third-party STUN/TURN is used.
- **One live connection per account** (`server/session.go`): the three auth handlers end in `hub.bindSession`, which records the connection in `Hub.sessions`, kicks the previous one (takeover notice + 1008 close frame travel together in one `kickRequest` so the notice provably precedes the close — the browser auto-reconnects 1 s later and must see the notice first or it would kick the new holder back), and transfers the account's seat immediately (`reconnectPlayer`): the old connection's seat mid-hand included, or the orphaned seat of a holder offline <60 s. A kicked client sets `kicked`, which makes `processEvents` no-op and `detachTable` skip `markPlayerOffline`; `timeoutPlayer` re-checks `seatHasClient` before evicting, so a stale timer can never evict a transferred seat. The frontend marks per-tab auth in sessionStorage (`gopoker-tab`) and only the tab that logged in replays `reconnect-user`; `update-player-uuid` carries an optional `tablename` so a takeover client lands in the room and persists its session.

### Redis key layout

| Key | Type | Contents |
|---|---|---|
| `gopoker:user:<accountUUID>` | string (JSON `UserRecord`) | bcrypt hash, chips, avatar, friends, lifetime `PlayerStats` |
| `gopoker:username:<name>` | set of accountUUIDs | username alias index; login by username fails if the set has >1 member |
| `gopoker:history:<accountUUID>` | list (JSON `HistoryRecord`), trimmed to 50 | one entry per finished session with ≥1 hand played; `sessionId` links to the shared record below |
| `gopoker:session:<sessionID>` | string (JSON `SessionRecord`), 60-day TTL | whole-room scoreboard of one session (every participant's buy-in, net, stats); rewritten by `table.persistSession` on each leave/bust/spectate and at settlement (`Settled: true`); read via `get-session`, participants only |
| `gopoker:avatar:<accountUUID>` | string (JSON) | base64 JPEGs at 1024/512/256/128/64 px |
| `<tablename>` | pub/sub channel | broadcast fan-out |

The only HTTP API besides `/ws` and `/ping` is `/api/avatar` (POST multipart upload ≤10 MB, GET `?uuid=&size=`), in `avatar.go`. Everything else goes over the socket.

### Frontend (`web/`, Next.js 13 pages router, `output: 'export'`)

- `pages/index.tsx` is a three-screen switch on `appState`: no username → `Register`, no table → `Lobby`, else `Game`. `Profile` and `Toast` overlay all three.
- `providers/AppStore.tsx` is the single reducer store; `providers/WebSocket.tsx` owns the one socket, reconnects after a fixed 1 s delay, heartbeats with `ping`/`pong`, and translates every server event into a dispatch. Its `default:` case throws, so an unhandled server action crashes the client.
- `lib/session.ts` persists `gopoker-user` (account UUID) and `gopoker-session` (table + per-seat clientID) in localStorage; `index.tsx` replays `reconnect` and `join-table` from them on every socket (re)connect.
- `interfaces/index.ts` mirrors the `poker` view structs 1:1 by JSON tag. Changing a Go json tag means changing it there and in the `update-game` mapping in `WebSocket.tsx`.
- `lib/api.ts` exposes `API_BASE` for the avatar HTTP endpoints; empty in production (same origin), set in hot mode.
- `lib/sfx.ts` plays CC0 WAVs from `public/sfx`; `lib/language.ts` + `hooks/useTranslation.ts` provide zh/en strings and must stay synchronous for SSR hydration.
- Styling: the brand surface ladder (`brand/lobby/floor/table/tablehi/card/cardhi` + text `ink`/`muted`) is defined in `tailwind.config.js` — never hand-roll gray/blue surfaces. Buttons compose `btn` + one variant (`btn-primary|confirm|accent|secondary|ghost|danger|text|icon`) and text uses the semantic roles (`type-display|heading|label|caption|num`; body text is just `text-ink`/`text-muted`), both from `@layer components` in `styles/index.css` — card faces and seat markers stay raw utilities. The login doodle wallpaper (`.login-wallpaper`) and the in-app doodle wallpaper (`.room-wallpaper`, lobby + game room) with their WebP derivatives live in `public/bg-*.webp` with sources + regeneration commands in `web/assets-src/README.md`. The poker-table surfaces are UE-style materials (`.felt-material`/`.rail-material`): fixed-density tiling textures — the oval felt/rail geometry stays CSS shape (`rounded-full` + padding) and the texture never stretches.

### HTTPS and abuse protection (`backend/server/tls.go`, `guard.go`)

- TLS is env-driven: `TLS_DOMAINS` (Let's Encrypt via `autocert`, cache in `TLS_CACHE_DIR`) or `TLS_CERT_FILE`+`TLS_KEY_FILE`. When on, the app moves to `HTTPS_PORT` (443) and the plain `PORT` listener only serves ACME challenges and 301s to https. Unset = plain HTTP as before. The frontend derives `wss://<page host>/ws` on https pages, `ws://<host>:8080/ws` otherwise.
- `Hub.guard` holds per-IP HTTP rate limiting (429), per-IP/global WebSocket connection caps (refused pre-upgrade), a per-connection message bucket (socket closed with 1008 on flood), a login/register attempt limiter, the room cap (`MAX_TABLES`, `createTableIfAbsent` returns `errTooManyTables`) and the Origin allow-list. Knobs and defaults are listed in `.env.example`; a nil guard (tests that build `Hub{}` literals) disables everything. Kernel-level SYN-flood settings live in `deploy/sysctl-hardening.conf`, explained in `deploy/HARDENING.md`.

## Working notes

- `change.md` is the product owner's feature checklist (Chinese) and the source of truth for intended behaviour; its 「状态」 sections define the two state machines above. Check it before changing game flow.
- Hole cards are censored per recipient: `GameView.CensorFor(pn)` (views.go) keeps only the viewer's own cards, `Revealed` players, and — at stage `Showdown` — players eligible for a contested pot (mirroring `getRevealedPlayers` in `web/components/Table.tsx`). The omni view travels only on the internal Redis channel; `table.broadcastToClients` censors each client's copy at the last hop, and `createUpdatedGame` censors unicast sends. Any new message type that carries a `GameView` must go through the same censoring.
- `Game.AddPlayer`, `Game.Start`, and `Game.Reset` mutate state without taking `g.mtx`; other exported entry points do lock.
- The server deducts buy-ins from the wallet in `events.go` before calling `poker.BuyIn`; if you add a new seating path (see `seatQueuedClient` in `table.go` for the pattern), keep wallet debit, `SetAccountUUID`, `SetUsername`, `SetAvatar`, `BuyIn`, `SetSeatID` in that order because `SetSeatID` re-sorts players and invalidates `position`.
