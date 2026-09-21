# Hardening: HTTPS and protection against floods / denial of service

Protection is layered. The Go server handles what an application can see
(slow clients, request and message floods, connection hoarding, login
brute force). SYN floods and volumetric attacks never reach user space, so
they are handled by the kernel, the firewall and, ideally, a CDN in front.

## 1. HTTPS

Two ways, both configured in `.env` (see `.env.example`):

| Mode | Variables | When |
|---|---|---|
| Let's Encrypt (ACME) | `TLS_DOMAINS`, optional `TLS_EMAIL` | Public host with DNS, ports 80 + 443 reachable |
| Own certificate | `TLS_CERT_FILE`, `TLS_KEY_FILE` | Bought cert, certbot on the host, or self-signed on a LAN |

With either mode the server:

- listens for HTTPS on `HTTPS_PORT` (443) with TLS 1.2+ and X25519/P-256 only;
- turns the plain port (8080 in the container, `HTTP_PORT` on the host) into
  an ACME-challenge + `301 → https://` redirect endpoint;
- sends `Strict-Transport-Security` on TLS responses.

The frontend needs no configuration: when the page is served over `https:` it
opens `wss://<same host>/ws`.

Let's Encrypt quick start:

```bash
# .env
TLS_DOMAINS="poker.example.com"
TLS_EMAIL="you@example.com"
HTTP_PORT=80

docker compose up -d --build
```

The certificate is stored in the `certs` docker volume and renewed
automatically. If ACME fails, the container log shows the reason (usually DNS
not pointing at the host or port 80 blocked).

Own certificate:

```bash
docker run --rm -v go-poker_certs:/certs -v "$PWD":/src alpine \
  sh -c 'cp /src/fullchain.pem /src/privkey.pem /certs/ && chown 100 /certs/*'
# .env
TLS_CERT_FILE="/app/certs/fullchain.pem"
TLS_KEY_FILE="/app/certs/privkey.pem"
```

Behind a reverse proxy (nginx, Caddy, Traefik, Cloudflare Tunnel) leave TLS
off in the app and set `TRUST_PROXY=true` so the rate limits see real client
IPs. Make sure the proxy forwards WebSocket upgrades on `/ws`.

## 2. Application-layer protection (built in, on by default)

| Threat | Mitigation | Knob |
|---|---|---|
| Slowloris / idle connections | `ReadHeaderTimeout` 10 s, `ReadTimeout` 30 s, `WriteTimeout` 60 s, `IdleTimeout` 120 s, 16 KiB header cap | fixed |
| HTTP request floods | Per-IP token bucket, `429 Too Many Requests` | `RATE_HTTP_RPS` (30/s, burst 60) |
| WebSocket handshake floods | Per-IP and global connection caps, refused before the upgrade | `MAX_CONNS_PER_IP` (10), `MAX_CONNS` (2000) |
| WebSocket message floods | Per-connection token bucket; the socket is closed with `1008 policy violation` | `RATE_WS_MSGS` (20/s, burst 40) |
| Oversized frames | 1 KiB read limit per message (existing) | fixed |
| Login / register brute force | Per-IP attempts per minute | `RATE_AUTH_PER_MIN` (10) |
| Room spam (memory) | Cap on live rooms; rooms are recycled 2 min after emptying | `MAX_TABLES` (200) |
| Cross-site WebSocket hijacking | Origin allow-list | `ALLOWED_ORIGINS` (empty = any) |
| Avatar upload abuse | 10 MiB body cap (existing) plus the HTTP rate limit | fixed |
| IP spoofing via proxy headers | Headers ignored unless `TRUST_PROXY=true` | `TRUST_PROXY` |

All limits are per process and in memory. Idle per-IP entries are dropped
after 10 minutes so an address-spoofing flood cannot grow the table without
bound.

## 3. Kernel / network-level protection (host configuration)

A SYN flood is absorbed by the kernel long before a socket is accepted. Apply
`deploy/sysctl-hardening.conf` on the docker host:

```bash
sudo cp deploy/sysctl-hardening.conf /etc/sysctl.d/90-go-poker.conf
sudo sysctl --system
```

It enables SYN cookies, enlarges the SYN backlog, shortens SYN-RECV retries,
tightens orphan/FIN timeouts and raises conntrack limits. These are safe
defaults for a small game server; tune upward for bigger hosts.

Firewall rate limiting (nftables example, adjust the interface and ports):

