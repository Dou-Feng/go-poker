#!/bin/sh
# Entrypoint for the TLS proxy in front of livekit-server.
#
# It exists to turn a misconfiguration into a readable one-line error: with an
# empty or unreadable certificate, Caddy itself only says
#   "parsing caddyfile tokens for 'tls': wrong argument count ..."
# and then restart-loops, which says nothing about the missing setting.
#
# The proxy needs the same certificate the app serves. TLS_CERT_FILE/
# TLS_KEY_FILE are reused by the compose files, so a deployment that already
# terminates TLS for the game page needs no extra configuration; only an
# autocert deployment (TLS_DOMAINS) has to point LIVEKIT_TLS_CERT_FILE/KEY_FILE
# at the cached /app/certs/<domain>/<domain>.crt|key.
set -eu

fail() {
    echo "livekit-proxy: $1" >&2
    exit 1
}

[ -n "${LIVEKIT_TLS_CERT_FILE:-}" ] && [ -n "${LIVEKIT_TLS_KEY_FILE:-}" ] ||
    fail "no certificate configured. Set TLS_CERT_FILE/TLS_KEY_FILE (the app's own certificate) or LIVEKIT_TLS_CERT_FILE/LIVEKIT_TLS_KEY_FILE in .env — see .env.example."

# ./certs is mounted read-only at the same path the app uses, so the app's
# paths apply verbatim; a wrong path here would otherwise surface only as a
# Caddy parse error.
[ -r "$LIVEKIT_TLS_CERT_FILE" ] ||
    fail "certificate not readable at '$LIVEKIT_TLS_CERT_FILE' (is ./certs mounted and does the file exist?)"
[ -r "$LIVEKIT_TLS_KEY_FILE" ] ||
    fail "private key not readable at '$LIVEKIT_TLS_KEY_FILE' (is ./certs mounted and does the file exist?)"

# A certificate file is expected to carry the intermediate chain, not just the
# leaf: browsers trust a root CA, not the intermediate the site was issued
# from, so serving the leaf alone fails validation on clients that have not
# cached it.
certs=$(grep -c "BEGIN CERTIFICATE" "$LIVEKIT_TLS_CERT_FILE" || true)
if [ "${certs:-0}" -lt 2 ]; then
    echo "livekit-proxy: warning: $LIVEKIT_TLS_CERT_FILE carries a single certificate; clients that have not cached the intermediate may reject it (use the CA's *_bundle.crt / fullchain file)" >&2
fi

echo "livekit-proxy: tls on :${LIVEKIT_PROXY_PORT:-7443} with $LIVEKIT_TLS_CERT_FILE ($certs certs in chain) -> livekit:7880" >&2

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
