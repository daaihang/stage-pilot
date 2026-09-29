package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"math"
	"net/http"
	"net/url"
	"strings"
	"time"

	objectstore "github.com/daaihang/stagepilot/backend/storage"
	"github.com/jackc/pgx/v5"
	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const (
	maxAvatarUploadBytes = 5 << 20
	maxAvatarPixels      = 12_000_000
	maxAvatarDimension   = 10_000
	avatarOutputSize     = 512
)

func managedAvatarURL(userID, objectKey, revision, legacyURL string) string {
	if objectKey == "" {
		return legacyURL
	}
	return "/v1/users/" + url.PathEscape(userID) + "/avatar?v=" + url.QueryEscape(revision)
}

func (app *application) updateMyAvatar(w http.ResponseWriter, r *http.Request) {
	if app.storage == nil {
		errorJSON(w, http.StatusServiceUnavailable, "storage_unavailable", "头像存储暂不可用")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxAvatarUploadBytes+(64<<10))
	if err := r.ParseMultipartForm(maxAvatarUploadBytes); err != nil {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
		errorJSON(w, http.StatusBadRequest, "invalid_avatar", "头像上传请求无效或超过 5 MiB 限制")
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	file, _, err := r.FormFile("avatar")
	if err != nil {
		errorJSON(w, http.StatusBadRequest, "avatar_required", "请选择 JPEG、PNG 或 WebP 头像")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxAvatarUploadBytes+1))
	if err != nil {
		serverError(w, err)
		return
	}
	if len(data) == 0 || len(data) > maxAvatarUploadBytes {
		errorJSON(w, http.StatusBadRequest, "invalid_avatar", "头像不能为空且不能超过 5 MiB")
		return
	}
	encoded, contentType, extension, err := normalizeAvatar(data)
	if err != nil {
		errorJSON(w, http.StatusBadRequest, "invalid_avatar", err.Error())
		return
	}
	userID := claims(r).Subject
	revision := newID()
	objectKey := "user-avatars/" + userID + "/" + revision + "." + extension
	digest := sha256.Sum256(encoded)
	sha256Hex := hex.EncodeToString(digest[:])
	if _, err := app.storage.client.PutObject(r.Context(), objectstore.ObjectRef{Bucket: app.storage.bucket, Key: objectKey}, bytes.NewReader(encoded), int64(len(encoded)), contentType); err != nil {
		serverError(w, err)
		return
	}

	ctx := r.Context()
	tx, err := app.db.Begin(ctx)
	if err != nil {
		app.removeAvatarObject(ctx, objectKey)
		serverError(w, err)
		return
	}
	defer tx.Rollback(ctx)
	var oldKey, oldSHA string
	var oldSize int64
	if err := tx.QueryRow(ctx, `SELECT COALESCE(avatar_object_key,''),avatar_size_bytes,avatar_sha256 FROM users WHERE id=$1 FOR UPDATE`, userID).Scan(&oldKey, &oldSize, &oldSHA); err != nil {
		app.removeAvatarObject(ctx, objectKey)
		if errors.Is(err, pgx.ErrNoRows) {
			errorJSON(w, http.StatusNotFound, "user_not_found", "用户不存在")
			return
		}
		serverError(w, err)
		return
	}
	if oldKey != "" && oldKey != objectKey {
		if err := queueAvatarReplicaTx(ctx, tx, app.storage.bucket, oldKey, oldSize, oldSHA); err != nil {
			app.removeAvatarObject(ctx, objectKey)
			serverError(w, err)
			return
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE users SET avatar_object_key=$1,avatar_revision=$2,avatar_url='',avatar_size_bytes=$3,avatar_sha256=$4,updated_at=NOW() WHERE id=$5`, objectKey, revision, int64(len(encoded)), sha256Hex, userID); err != nil {
		app.removeAvatarObject(ctx, objectKey)
		serverError(w, err)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		app.removeAvatarObjectIfNotCurrent(ctx, userID, objectKey)
		serverError(w, err)
		return
	}
	usr, err := app.findUser(ctx, userID)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, usr)
}

func (app *application) deleteMyAvatar(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID := claims(r).Subject
	tx, err := app.db.Begin(ctx)
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(ctx)
	var oldKey, oldSHA string
	var oldSize int64
	if err := tx.QueryRow(ctx, `SELECT COALESCE(avatar_object_key,''),avatar_size_bytes,avatar_sha256 FROM users WHERE id=$1 FOR UPDATE`, userID).Scan(&oldKey, &oldSize, &oldSHA); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			errorJSON(w, http.StatusNotFound, "user_not_found", "用户不存在")
			return
		}
		serverError(w, err)
		return
	}
	if oldKey != "" {
		sourceBucket := envOrDefault("S3_BUCKET", "stagepilot")
		if app.storage != nil {
			sourceBucket = app.storage.bucket
		}
		if err := queueAvatarReplicaTx(ctx, tx, sourceBucket, oldKey, oldSize, oldSHA); err != nil {
			serverError(w, err)
			return
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE users SET avatar_object_key='',avatar_revision='',avatar_url='',avatar_size_bytes=0,avatar_sha256='',updated_at=NOW() WHERE id=$1`, userID); err != nil {
		serverError(w, err)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		serverError(w, err)
		return
	}
	usr, err := app.findUser(ctx, userID)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, usr)
}

