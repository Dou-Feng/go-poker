# go-poker

Real-time multiplayer poker powered by Go, Next.js, WebSockets, and Redis pub/sub.

## Demo

https://poker.evanslack.dev

## UI

<img width="800" alt="gopoker-screenshot" src="https://github.com/evanofslack/go-poker/assets/51209817/08c93fd3-0814-40e8-ab10-74d613ad996a">

## Getting started

Copy `.env.example` to `.env`, keep `REDIS_PASSWORD` and the password inside
`REDIS_URL` in sync, then start the prebuilt image:

```bash
cp .env.example .env
docker compose up -d
```

The application is available at `http://localhost:8080` by default. The
compose file uses `evanofslack/go-poker:latest` and starts the required Redis
service.

An equivalent minimal compose configuration is:

```yaml
services:
  go-poker:
    image: evanofslack/go-poker:latest
    container_name: go-poker
    restart: unless-stopped
    ports:
      - 8080:8080
    environment:
      REDIS_URL: ${REDIS_URL}
    depends_on:
      - redis

  redis:
    container_name: go-poker-redis
    image: redis:latest
    restart: unless-stopped
    entrypoint: redis-server --appendonly yes
    environment:
      REDIS_PASSWORD: ${REDIS_PASSWORD}
    volumes:
      - redis:/data
      - /etc/timezone:/etc/timezone:ro
      - /etc/localtime:/etc/localtime:ro

volumes:
  redis:
```

## Development

Build the complete application from local code:

```bash
docker compose -f docker-compose-dev.yaml up --build
```

For hot reload, use:

```bash
make hot
```

For native development, start Redis, the Go server, and Next.js in separate
terminals. Set `REDIS_URL` to an address reachable from the host rather than
the Docker-only hostname `redis`.

```bash
make redis
make go
make next
```

Run the backend and frontend checks with `make test`.
