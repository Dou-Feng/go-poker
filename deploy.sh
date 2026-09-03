#!/usr/bin/env bash
#
# deploy.sh — One-click deploy script (hot-reload mode, docker-compose-hot.yaml)
#
# Usage:
#   ./deploy.sh            # git pull, then automatically decide whether services need a restart
#   ./deploy.sh --force    # Skip detection: rebuild images and restart all services
#   ./deploy.sh --status   # Show service status only, no pull
#
# Detection logic (diff changed files between pre-pull and post-pull commits):
#   backend/**/*.go             -> No restart needed: air recompiles automatically in the container
#   web/** (except package*.json) -> No restart needed: next dev hot reload (WATCHPACK_POLLING)
#   backend/go.mod|go.sum       -> Restart go-poker (air does not watch .mod/.sum by default)
#   web/package*.json           -> Restart web (npm install only runs at container start)
#   .env                        -> up -d + restart go-poker (read only at startup)
#   docker-compose-hot.yaml
#   or backend/Dockerfile.dev   -> up -d --build (rebuild images / affected containers)
#
# Note: if you manually edited .env on the server (outside git), this script
#       cannot detect it — run ./deploy.sh --force or restart go-poker yourself.
#
set -euo pipefail

COMPOSE_FILE="docker-compose-hot.yaml"
cd "$(dirname "$0")"

dc() { docker compose -f "$COMPOSE_FILE" "$@"; }

# ---------- Colored output ----------
info() { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[deploy]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[deploy]\033[0m %s\n' "$*" >&2; exit 1; }

[[ -f "$COMPOSE_FILE" ]] || die "$COMPOSE_FILE not found; run this script from the repo root"

# ---------- Parse arguments ----------
MODE="deploy"
case "${1:-}" in
    --force)  MODE="force" ;;
    --status) MODE="status" ;;
    "")       MODE="deploy" ;;
    *)        die "Unknown argument: $1 (supported: --force / --status)" ;;
esac

if [[ "$MODE" == "status" ]]; then
    dc ps
    exit 0
fi

# ---------- Working tree must be clean to avoid pull conflicts ----------
if [[ -n "$(git status --porcelain --untracked-files=no -- backend web "$COMPOSE_FILE")" ]]; then
    die "Uncommitted local changes in backend/web/compose; run git stash or git checkout -- <path> first"
fi

OLD_HEAD=$(git rev-parse HEAD)

info "Pulling latest code..."
git pull --ff-only || die "git pull failed (diverged from remote?); resolve manually and retry"

NEW_HEAD=$(git rev-parse HEAD)

# ---------- Force mode ----------
if [[ "$MODE" == "force" ]]; then
    warn "--force: rebuilding images and restarting all services"
    dc up -d --build
    dc ps
    ok "Done"
    exit 0
fi

# ---------- No code changes ----------
if [[ "$OLD_HEAD" == "$NEW_HEAD" ]]; then
    ok "Already up to date; business-code changes never need a restart anyway (air / next dev hot reload)"
    dc up -d   # Idempotent: make sure services are running
    dc ps
    exit 0
fi

CHANGED=$(git diff --name-only "$OLD_HEAD" "$NEW_HEAD")
info "Update $OLD_HEAD -> $NEW_HEAD, changed files:"
printf '    %s\n' $CHANGED

# ---------- Core decision: which changes require a restart ----------
NEED_REBUILD=0     # compose / Dockerfile.dev changed -> up -d --build
NEED_UP=0          # .env changed -> up -d (apply new env vars, recreate affected containers)
RESTART_BACKEND=0  # go.mod / go.sum changed -> restart go-poker
RESTART_WEB=0      # package*.json changed -> restart web (re-runs npm install)

if grep -qE "^(docker-compose-hot\.yaml|backend/Dockerfile\.dev)$" <<<"$CHANGED"; then
    NEED_REBUILD=1
fi
if grep -qE '^\.env$' <<<"$CHANGED"; then
    NEED_UP=1
    RESTART_BACKEND=1   # .env is mounted into the container; main reads it only at startup
fi
if grep -qE '^backend/(go\.mod|go\.sum)$' <<<"$CHANGED"; then
    RESTART_BACKEND=1   # air does not watch go.mod / go.sum by default
fi
if grep -qE '^web/(package\.json|package-lock\.json)$' <<<"$CHANGED"; then
    RESTART_WEB=1       # npm install only runs at container start
fi

# ---------- Act ----------
if [[ "$NEED_REBUILD" == 1 ]]; then
    info "Compose / Dockerfile changed: rebuilding images and restarting affected services"
    dc up -d --build
elif [[ "$NEED_UP" == 1 ]]; then
    info ".env changed: applying new environment variables"
    dc up -d
fi

# up -d --build / up -d may have already recreated the containers; skip restart then
if [[ "$RESTART_BACKEND" == 1 && "$NEED_REBUILD" == 0 && "$NEED_UP" == 0 ]]; then
    info "Go dependencies (go.mod/go.sum) changed: restarting go-poker"
    dc restart go-poker
fi
if [[ "$RESTART_WEB" == 1 && "$NEED_REBUILD" == 0 ]]; then
    info "Frontend dependencies (package*.json) changed: restarting web (re-runs npm install)"
    dc restart web
fi

if [[ "$NEED_REBUILD$NEED_UP$RESTART_BACKEND$RESTART_WEB" == "0000" ]]; then
    ok "Business-code changes only: air / next dev hot reload handles them, no restart needed"
fi

# ---------- Wrap up ----------
dc up -d   # Idempotent: make sure all services are running
sleep 2
ok "Deploy finished, current service status:"
dc ps
info "Recent backend logs:"
dc logs --tail=20 go-poker || true