func queueAvatarReplicaTx(ctx context.Context, tx pgx.Tx, sourceBucket, key string, size int64, sha string) error {
	if key == "" {
		return nil
	}
	_, err := tx.Exec(ctx, `INSERT INTO file_replication_tasks(asset_type,asset_id,source_bucket,source_key,target_bucket,target_key,expected_size,expected_sha256)
		VALUES('avatar',$1,$2,$1,'',$1,$3,$4) ON CONFLICT(asset_type,asset_id) DO NOTHING`, key, sourceBucket, size, sha)
	return err
}

func (app *application) getUserAvatar(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	viewerID, targetID := claims(r).Subject, r.PathValue("userId")
	var objectKey string
	err := app.db.QueryRow(ctx, `SELECT COALESCE(avatar_object_key,'') FROM users WHERE id=$1 AND deleted_at IS NULL`, targetID).Scan(&objectKey)
	if err != nil || objectKey == "" {
		errorJSON(w, http.StatusNotFound, "avatar_not_found", "头像不存在")
		return
	}
	if viewerID != targetID {
		allowed, err := app.canViewUserAvatar(ctx, viewerID, targetID)
		if err != nil {
			serverError(w, err)
			return
		}
		if !allowed {
			errorJSON(w, http.StatusNotFound, "avatar_not_found", "头像不存在")
			return
		}
	}
	if app.storage == nil {
		errorJSON(w, http.StatusServiceUnavailable, "storage_unavailable", "头像存储暂不可用")
		return
	}
	ref := objectstore.ObjectRef{Bucket: app.storage.bucket, Key: objectKey}
	info, err := app.storage.client.StatObject(ctx, ref)
	if err != nil {
		if errors.Is(err, objectstore.ErrObjectNotFound) {
			errorJSON(w, http.StatusNotFound, "avatar_not_found", "头像不存在")
			return
		}
		serverError(w, err)
		return
	}
	object, err := app.storage.client.OpenObject(ctx, ref)
	if err != nil {
		if errors.Is(err, objectstore.ErrObjectNotFound) {
			errorJSON(w, http.StatusNotFound, "avatar_not_found", "头像不存在")
			return
		}
		serverError(w, err)
		return
	}
	defer object.Close()
	contentType := "image/png"
	if strings.HasSuffix(objectKey, ".jpg") {
		contentType = "image/jpeg"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", fmt.Sprintf("%d", info.Size))
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.Header().Set("Vary", "Authorization")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if _, err := io.Copy(w, object); err != nil && app.logger != nil {
		app.logger.Warn("stream user avatar", "user_id", targetID, "error", err)
	}
}

func (app *application) canViewUserAvatar(ctx context.Context, viewerID, targetID string) (bool, error) {
	var sharedWorkspace bool
	err := app.db.QueryRow(ctx, `SELECT EXISTS(
		SELECT 1 FROM workspace_memberships viewer
		JOIN workspace_memberships target ON target.workspace_id=viewer.workspace_id
		JOIN workspaces w ON w.id=viewer.workspace_id
		WHERE viewer.user_id=$1 AND viewer.status='active' AND target.user_id=$2 AND w.deleted_at IS NULL
	)`, viewerID, targetID).Scan(&sharedWorkspace)
	if err != nil || sharedWorkspace {
		return sharedWorkspace, err
	}
	rows, err := app.db.Query(ctx, `SELECT DISTINCT p.id
		FROM productions p JOIN workspaces w ON w.id=p.workspace_id
		WHERE p.deleted_at IS NULL AND w.deleted_at IS NULL AND (
			EXISTS(SELECT 1 FROM workspace_memberships target WHERE target.workspace_id=p.workspace_id AND target.user_id=$1 AND target.status='active')
			OR EXISTS(SELECT 1 FROM production_memberships target WHERE target.production_id=p.id AND target.user_id=$1 AND target.status <> 'revoked')
		)`, targetID)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	productionIDs := []string{}
	for rows.Next() {
		var productionID string
		if err := rows.Scan(&productionID); err != nil {
			return false, err
		}
		productionIDs = append(productionIDs, productionID)
	}
	if err := rows.Err(); err != nil {
		return false, err
	}
	for _, productionID := range productionIDs {
		access, err := app.productionAccessFor(ctx, viewerID, productionID)
		if err == nil && access.Permissions[productionMembersView] {
			return true, nil
		}
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return false, err
		}
	}
	return false, nil
}

