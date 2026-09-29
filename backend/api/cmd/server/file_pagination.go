package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const defaultFilePageSize = 50
const maxFilePageSize = 100

type fileListCursor struct {
	CreatedAt   time.Time `json:"created_at"`
	ID          string    `json:"id"`
	Fingerprint string    `json:"fingerprint"`
}

func fileFilterFingerprint(scope string, filters ...string) string {
	parts := append([]string{scope}, filters...)
	hash := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return fmt.Sprintf("%x", hash[:])
}

func filePageParameters(r *http.Request, fingerprint string) (int, *fileListCursor, error) {
	limit := defaultFilePageSize
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > maxFilePageSize {
			return 0, nil, errors.New("limit must be between 1 and 100")
		}
		limit = value
	}
	raw := strings.TrimSpace(r.URL.Query().Get("cursor"))
	if raw == "" {
		return limit, nil, nil
	}
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return 0, nil, errors.New("invalid cursor")
	}
	var cursor fileListCursor
	if json.Unmarshal(decoded, &cursor) != nil || cursor.ID == "" || cursor.CreatedAt.IsZero() || cursor.Fingerprint != fingerprint {
		return 0, nil, errors.New("cursor does not match this list")
	}
	return limit, &cursor, nil
}

func encodeFileListCursor(createdAt time.Time, id, fingerprint string) string {
	raw, _ := json.Marshal(fileListCursor{CreatedAt: createdAt, ID: id, Fingerprint: fingerprint})
	return base64.RawURLEncoding.EncodeToString(raw)
}
