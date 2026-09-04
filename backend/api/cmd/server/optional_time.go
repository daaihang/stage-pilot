package main

import (
	"bytes"
	"encoding/json"
	"time"
)

// optionalTime preserves the distinction between an omitted PATCH field and an
// explicitly supplied null. Value is nil for null, and non-nil for a parsed
// RFC3339 instant.
type optionalTime struct {
	Present bool
	Value   *time.Time
}

func (value *optionalTime) UnmarshalJSON(data []byte) error {
	value.Present = true
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		value.Value = nil
		return nil
	}
	var parsed time.Time
	if err := json.Unmarshal(data, &parsed); err != nil {
		return err
	}
	value.Value = &parsed
	return nil
}
