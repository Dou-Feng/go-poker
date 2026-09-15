FROM golang:1.24.3-alpine AS builder
RUN mkdir /build
ADD . /build/
WORKDIR /build
RUN go build -o /build/main ./cmd/go-poker

FROM alpine
RUN adduser -S -D -H -h /app appuser
USER appuser
COPY --from=builder /build/main /app/
WORKDIR /app
CMD ["./main"]
