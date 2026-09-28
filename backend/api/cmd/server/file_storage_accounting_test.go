package main

import (
	"errors"
	"testing"
)

func TestValidateFileUploadSizeEnforcesSystemAndPurposeLimits(t *testing.T) {
	tests := []struct {
		name, code string
		policy     fileUploadPolicy
		declared   int64
		systemMax  int64
	}{
		{name: "system boundary accepted", policy: fileUploadPolicy{}, declared: hardMaxFileBytes, systemMax: hardMaxFileBytes},
		{name: "system boundary exceeded", code: "file_too_large", policy: fileUploadPolicy{}, declared: hardMaxFileBytes + 1, systemMax: hardMaxFileBytes},
		{name: "configured system cap", code: "file_too_large", policy: fileUploadPolicy{}, declared: 101, systemMax: 100},
		{name: "purpose cap", code: "file_policy_violation", policy: fileUploadPolicy{MaxBytes: 10}, declared: 11, systemMax: hardMaxFileBytes},
		{name: "purpose cap boundary", policy: fileUploadPolicy{MaxBytes: 10}, declared: 10, systemMax: hardMaxFileBytes},
		{name: "zero size rejected", code: "file_policy_violation", policy: fileUploadPolicy{}, declared: 0, systemMax: hardMaxFileBytes},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateFileUploadSize(tt.policy, tt.declared, tt.systemMax)
			if tt.code == "" {
				if err != nil {
					t.Fatalf("expected accepted size, got %v", err)
				}
				return
			}
			var storageErr *fileStorageError
			if !errors.As(err, &storageErr) || storageErr.Code != tt.code {
				t.Fatalf("expected %s, got %v", tt.code, err)
			}
		})
	}
}
