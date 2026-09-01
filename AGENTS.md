# Project Guidelines

Real-time multiplayer poker: Go backend (`backend/`) + Next.js frontend (`web/`), connected over WebSockets with Redis pub/sub for fan-out. See [README.md](README.md) for setup and Docker deployment.

## Architecture

Two independent apps; the Go server serves the built Next.js static export.

- **`backend/poker/`** — pure game-logic library. No network/persistence deps (only a card-eval lib and `uuid`). Contains the mutable `Game` state machine, player model, betting actions, and JSON view generation.
- **`backend/server/`** — transport layer: `chi` HTTP router, `gorilla/websocket` at `/ws`, Redis pub/sub, and wire-message marshalling. Imports `poker`; `poker` never imports `server`. Redis is also used as a key/value store for user accounts (`store.go`: `gopoker:user:<name>` holds chips + lifetime stats).
- **`backend/cmd/go-poker/main.go`** — thin bootstrap: loads `.env`, constructs and runs the server.
- **`web/`** — Next.js (pages router) client. State lives in `providers/AppStore.tsx` (React Context + `useReducer`); `providers/WebSocket.tsx` owns the single socket connection.
- **Client flow** is a three-screen state machine in `pages/index.tsx`: `Register` (unique username) → `Lobby` (list/join/create rooms) → `Game`. Session/user data is persisted in `web/lib/session.ts` (`gopoker-user`, `gopoker-session`) so a reload reconnects to the prior room; `Register.tsx` and `Lobby.tsx` are the new screens.

## Build and Test

```bash
make go        # cd backend && go run .          (requires REDIS_URL / Redis running)
make redis     # docker compose up -d redis
make next      # cd web && npm run dev
make start     # run backend and frontend together
```

- Go tests: `cd backend && go test ./...` — only the `poker` package has tests (white-box, same package).
- Frontend type-check: `cd web && npm run type-check`; format with Prettier.
- Note: `go.mod` declares `go 1.24` but `backend/Dockerfile` uses `golang:1.18.2-alpine` — don't rely on the Docker image matching local builds.

## Conventions

### Backend (`poker`)
- Game state is **mutated in place** under the embedded `sync.Mutex` `g.mtx`. Exported `Action`s lock, then call an unexported lowercase twin that assumes the lock is held (e.g. `Bet` → `bet`).
- Each `player` carries a session-scoped `Stats` (`player.go`) updated in `actions.go`/`game.go` (hands played/won, folds, calls, raises, 3-bets, VPIP, max pot won); the server merges it into the user's lifetime record on leave.
- All actions share one signature: `type Action func(g *Game, pn uint, data uint) error`. Add new actions in `actions.go` following this shape.
- The outside world receives **immutable deep-copy snapshots** via `GenerateOmniView()` / `GeneratePlayerView(pn)` — never hand out internal state directly.
- Sentinel errors via `errors.New` vars in `errors.go` (`ErrIllegalAction`, `ErrOutOfBounds`, `ErrInvalidPosition`, `ErrStartGame`).
- Avoid adding new dot imports of `github.com/alexclewontin/riverboat/eval` (existing files use `. "..."`; prefer `eval.Card` as in `views.go`).
- Tests: `views_test.go` is table-driven with `reflect.DeepEqual`; `actions_test.go` is a long series of `t.Run("Scenario N")` subtests.

### Frontend (`web`)
- TypeScript `strict: true`; functional components with default exports; prop types named `XProps` (e.g. `tableProps`, `seatProps`).
- Components read global state via `useContext(AppContext)` and mutate it only through `dispatch`; local UI state is `useState`.
- Styling: Tailwind CSS + the `classnames` helper; `@mantine/core` is used only for the `Slider` in `RaiseInput`.
- Client/server wire protocol: JSON messages discriminated by an `action` field (client `actions/actions.ts`; server `messages.go`). Types in `web/interfaces/index.ts` mirror the `poker` view structs 1:1 — keep them in sync when changing backend JSON tags.

## Pitfalls

- **Broadcasts round-trip through Redis.** `table.run` publishes to a Redis channel and the same process re-subscribes before pushing to clients. Redis is therefore required even for local single-server runs; the server fails hard if `REDIS_URL` is unreachable.
- **`GenerateOmniView()` leaks every hole card.** The server currently broadcasts it to all clients (`createUpdatedGame`); use `GeneratePlayerView(pn)` for per-player censored views if you touch this.
- **Locking is inconsistent:** `AddPlayer()`, `Start()`, and `Reset()` mutate shared state without taking `g.mtx`, unlike other exported actions. Take the lock if you modify these.
- **`SetSeatID` panics** on `data == 0` instead of returning an error.
- **Known client/server mismatch:** client `Config` expects `maxBuyIn`, but backend `GameConfig` emits `json:"maxBuy"` — the buy-in input always falls back to its `2000` default.
- **Client uses the native `WebSocket` API**, not socket.io (the `socket.io*` deps are unused). The connection lives in `providers/WebSocket.tsx`, where `onmessage` is assigned in the render body and cleanup closes a stale `null` closure — dev mode opens duplicate connections under React StrictMode.
- **Reducer throws on unknown actions** (`AppStore.tsx` default case) — the client crashes on an unrecognized server event.
- **The game screen is a fixed-size desktop layout** (`Game.tsx` overlays + fixed `w-56`/`w-96`/`w-64` widths). On mobile the action bar (`Input`/`RaiseInput`), seats, and chat panel overflow off-screen; keep new UI responsive with `sm:`-prefixed Tailwind classes and keep primary buttons inside a full-width bottom bar.
- Dead/unused code to be aware of: `web/components/TableOld.tsx`, `web/hooks/useEffectCallback.ts`, and `Hub.broadcast` in `backend/server/hub.go`.

## Docs

- [backend/poker/README.md](backend/poker/README.md) — licensing note: this package is a fork of the Riverboat library.
- [README.md](README.md) — setup, Docker Compose, and demo link.
