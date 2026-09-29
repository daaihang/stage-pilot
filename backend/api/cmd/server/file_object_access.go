package main

import (
	"bytes"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

const maxStorageAuditEventBytes = 1 << 20

var errStorageAuditEventTooLarge = errors.New("storage audit event too large")

type minioAuditEvent struct {
	Time      string `json:"time"`
	RequestID string `json:"requestID"`
	API       struct {
		Name       string `json:"name"`
		Bucket     string `json:"bucket"`
		Object     string `json:"object"`
		Status     string `json:"status"`
		StatusCode int    `json:"statusCode"`
	} `json:"api"`
}

type objectAccessEvent struct {
	OccurredAt time.Time
	RequestID  string
	Bucket     string
	Object     string
	Operation  string
	StatusCode int
	Outcome    string
}

func parseMinIOAuditEvent(body io.Reader) (objectAccessEvent, error) {
	payload, err := io.ReadAll(io.LimitReader(body, maxStorageAuditEventBytes+1))
	if err != nil {
		return objectAccessEvent{}, err
	}
	if len(payload) > maxStorageAuditEventBytes {
		return objectAccessEvent{}, errStorageAuditEventTooLarge
	}
	var input minioAuditEvent
	decoder := json.NewDecoder(bytes.NewReader(payload))
	if err := decoder.Decode(&input); err != nil {
		return objectAccessEvent{}, err
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return objectAccessEvent{}, io.ErrUnexpectedEOF
	}
	event := objectAccessEvent{
		RequestID: strings.TrimSpace(input.RequestID), Bucket: strings.TrimSpace(input.API.Bucket),
		Object: strings.TrimLeft(strings.TrimSpace(input.API.Object), "/"), Operation: input.API.Name,
		StatusCode: input.API.StatusCode, Outcome: input.API.Status,
	}
	if event.Operation != "GetObject" && event.Operation != "DeleteObject" {
		return objectAccessEvent{}, nil
	}
	if event.Bucket == "" || event.Object == "" || event.StatusCode < 100 || event.StatusCode > 599 || len(event.Object) > 2048 {
		return objectAccessEvent{}, io.ErrUnexpectedEOF
	}
	if parsed, err := time.Parse(time.RFC3339Nano, input.Time); err == nil {
		event.OccurredAt = parsed
	} else {
		event.OccurredAt = time.Now().UTC()
	}
	return event, nil
}

func (app *application) ingestStorageAuditEvent(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimSpace(os.Getenv("MINIO_AUDIT_WEBHOOK_AUTH_TOKEN"))
	if token == "" {
		http.Error(w, "storage audit ingress unavailable", http.StatusServiceUnavailable)
		return
	}
	want := "Bearer " + token
	got := r.Header.Get("Authorization")
	if len(got) != len(want) || subtle.ConstantTimeCompare([]byte(got), []byte(want)) != 1 {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if r.ContentLength > maxStorageAuditEventBytes {
		http.Error(w, "event too large", http.StatusRequestEntityTooLarge)
		return
	}
	event, err := parseMinIOAuditEvent(r.Body)
	if err != nil {
		if errors.Is(err, errStorageAuditEventTooLarge) {
			http.Error(w, "event too large", http.StatusRequestEntityTooLarge)
			return
		}
		http.Error(w, "invalid storage audit event", http.StatusBadRequest)
		return
	}
	if event.Operation == "" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	formalBucket := envOrDefault("S3_BUCKET", "stagepilot")
	if event.Bucket != formalBucket || !(strings.HasPrefix(event.Object, "ws/") || strings.HasPrefix(event.Object, "user-avatars/")) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	_, err = app.db.Exec(r.Context(), `INSERT INTO file_object_access_events(occurred_at,storage_request_id,bucket,object_key,operation,status_code,outcome)
		VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, event.OccurredAt, event.RequestID, event.Bucket,
		event.Object, event.Operation, event.StatusCode, event.Outcome)
	if err != nil {
		serverError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
