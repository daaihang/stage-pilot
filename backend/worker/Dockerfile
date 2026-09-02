FROM golang:1.26-alpine AS build

WORKDIR /src
COPY backend/worker/go.mod backend/worker/go.sum ./
RUN go mod download
COPY backend/worker/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/stagepilot-worker ./cmd/worker

FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S stagepilot \
    && adduser -S -G stagepilot stagepilot
COPY --from=build /out/stagepilot-worker /usr/local/bin/stagepilot-worker
USER stagepilot
ENTRYPOINT ["stagepilot-worker"]
