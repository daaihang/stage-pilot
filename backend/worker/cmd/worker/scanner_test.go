package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"io"
	"net"
	"strings"
	"testing"
	"time"
)

func TestInspectContentTypeRejectsDeclaredAndExtensionMismatch(t *testing.T) {
	text := []byte("hello stagepilot")
	if got, err := inspectContentType("notes.txt", "text/plain; charset=utf-8", text); err != nil || got != "text/plain" {
		t.Fatalf("text content validation = %q, %v", got, err)
	}
	if _, err := inspectContentType("notes.txt", "application/pdf", text); err == nil {
		t.Fatal("accepted content-type declaration that conflicts with the signature")
	}
	if _, err := inspectContentType("notes.pdf", "application/octet-stream", text); err == nil {
		t.Fatal("accepted filename extension that conflicts with the signature")
	}
	if got, err := inspectContentType("opaque.data", "application/octet-stream", []byte{0x01, 0x02, 0x03}); err != nil || got != "application/octet-stream" {
		t.Fatalf("unknown binary type = %q, %v", got, err)
	}
	if got, err := inspectContentType("opaque.pdf", "application/pdf", []byte{0x01, 0x02, 0x03}); err != nil || got != "application/octet-stream" {
		t.Fatalf("unknown signature should be forced to octet-stream = %q, %v", got, err)
	}
	if got, err := inspectContentType("metadata.json", "application/json", []byte(`{"ok":true}`)); err != nil || got != "application/json" {
		t.Fatalf("JSON signature/type = %q, %v", got, err)
	}
	if got, err := inspectContentType("people.csv", "text/csv", []byte("name,email\nAda,ada@example.test\n")); err != nil || got != "text/csv" {
		t.Fatalf("CSV signature/type = %q, %v", got, err)
	}
}

func TestScanRetryBackoffIsExponentialAndBounded(t *testing.T) {
	for attempt, want := range map[int]time.Duration{
		0:  time.Second,
		1:  time.Second,
		2:  2 * time.Second,
		3:  4 * time.Second,
		9:  256 * time.Second,
		10: 5 * time.Minute,
		50: 5 * time.Minute,
	} {
		if got := nextRetry(attempt); got != want {
			t.Errorf("nextRetry(%d) = %s, want %s", attempt, got, want)
		}
	}
}

func TestScanContentHashesExactStreamAndRecordsDetectedType(t *testing.T) {
	data := []byte("hello stagepilot")
	scanner := newClamAVScanner(startFakeClamd(t, "stream: OK"), time.Second)
	task := scanTask{Filename: "notes.txt", DeclaredType: "application/octet-stream", SizeBytes: int64(len(data))}
	result, gotHash, contentType, err := scanContent(t.Context(), scanner, bytes.NewReader(data), task, 100)
	if err != nil || result.Verdict != scanClean || contentType != "text/plain" {
		t.Fatalf("scan result = %#v, type %q, err %v", result, contentType, err)
	}
	want := sha256.Sum256(data)
	if gotHash != hex.EncodeToString(want[:]) {
		t.Fatalf("SHA-256 = %q, want %x", gotHash, want)
	}
}

func TestFileSizeLimitIsDecimalTwoGigabytes(t *testing.T) {
	if defaultMaxFileBytes != 2_000_000_000 {
		t.Fatalf("default file size limit = %d", defaultMaxFileBytes)
	}
	t.Setenv("FILES_MAX_BYTES", "5000000000")
	if got := maxFileBytesFromEnv(); got != defaultMaxFileBytes {
		t.Fatalf("configured limit may not raise hard ceiling: %d", got)
	}
}

func startFakeClamd(t *testing.T, scanReply string) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func(conn net.Conn) {
				defer conn.Close()
				reader := bufio.NewReader(conn)
				command, err := reader.ReadString(0)
				if err != nil {
					return
				}
				switch strings.TrimSuffix(command, "\x00") {
				case "zPING":
					_, _ = io.WriteString(conn, "PONG\x00")
				case "zVERSION":
					_, _ = io.WriteString(conn, "ClamAV 1.5.4/27415/Wed Sep 23 08:00:00 2026\x00")
				case "zINSTREAM":
					var total int
					for {
						var size [4]byte
						if _, err := io.ReadFull(reader, size[:]); err != nil {
							return
						}
						n := binary.BigEndian.Uint32(size[:])
						if n == 0 {
							break
						}
						chunk := make([]byte, n)
						if _, err := io.ReadFull(reader, chunk); err != nil {
							return
						}
						total += len(chunk)
					}
					_, _ = io.WriteString(conn, scanReply+"\x00")
				}
			}(conn)
		}
	}()
	return listener.Addr().String()
}

func TestClamAVScannerProtocolAndVerdicts(t *testing.T) {
	for _, test := range []struct {
		name, reply string
		want        scanVerdict
	}{
		{"clean", "stream: OK", scanClean},
		{"infected", "stream: Eicar-Test-Signature FOUND", scanInfected},
		{"limit", "stream: Heuristics.Limits.Exceeded FOUND", scanUnsupported},
	} {
		t.Run(test.name, func(t *testing.T) {
			scanner := newClamAVScanner(startFakeClamd(t, test.reply), time.Second)
			if err := scanner.Ping(t.Context()); err != nil {
				t.Fatalf("PING/PONG failed: %v", err)
			}
			version, err := scanner.Version(t.Context())
			if err != nil || !strings.HasPrefix(version, "1.5.4/") {
				t.Fatalf("VERSION = %q, %v", version, err)
			}
			got, _, err := scanner.Scan(context.Background(), strings.NewReader("sample bytes"), 64)
			if err != nil || got != test.want {
				t.Fatalf("Scan verdict = %q, %v; want %q", got, err, test.want)
			}
		})
	}
}

func TestClamAVScannerRejectsOverLimitWithoutSending(t *testing.T) {
	scanner := newClamAVScanner(startFakeClamd(t, "stream: OK"), time.Second)
	verdict, reason, err := scanner.Scan(t.Context(), strings.NewReader("12345"), 4)
	if err != nil || verdict != scanUnsupported || reason == "" {
		t.Fatalf("over-limit result = %q %q %v", verdict, reason, err)
	}
}
