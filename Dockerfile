FROM node:18-alpine AS frontend-builder
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM golang:1.24.3-alpine AS backend-builder
WORKDIR /build
COPY backend/ ./
ENV GOPROXY=https://goproxy.cn,https://proxy.golang.org,direct
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