func (app *application) removeAvatarObject(ctx context.Context, objectKey string) {
	if app.storage == nil || objectKey == "" {
		return
	}
	cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if err := app.storage.client.RemoveObject(cleanupCtx, objectstore.ObjectRef{Bucket: app.storage.bucket, Key: objectKey}); err != nil && app.logger != nil {
		app.logger.Warn("remove obsolete user avatar object", "error", err)
	}
}

func (app *application) removeAvatarObjectIfNotCurrent(ctx context.Context, userID, objectKey string) {
	cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	var isCurrent bool
	if err := app.db.QueryRow(cleanupCtx, `SELECT EXISTS(SELECT 1 FROM users WHERE id=$1 AND avatar_object_key=$2)`, userID, objectKey).Scan(&isCurrent); err != nil {
		if app.logger != nil {
			app.logger.Warn("check avatar object after uncertain commit", "user_id", userID, "error", err)
		}
		return
	}
	if !isCurrent {
		app.removeAvatarObject(cleanupCtx, objectKey)
	}
}

func normalizeAvatar(data []byte) ([]byte, string, string, error) {
	if containsAnimatedPNG(data) || containsAnimatedWebP(data) {
		return nil, "", "", errors.New("不支持动画图片，请上传静态 JPEG、PNG 或 WebP")
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || (format != "jpeg" && format != "png" && format != "webp") {
		return nil, "", "", errors.New("头像必须是有效的 JPEG、PNG 或 WebP 图片")
	}
	if config.Width < 1 || config.Height < 1 || config.Width > maxAvatarDimension || config.Height > maxAvatarDimension || int64(config.Width)*int64(config.Height) > maxAvatarPixels {
		return nil, "", "", errors.New("头像尺寸过大，最长边不能超过 10000 像素且总像素不能超过 1200 万")
	}
	decoded, decodedFormat, err := image.Decode(bytes.NewReader(data))
	if err != nil || decodedFormat != format {
		return nil, "", "", errors.New("头像图片损坏或格式不受支持")
	}
	bounds := decoded.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	if width > avatarOutputSize || height > avatarOutputSize {
		scale := math.Min(float64(avatarOutputSize)/float64(width), float64(avatarOutputSize)/float64(height))
		width = max(1, int(math.Round(float64(width)*scale)))
		height = max(1, int(math.Round(float64(height)*scale)))
		scaled := image.NewRGBA(image.Rect(0, 0, width, height))
		draw.CatmullRom.Scale(scaled, scaled.Bounds(), decoded, bounds, draw.Over, nil)
		decoded = scaled
	}

	var output bytes.Buffer
	if format == "jpeg" {
		if err := jpeg.Encode(&output, decoded, &jpeg.Options{Quality: 86}); err != nil {
			return nil, "", "", fmt.Errorf("无法重新编码头像图片")
		}
		return output.Bytes(), "image/jpeg", "jpg", nil
	}
	if err := png.Encode(&output, decoded); err != nil {
		return nil, "", "", fmt.Errorf("无法重新编码头像图片")
	}
	return output.Bytes(), "image/png", "png", nil
}

func containsAnimatedPNG(data []byte) bool {
	if len(data) < 8 || !bytes.Equal(data[:8], []byte{137, 80, 78, 71, 13, 10, 26, 10}) {
		return false
	}
	for offset := 8; offset+12 <= len(data); {
		length := int(binary.BigEndian.Uint32(data[offset : offset+4]))
		if length < 0 || length > len(data)-offset-12 {
			return false
		}
		chunkType := string(data[offset+4 : offset+8])
		if chunkType == "acTL" || chunkType == "fcTL" || chunkType == "fdAT" {
			return true
		}
		offset += 12 + length
	}
	return false
}

func containsAnimatedWebP(data []byte) bool {
	if len(data) < 12 || string(data[:4]) != "RIFF" || string(data[8:12]) != "WEBP" {
		return false
	}
	for offset := 12; offset+8 <= len(data); {
		length := int(binary.LittleEndian.Uint32(data[offset+4 : offset+8]))
		if length < 0 || length > len(data)-offset-8 {
			return false
		}
		chunkType := string(data[offset : offset+4])
		if chunkType == "ANIM" || chunkType == "ANMF" {
			return true
		}
		offset += 8 + length + (length & 1)
	}
	return false
}