```nft
table inet filter {
  chain input {
    type filter hook input priority 0; policy drop;
    ct state established,related accept
    iif lo accept
    # At most 30 new connections/s per source, burst 60, to the game ports.
    tcp dport { 80, 443 } ct state new \
      meter conn_rate { ip saddr limit rate 30/second burst 60 packets } accept
    tcp dport { 80, 443 } ct state new drop
    tcp dport 22 ct state new limit rate 5/minute accept
  }
}
```

With `ufw`: `ufw limit 443/tcp` and `ufw limit 80/tcp` give a coarse version
of the same.

Docker publishes ports through its own `DOCKER-USER` chain; put host rules
there (or use the nftables snippet above with `iptables-nft`) so they apply
before the port forward.

## 4. Volumetric attacks

Nothing on a single host stops a multi-Gbit flood. For a public deployment
put the server behind a CDN / DDoS-scrubbing service (Cloudflare, AWS Shield,
Aliyun Anti-DDoS, ...). They terminate TLS and proxy WebSockets; then run the
app with TLS off, `TRUST_PROXY=true`, and restrict the origin firewall to the
provider's IP ranges so attackers cannot bypass the CDN.

## 5. Voice chat ports (LiveKit)

In-room voice runs on a self-hosted LiveKit SFU: every browser sends and
receives audio through it instead of peer-to-peer. Enable the bundled service
(`COMPOSE_PROFILES=voice` plus `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` in
`.env`); it runs with `network_mode: host` so no third-party service is
involved. It needs, in addition to 80/443:

| Port | Protocol | Purpose |
|---|---|---|
| 7880 | TCP | WebSocket signalling — this is the `LIVEKIT_URL` browsers connect to |
| 7881 | TCP | ICE/TCP fallback for networks that block UDP |
| `LIVEKIT_UDP_MIN_PORT`–`LIVEKIT_UDP_MAX_PORT` (50000–50100) | UDP | Media (audio) relay |

Only token holders may join: the game server mints short-lived access tokens
from the API key pair (`LIVEKIT_TOKEN_TTL_HOURS`, 6 h default) bound to the
account and the poker room (`gopoker-<tablename>`), restricted to microphone
publish/subscribe — no data channels, no anonymous use. livekit-server refuses
to start without the key pair, and enforces a secret of at least 32
characters.

**TLS is not optional when the game page is https.** Browsers block `ws://`
from a secure page (mixed content), and livekit-server cannot terminate TLS
itself — its config parser rejects a `tls:` block (verified against v1.13.7).
Two ways to get `wss://`:

1. The bundled Caddy proxy: add `voice-tls` to `COMPOSE_PROFILES`, set
   `TLS_CERT_FILE`/`TLS_KEY_FILE` (the app's own certificate is reused; `./certs`
   is mounted into the proxy at the same path), open `LIVEKIT_PROXY_PORT`
   (7443 by default) and set `LIVEKIT_URL=wss://<domain>:7443`.
2. A reverse proxy the host already runs (nginx, Caddy, Cloudflare Tunnel):
   proxy the SFU there with a plain WebSocket passthrough — see the snippet in
   `.env.example`. If your stack is behind such a proxy, do this instead of
   publishing another port.

TLS covers signalling only: the browser still sends audio to the UDP range
above, so those ports must stay open even with `wss://`.

With nftables add:

```nft
    tcp dport 7880 ct state new limit rate 30/second burst 60 packets accept
    tcp dport 7881 accept
    tcp dport 7443 ct state new limit rate 30/second burst 60 packets accept
    udp dport 50000-50100 accept
```

For a cloud VM behind 1:1 NAT keep `LIVEKIT_USE_EXTERNAL_IP=true` (the default
for a hostname `LIVEKIT_URL`; `deploy/livekit-entrypoint.sh` derives it) so ICE
candidates carry the public address.

## 6. Checklist for a public host

1. `.env`: `TLS_DOMAINS` or cert files; `ALLOWED_ORIGINS=https://your.domain`.
2. Strong `REDIS_PASSWORD`; Redis is not published to the host (compose keeps
   it on the internal network only). Strong `LIVEKIT_API_SECRET` if voice is on.
3. `deploy/sysctl-hardening.conf` installed; firewall allows only 80/443 (+22)
   plus, with the `voice` profile, the ports in section 5.
4. Keep the image updated (`./deploy.sh` or `docker compose pull && up -d`).
5. Watch the container log for `too many connections` / `message rate
   exceeded` lines: they show who is being throttled.
