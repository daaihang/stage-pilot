FROM golang:1.26-alpine AS build

WORKDIR /src
COPY backend/api/ ./backend/api/
COPY backend/storage/ ./backend/storage/
WORKDIR /src/backend/api
RUN go mod download
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/stagepilot-api ./cmd/server
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/storage-retention ./cmd/storage-retention
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/file-ops ./cmd/file-ops

FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S stagepilot \
    && adduser -S -G stagepilot stagepilot
COPY --from=build /out/stagepilot-api /usr/local/bin/stagepilot-api
COPY --from=build /out/storage-retention /usr/local/bin/storage-retention
COPY --from=build /out/file-ops /usr/local/bin/file-ops
USER stagepilot
EXPOSE 8080
ENTRYPOINT ["stagepilot-api"]
