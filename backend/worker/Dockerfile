FROM golang:1.26-alpine AS build

WORKDIR /src
COPY backend/worker/ ./backend/worker/
COPY backend/storage/ ./backend/storage/
WORKDIR /src/backend/worker
RUN go mod download
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/stagepilot-worker ./cmd/worker

FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S stagepilot \
    && adduser -S -G stagepilot stagepilot
COPY --from=build /out/stagepilot-worker /usr/local/bin/stagepilot-worker
USER stagepilot
ENTRYPOINT ["stagepilot-worker"]
