FROM golang:1.26-alpine AS build

WORKDIR /src
COPY backend/api/go.mod backend/api/go.sum ./
RUN go mod download
COPY backend/api/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/stagepilot-api ./cmd/server

FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S stagepilot \
    && adduser -S -G stagepilot stagepilot
COPY --from=build /out/stagepilot-api /usr/local/bin/stagepilot-api
USER stagepilot
EXPOSE 8080
ENTRYPOINT ["stagepilot-api"]
