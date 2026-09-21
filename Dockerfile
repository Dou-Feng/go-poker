FROM node:18-alpine AS frontend-builder
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
# Registry for the install. Left empty, npm talks to registry.npmjs.org, which
# is slow from some networks (measured 67s vs 9s for this lock, i.e. the cost
# is the registry, not the packages). Override it in .env or with
# --build-arg NPM_REGISTRY=https://registry.npmmirror.com — the same reason
# GOPROXY is pinned for the Go stage below.
ARG NPM_REGISTRY=
# The npm store lives in a cache mount, so editing package.json (which busts
# the COPY layer above and therefore this RUN) re-installs from the local
# store instead of re-downloading all ~510 packages. Integrity hashes from the
# lock file still decide what is trustworthy.
RUN --mount=type=cache,target=/root/.npm \
    if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi && \
    npm ci --prefer-offline --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM golang:1.26-alpine AS backend-builder
WORKDIR /build
COPY backend/ ./
ENV GOPROXY=https://goproxy.cn,https://proxy.golang.org,direct
# The image already carries the toolchain go.mod asks for; never download one.
ENV GOTOOLCHAIN=local
RUN go build cmd/go-poker/main.go

FROM alpine:latest
RUN apk --no-cache add ca-certificates && \
    adduser -S -D -H -h /app appuser && \
    mkdir -p /app/certs && chown appuser /app/certs
USER appuser
WORKDIR /app

# 8080: HTTP (or ACME + redirect when TLS is on). 443: HTTPS when
# TLS_DOMAINS / TLS_CERT_FILE is configured (see .env.example).
EXPOSE 8080 443

COPY --from=backend-builder /build/main ./

COPY --from=frontend-builder /app/web/out /app/out

CMD ["./main"]
