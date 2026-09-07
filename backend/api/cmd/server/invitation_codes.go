package main

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

const invitationCodeAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

var errInvalidInvitationCode = errors.New("invalid invitation code")

func normalizeInvitationCode(value string) (string, error) {
	value = strings.ToUpper(strings.TrimSpace(value))
	value = strings.ReplaceAll(value, "-", "")
	value = strings.ReplaceAll(value, " ", "")
	if len(value) != 10 {
		return "", errInvalidInvitationCode
	}
	var normalized strings.Builder
	normalized.Grow(10)
	for _, ch := range value {
		switch ch {
		case 'O':
			ch = '0'
		case 'I', 'L':
			ch = '1'
		}
		if !strings.ContainsRune(invitationCodeAlphabet, ch) {
			return "", errInvalidInvitationCode
		}
		normalized.WriteRune(ch)
	}
	return normalized.String(), nil
}

func formatInvitationCode(code string) string {
	if len(code) != 10 {
		return code
	}
	return code[:5] + "-" + code[5:]
}

func generateInvitationCode() (string, error) {
	var raw [10]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	var code strings.Builder
	code.Grow(10)
	for _, value := range raw {
		code.WriteByte(invitationCodeAlphabet[int(value)&31])
	}
	return code.String(), nil
}

func invitationKey(app *application, purpose string) []byte {
	var source []byte
	if purpose == "hash" {
		source = app.invitationHashKey
	} else {
		source = app.invitationEncryptionKey
	}
	if len(source) > 0 {
		return source
	}
	// Tests and older development environments construct application directly.
	// Derive deterministic development-only keys instead of falling back to
	// storing a plaintext credential.
	h := sha256.Sum256(append([]byte("stagepilot-invitation-"+purpose+":"), app.jwtSecret...))
	return h[:]
}

func invitationCodeHash(app *application, code string) string {
	mac := hmac.New(sha256.New, invitationKey(app, "hash"))
	_, _ = mac.Write([]byte(code))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func encryptInvitationCode(app *application, code string) (string, error) {
	block, err := aes.NewCipher(invitationKey(app, "encryption")[:32])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nonce, nonce, []byte(code), nil)
	return base64.RawURLEncoding.EncodeToString(sealed), nil
}

func decryptInvitationCode(app *application, encrypted string) (string, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(encrypted)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(invitationKey(app, "encryption")[:32])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(decoded) < gcm.NonceSize() {
		return "", errors.New("invalid encrypted invitation code")
	}
	nonce, sealed := decoded[:gcm.NonceSize()], decoded[gcm.NonceSize():]
	plain, err := gcm.Open(nil, nonce, sealed, nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

func invitationJoinURL(r *http.Request, code string) string {
	origin := strings.TrimRight(strings.TrimSpace(r.Header.Get("Origin")), "/")
	if origin == "" {
		scheme := "http"
		if r.TLS != nil {
			scheme = "https"
		}
		origin = scheme + "://" + r.Host
	}
	return origin + "/#/join/" + formatInvitationCode(code)
}

func invitationCredentialResponse(r *http.Request, id, scope, code string, version int, expires time.Time) (map[string]any, error) {
	if code == "" {
		return nil, errors.New("invitation credential is unavailable")
	}
	return map[string]any{
		"id":           id,
		"scope_kind":   scope,
		"join_code":    formatInvitationCode(code),
		"join_url":     invitationJoinURL(r, code),
		"code_version": version,
		"expires_at":   expires,
	}, nil
}

func writeNoStoreJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
	writeJSON(w, status, value)
}

func invitationCredentialState(codeHash, encrypted string) string {
	if codeHash != "" && encrypted != "" {
		return "active"
	}
	if codeHash != "" || encrypted != "" {
		return "unavailable"
	}
	return "legacy"
}

func invitationCodeError(w http.ResponseWriter) {
	errorJSON(w, http.StatusBadRequest, "invalid_invitation_code", "邀请短码无效")
}

func (app *application) recordInvitationCodeEvent(ctx context.Context, scope, invitationID, action string, version int, actor string) error {
	return recordInvitationCodeEventExec(ctx, app.db, scope, invitationID, action, version, actor)
}

func recordInvitationCodeEventExec(ctx context.Context, exec interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}, scope, invitationID, action string, version int, actor string) error {
	_, err := exec.Exec(ctx, `INSERT INTO invitation_code_events(id,scope_kind,invitation_id,action,code_version,created_by) VALUES($1,$2,$3,$4,$5,$6)`, newID(), scope, invitationID, action, version, actor)
	return err
}

func invitationRotationAllowed(now time.Time, starts, expires time.Time, revoked *time.Time, accepted, max int) bool {
	return revoked == nil && accepted < max && !now.Before(starts) && expires.After(now)
}

func invitationCodeURLForResponse(r *http.Request, code string) string {
	return invitationJoinURL(r, code)
}

func invitationCodeMismatchError() error {
	return &invitationError{http.StatusForbidden, "invitation_email_mismatch", "当前已验证邮箱与邀请邮箱不匹配"}
}

func invitationCodeExpiredError() error {
	return &invitationError{http.StatusNotFound, "invitation_not_found", "邀请无效或已失效"}
}

func invitationCodeKeyLengthError() error {
	return fmt.Errorf("invitation key must be at least 32 bytes")
}
