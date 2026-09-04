package main

import (
	"encoding/json"
	"testing"
	"time"
)

func TestOptionalTimeDistinguishesPatchStates(t *testing.T) {
	var omitted struct {
		Value optionalTime `json:"value"`
	}
	if err := json.Unmarshal([]byte(`{}`), &omitted); err != nil {
		t.Fatal(err)
	}
	if omitted.Value.Present {
		t.Fatal("omitted field must not be present")
	}

	var cleared struct {
		Value optionalTime `json:"value"`
	}
	if err := json.Unmarshal([]byte(`{"value":null}`), &cleared); err != nil {
		t.Fatal(err)
	}
	if !cleared.Value.Present || cleared.Value.Value != nil {
		t.Fatalf("null state = %#v", cleared.Value)
	}

	var set struct {
		Value optionalTime `json:"value"`
	}
	if err := json.Unmarshal([]byte(`{"value":"2026-11-01T05:30:00Z"}`), &set); err != nil {
		t.Fatal(err)
	}
	if !set.Value.Present || set.Value.Value == nil || !set.Value.Value.Equal(time.Date(2026, 11, 1, 5, 30, 0, 0, time.UTC)) {
		t.Fatalf("value state = %#v", set.Value)
	}
}
