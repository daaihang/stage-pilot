package main

import (
	"bufio"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"time"
)

type scanVerdict string

const (
	scanClean       scanVerdict = "clean"
	scanInfected    scanVerdict = "infected"
	scanUnsupported scanVerdict = "unsupported"
)

type scanResult struct {
	Verdict scanVerdict
	Engine  string
	Sigs    string
	Reason  string
}

// fileScanner is intentionally a Worker boundary. API and domain handlers do
// not depend on ClamAV or on a concrete scanner protocol.
type fileScanner interface {
	Ping(context.Context) error
	Version(context.Context) (string, error)
	Scan(context.Context, io.Reader, int64) (scanVerdict, string, error)
}

type clamAVScanner struct {
	address string
	timeout time.Duration
}

func newClamAVScanner(address string, timeout time.Duration) *clamAVScanner {
	if address == "" {
		address = "clamav:3310"
	}
	if timeout <= 0 {
		timeout = 15 * time.Minute
	}
	return &clamAVScanner{address: address, timeout: timeout}
}

func (s *clamAVScanner) connect(ctx context.Context) (net.Conn, error) {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	conn, err := (&net.Dialer{}).DialContext(ctx, "tcp", s.address)
	if err != nil {
		return nil, err
	}
	deadline := time.Now().Add(s.timeout)
	if ctxDeadline, ok := ctx.Deadline(); ok && ctxDeadline.Before(deadline) {
		deadline = ctxDeadline
	}
	if err := conn.SetDeadline(deadline); err != nil {
		_ = conn.Close()
		return nil, err
	}
	return conn, nil
}

func protocolReply(conn net.Conn) (string, error) {
	const maxReplyBytes = 64 * 1024
	reader := bufio.NewReader(io.LimitReader(conn, maxReplyBytes+1))
	reply, err := reader.ReadString('\x00')
	if len(reply) > maxReplyBytes {
		return "", errors.New("clamd response too large")
	}
	if err != nil {
		return "", err
	}
	return strings.TrimSuffix(reply, "\x00"), nil
}

func (s *clamAVScanner) command(ctx context.Context, command string) (string, error) {
	conn, err := s.connect(ctx)
	if err != nil {
		return "", err
	}
	defer conn.Close()
	if _, err = io.WriteString(conn, "z"+command+"\x00"); err != nil {
		return "", err
	}
	return protocolReply(conn)
}

func (s *clamAVScanner) Ping(ctx context.Context) error {
	reply, err := s.command(ctx, "PING")
	if err != nil {
		return err
	}
	if reply != "PONG" {
		return fmt.Errorf("unexpected clamd ping response %q", reply)
	}
	return nil
}

func (s *clamAVScanner) Version(ctx context.Context) (string, error) {
	reply, err := s.command(ctx, "VERSION")
	if err != nil {
		return "", err
	}
	if !strings.HasPrefix(reply, "ClamAV ") {
		return "", fmt.Errorf("unexpected clamd version response %q", reply)
	}
	return strings.TrimSpace(strings.TrimPrefix(reply, "ClamAV ")), nil
}

func (s *clamAVScanner) Scan(ctx context.Context, source io.Reader, maxBytes int64) (scanVerdict, string, error) {
	conn, err := s.connect(ctx)
	if err != nil {
		return "", "", err
	}
	defer conn.Close()
	if _, err := io.WriteString(conn, "zINSTREAM\x00"); err != nil {
		return "", "", err
	}
	buffer := make([]byte, 64*1024)
	var total int64
	for {
		n, readErr := source.Read(buffer)
		if n > 0 {
			total += int64(n)
			if total > maxBytes {
				return scanUnsupported, "file exceeds scanner size limit", nil
			}
			var size [4]byte
			binary.BigEndian.PutUint32(size[:], uint32(n))
			if _, err := conn.Write(size[:]); err != nil {
				return "", "", err
			}
			if _, err := conn.Write(buffer[:n]); err != nil {
				return "", "", err
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return "", "", readErr
		}
	}
	if _, err := conn.Write([]byte{0, 0, 0, 0}); err != nil {
		return "", "", err
	}
	reply, err := protocolReply(conn)
	if err != nil {
		return "", "", err
	}
	if strings.HasSuffix(reply, " OK") {
		return scanClean, reply, nil
	}
	if strings.Contains(reply, "INSTREAM size limit exceeded") || strings.Contains(reply, "Heuristics.Limits.Exceeded") {
		return scanUnsupported, reply, nil
	}
	if strings.Contains(reply, " FOUND") {
		return scanInfected, reply, nil
	}
	if strings.Contains(reply, " ERROR") {
		return "", reply, fmt.Errorf("clamd scan error: %s", reply)
	}
	return "", reply, fmt.Errorf("unexpected clamd scan response %q", reply)
}

// checkClamAVScanner is an operator-facing Compose smoke test. It performs a
// clean scan and the harmless EICAR test-pattern scan over the exact same
// INSTREAM protocol used for file objects.
func checkClamAVScanner(ctx context.Context, scanner fileScanner) (string, error) {
	if err := scanner.Ping(ctx); err != nil {
		return "", fmt.Errorf("ClamAV PING/PONG failed: %w", err)
	}
	version, err := scanner.Version(ctx)
	if err != nil {
		return "", fmt.Errorf("ClamAV VERSION failed: %w", err)
	}
	clean, _, err := scanner.Scan(ctx, strings.NewReader("StagePilot scanner connectivity check"), 1024)
	if err != nil {
		return "", fmt.Errorf("clean sample scan failed: %w", err)
	}
	if clean != scanClean {
		return "", fmt.Errorf("clean sample scan returned %q", clean)
	}
	const eicar = `X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`
	infected, _, err := scanner.Scan(ctx, strings.NewReader(eicar), 1024)
	if err != nil {
		return "", fmt.Errorf("EICAR sample scan failed: %w", err)
	}
	if infected != scanInfected {
		return "", fmt.Errorf("EICAR sample scan returned %q", infected)
	}
	return version, nil
}
