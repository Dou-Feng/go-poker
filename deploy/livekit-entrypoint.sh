#!/bin/sh
# Entrypoint for the bundled livekit-server.
#
# It generates the server's config from the environment on every start. Two
# things need logic rather than plain `-e` interpolation:
#
#   1. livekit-server does NOT expand ${VAR} inside its YAML config (verified),
#      so the keys and ports have to be written out here.
#   2. Which address the server advertises in its ICE candidates. The compose
#      service publishes its ports instead of using host networking (host
#      networking is a no-op on Docker Desktop, which silently left port 7880
#      unreachable), so the container's own IP is NOT routable for browsers
#      and must never be advertised. We derive a reaching address from
#      LIVEKIT_URL, i.e. from the very address the browser is told to dial:
#
#        LIVEKIT_URL=ws://localhost:7880     -> advertise 127.0.0.1
#        LIVEKIT_URL=ws://192.168.1.50:7880  -> advertise 192.168.1.50
#        LIVEKIT_URL=wss://voice.example.com -> hostname: ask LiveKit to
#                                               discover the public IP (STUN)
#
#      For the hostname case the reverse proxy must forward both the websocket
#      port and the UDP media range; LIVEKIT_NODE_IP overrides the guess.
set -eu

fail() {
    echo "livekit: $1" >&2
    exit 1
}

[ -n "${LIVEKIT_API_KEY:-}" ] && [ -n "${LIVEKIT_API_SECRET:-}" ] ||
    fail "LIVEKIT_API_KEY/LIVEKIT_API_SECRET are not set in .env (they must match the game server's)"

: "${LIVEKIT_PORT:=7880}"
: "${LIVEKIT_TCP_PORT:=7881}"
: "${LIVEKIT_UDP_MIN_PORT:=50000}"
: "${LIVEKIT_UDP_MAX_PORT:=50100}"

use_external_ip=${LIVEKIT_USE_EXTERNAL_IP:-auto}
node_ip=${LIVEKIT_NODE_IP:-}

if [ -z "$node_ip" ]; then
    host=${LIVEKIT_URL:-}
    host=${host#*://}
    host=${host%%/*}
    host=${host%%:*}
    case "$host" in
    localhost | 127.0.0.1)
        node_ip=127.0.0.1
        [ "$use_external_ip" = auto ] && use_external_ip=false
        ;;
    '' | *[!0-9.]*)
        # No LIVEKIT_URL, or a hostname (a domain behind TLS): let LiveKit
        # discover the public address itself.
        [ "$use_external_ip" = auto ] && use_external_ip=true
        ;;
    *)
        # A literal IP: that is what the browser will dial, so advertise it.
        [ "$use_external_ip" = auto ] && use_external_ip=false
        ;;
    esac
fi
[ "$use_external_ip" = auto ] && use_external_ip=true

config=/tmp/livekit.yaml
# node_ip must sit inside the rtc block (appending it later would silently
# land it under `keys:` and LiveKit would read it as an API key).
{
    printf 'port: %s\n' "$LIVEKIT_PORT"
    printf 'rtc:\n'
    printf '  tcp_port: %s\n' "$LIVEKIT_TCP_PORT"
    printf '  port_range_start: %s\n' "$LIVEKIT_UDP_MIN_PORT"
    printf '  port_range_end: %s\n' "$LIVEKIT_UDP_MAX_PORT"
    printf '  use_external_ip: %s\n' "$use_external_ip"
    # An explicit node_ip is what keeps local play working: browsers reach the
    # published ports on the address they already use for the page.
    if [ -n "$node_ip" ]; then
        printf '  node_ip: %s\n' "$node_ip"
    fi
    printf 'keys:\n  %s: %s\n' "$LIVEKIT_API_KEY" "$LIVEKIT_API_SECRET"
} >"$config"

echo "livekit: signalling $LIVEKIT_URL (port $LIVEKIT_PORT), media udp $LIVEKIT_UDP_MIN_PORT-$LIVEKIT_UDP_MAX_PORT/tcp $LIVEKIT_TCP_PORT, node_ip ${node_ip:-auto}, use_external_ip $use_external_ip" >&2

exec /livekit-server --config "$config"
