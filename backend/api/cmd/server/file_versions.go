package main

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/minio/minio-go/v7"
)

type fileVersion struct {
	ID            string    `json:"id"`
	FileID        string    `json:"file_id"`
	VersionNo     int       `json:"version_no"`
	Filename      string    `json:"filename"`
	ContentType   string    `json:"content_type"`
	SizeBytes     int64     `json:"size_bytes"`
	CreatedBy     string    `json:"created_by"`
	CreatedAt     time.Time `json:"created_at"`
	SourceFileID  *string   `json:"source_file_id,omitempty"`
	SourceVersion *string   `json:"source_version_id,omitempty"`
}

func immutableKey(workspaceID, versionID string) string {
	return "ws/" + workspaceID + "/versions/" + versionID
}

// The signed URL only writes a staging key. A server-side copy pins the bytes
// at a never-presigned version key before any database pointer is published.
func copyImmutableObject(ctx context.Context, s *objectStorage, sourceBucket, sourceKey, sourceETag string, size int64, destinationKey string) (string, error) {
	src := minio.CopySrcOptions{Bucket: sourceBucket, Object: sourceKey, MatchETag: sourceETag}
	dst := minio.CopyDestOptions{Bucket: s.bucket, Object: destinationKey}
	var info minio.UploadInfo
	var err error
	if size <= 5_000_000_000 {
		info, err = s.client.CopyObject(ctx, dst, src)
	} else {
		parts := make([]minio.CopySrcOptions, 0, int(size/(1<<30))+1)
		for start := int64(0); start < size; start += 1 << 30 {
			end := start + (1 << 30) - 1
			if end >= size {
				end = size - 1
			}
			part := src
			part.MatchRange, part.Start, part.End = true, start, end
			parts = append(parts, part)
		}
		info, err = s.client.ComposeObject(ctx, dst, parts...)
	}
	if err != nil {
		return "", err
	}
	stat, err := s.client.StatObject(ctx, s.bucket, destinationKey, minio.StatObjectOptions{})
	if err != nil || stat.Size != size {
		_ = s.client.RemoveObject(ctx, s.bucket, destinationKey, minio.RemoveObjectOptions{})
		return "", fmt.Errorf("immutable object size mismatch: %w", err)
	}
	if stat.ETag != "" {
		return strings.Trim(stat.ETag, `"`), nil
	}
	return strings.Trim(info.ETag, `"`), nil
}

func removeUncommittedCopy(ctx context.Context, s *objectStorage, key string) {
	_ = s.client.RemoveObject(ctx, s.bucket, key, minio.RemoveObjectOptions{})
}

func (app *application) recordCopyAttempt(ctx context.Context, workspaceID string, s *objectStorage, versionID string) error {
	_, err := app.db.Exec(ctx, `INSERT INTO file_copy_attempts(id,workspace_id,bucket,object_key) VALUES($1,$2,$3,$4)`, versionID, workspaceID, s.bucket, immutableKey(workspaceID, versionID))
	return err
}

func commitCopyAttempt(ctx context.Context, tx pgx.Tx, versionID string) error {
	_, err := tx.Exec(ctx, `UPDATE file_copy_attempts SET status='committed' WHERE id=$1 AND status='pending'`, versionID)
	return err
}

func (app *application) finalizeLegacyFile(ctx context.Context, s *objectStorage, workspaceID, fileID, userID string, f fileLocation, sourceETag string) (bool, error) {
	versionID := newID()
	key := immutableKey(workspaceID, versionID)
	if err := app.recordCopyAttempt(ctx, workspaceID, s, versionID); err != nil {
		return false, err
	}
	etag, err := copyImmutableObject(ctx, s, f.Bucket, f.ObjectKey, sourceETag, f.SizeBytes, key)
	if err != nil {
		return false, err
	}
	committed := false
	defer func() {
		if !committed {
			removeUncommittedCopy(context.Background(), s, key)
		}
	}()
	tx, err := app.db.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	var status string
	var deletedAt *time.Time
	err = tx.QueryRow(ctx, `SELECT status,deleted_at FROM files WHERE id=$1 AND workspace_id=$2 AND created_by=$3 FOR UPDATE`, fileID, workspaceID, userID).Scan(&status, &deletedAt)
	if err != nil {
		return false, err
	}
	if status != "pending" || deletedAt != nil {
		return false, nil
	}
	var contentType string
	err = tx.QueryRow(ctx, `SELECT content_type FROM files WHERE id=$1`, fileID).Scan(&contentType)
	if err != nil {
		return false, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO file_versions(id,workspace_id,file_id,version_no,bucket,object_key,filename,content_type,size_bytes,etag,created_by,frozen_at)
		VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,NOW())`, versionID, workspaceID, fileID, s.bucket, key, f.Filename, contentType, f.SizeBytes, etag, userID)
	if err != nil {
		return false, err
	}
	_, err = tx.Exec(ctx, `UPDATE files SET status='uploaded',bucket=$1,object_key=$2,etag=$3,current_version_id=$4,updated_at=NOW() WHERE id=$5`, s.bucket, key, etag, versionID, fileID)
	if err != nil {
		return false, err
	}
	_, err = tx.Exec(ctx, `UPDATE file_upload_sessions SET status='completed',resulting_version_id=$1 WHERE file_id=$2 AND status='pending' AND staging_key=$3`, versionID, fileID, f.ObjectKey)
	if err != nil {
		return false, err
	}
	if err = commitCopyAttempt(ctx, tx, versionID); err != nil {
		return false, err
	}
	if err = tx.Commit(ctx); err != nil {
		return false, err
	}
	committed = true
	return true, nil
}

func (app *application) listVersionsForFile(ctx context.Context, fileID string) ([]fileVersion, error) {
	rows, err := app.db.Query(ctx, `SELECT id,file_id,version_no,filename,content_type,size_bytes,created_by,created_at,source_file_id,source_version_id
		FROM file_versions WHERE file_id=$1 ORDER BY version_no DESC`, fileID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []fileVersion{}
	for rows.Next() {
		var v fileVersion
		if err := rows.Scan(&v.ID, &v.FileID, &v.VersionNo, &v.Filename, &v.ContentType, &v.SizeBytes, &v.CreatedBy, &v.CreatedAt, &v.SourceFileID, &v.SourceVersion); err != nil {
			return nil, err
		}
		items = append(items, v)
	}
	return items, rows.Err()
}

func (app *application) createFileUploadSession(ctx context.Context, s *objectStorage, workspaceID, fileID, userID, filename, contentType string, size int64) (map[string]any, error) {
	id := newID()
	key := "ws/" + workspaceID + "/staging/" + id
	_, err := app.db.Exec(ctx, `INSERT INTO file_upload_sessions(id,workspace_id,file_id,created_by,staging_bucket,staging_key,expected_size,filename,content_type,expires_at)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, id, workspaceID, fileID, userID, s.bucket, key, size, filename, contentType, time.Now().Add(s.ttl))
	if err != nil {
		return nil, err
	}
	u, err := s.presignClient.PresignedPutObject(ctx, s.bucket, key, s.ttl)
	if err != nil {
		return nil, err
	}
	return map[string]any{"upload_id": id, "url": u.String(), "method": "PUT", "expires_in": int64(s.ttl.Seconds())}, nil
}

func (app *application) authorizeVersionFile(w http.ResponseWriter, r *http.Request, action fileAction) (string, bool) {
	f, err := app.fileLocation(r)
	if err != nil {
		errorJSON(w, 404, "file_not_found", "文件不存在")
		return "", false
	}
	op := "read"
	if action == fileUploadVersion {
		op = "write"
	}
	if !app.authorizeFileScope(w, r, r.PathValue("id"), f.ProductionID, op) {
		return "", false
	}
	if f.Status != "uploaded" {
		errorJSON(w, 409, "file_not_uploaded", "文件尚未完成上传")
		return "", false
	}
	return r.PathValue("fileId"), true
}

func (app *application) listFileVersions(w http.ResponseWriter, r *http.Request) {
	id, ok := app.authorizeVersionFile(w, r, fileView)
	if !ok {
		return
	}
	items, err := app.listVersionsForFile(r.Context(), id)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items, "total": len(items)})
}

func (app *application) startFileVersion(w http.ResponseWriter, r *http.Request) {
	id, ok := app.authorizeVersionFile(w, r, fileUploadVersion)
	if !ok {
		return
	}
	var in struct {
		Filename    string `json:"filename"`
		ContentType string `json:"content_type"`
		SizeBytes   int64  `json:"size_bytes"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	s := app.storageRequired(w)
	if s == nil {
		return
	}
	if in.SizeBytes <= 0 || in.SizeBytes > s.maxBytes {
		errorJSON(w, 400, "invalid_size", "文件大小无效或超过限制")
		return
	}
	if in.ContentType == "" {
		in.ContentType = "application/octet-stream"
	}
	u, err := app.createFileUploadSession(r.Context(), s, r.PathValue("id"), id, claims(r).Subject, cleanFilename(in.Filename), in.ContentType, in.SizeBytes)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 201, map[string]any{"upload": u})
}

func (app *application) downloadFileVersion(w http.ResponseWriter, r *http.Request) {
	id, ok := app.authorizeVersionFile(w, r, fileDownload)
	if !ok {
		return
	}
	app.presignVersion(w, r, id, r.PathValue("versionId"))
}

func (app *application) presignVersion(w http.ResponseWriter, r *http.Request, fileID, versionID string) {
	var bucket, key, filename string
	err := app.db.QueryRow(r.Context(), `SELECT bucket,object_key,filename FROM file_versions WHERE id=$1 AND file_id=$2`, versionID, fileID).Scan(&bucket, &key, &filename)
	if err != nil {
		errorJSON(w, 404, "version_not_found", "文件版本不存在")
		return
	}
	s := app.storageRequired(w)
	if s == nil {
		return
	}
	u, err := s.presignClient.PresignedGetObject(r.Context(), bucket, key, 5*time.Minute, url.Values{"response-content-disposition": []string{"attachment; filename=\"" + strings.ReplaceAll(filename, `"`, "") + "\""}})
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"url": u.String(), "expires_in": 300})
}

func (app *application) completeFileUploadSession(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("uploadId")
	var fileID, workspaceID, uploader, bucket, key, filename, contentType, status string
	var expected int64
	var completedVersion *string
	err := app.db.QueryRow(r.Context(), `SELECT file_id,workspace_id,created_by,staging_bucket,staging_key,filename,content_type,expected_size,status,resulting_version_id
		FROM file_upload_sessions WHERE id=$1`, id).Scan(&fileID, &workspaceID, &uploader, &bucket, &key, &filename, &contentType, &expected, &status, &completedVersion)
	if err != nil {
		errorJSON(w, 404, "upload_not_found", "上传任务不存在")
		return
	}
	if uploader != claims(r).Subject {
		errorJSON(w, 404, "upload_not_found", "上传任务不存在")
		return
	}
	var productionID *string
	var mode, fileStatus string
	err = app.db.QueryRow(r.Context(), `SELECT production_id,access_mode,status FROM files WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`, fileID, workspaceID).Scan(&productionID, &mode, &fileStatus)
	if err != nil {
		errorJSON(w, 404, "upload_not_found", "上传任务不存在")
		return
	}
	if fileStatus != "pending" && fileStatus != "uploaded" {
		errorJSON(w, 409, "file_unavailable", "文件已失效")
		return
	}
	if mode == "library" {
		if !app.authorizeFileScope(w, r, workspaceID, productionID, "write") {
			return
		}
	} else {
		var attachmentID string
		if err = app.db.QueryRow(r.Context(), `SELECT id FROM file_attachments WHERE file_id=$1 AND deleted_at IS NULL`, fileID).Scan(&attachmentID); err != nil {
			errorJSON(w, 404, "upload_not_found", "上传任务不存在")
			return
		}
		a, loadErr := app.loadAttachmentAccess(r.Context(), attachmentID)
		if loadErr != nil || !app.authorizeFileParent(r.Context(), claims(r).Subject, a.Parent, a.SecurityClass, fileUploadVersion) {
			errorJSON(w, 404, "upload_not_found", "上传任务不存在或无权访问")
			return
		}
	}
	if status == "completed" && completedVersion != nil {
		writeJSON(w, 200, map[string]any{"version_id": *completedVersion})
		return
	}
	if status != "pending" {
		errorJSON(w, 409, "upload_not_pending", "上传任务已失效")
		return
	}
	s := app.storageRequired(w)
	if s == nil {
		return
	}
	info, err := s.client.StatObject(r.Context(), bucket, key, minio.StatObjectOptions{})
	if err != nil || info.Size != expected {
		errorJSON(w, 400, "upload_missing", "上传对象不存在或大小不匹配")
		return
	}
	versionID := newID()
	finalKey := immutableKey(workspaceID, versionID)
	if err := app.recordCopyAttempt(r.Context(), workspaceID, s, versionID); err != nil {
		serverError(w, err)
		return
	}
	etag, err := copyImmutableObject(r.Context(), s, bucket, key, strings.Trim(info.ETag, `"`), expected, finalKey)
	if err != nil {
		serverError(w, err)
		return
	}
	committed := false
	defer func() {
		if !committed {
			removeUncommittedCopy(context.Background(), s, finalKey)
		}
	}()
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var txStatus string
	var txVersion *string
	err = tx.QueryRow(r.Context(), `SELECT status,resulting_version_id FROM file_upload_sessions WHERE id=$1 FOR UPDATE`, id).Scan(&txStatus, &txVersion)
	if err != nil {
		serverError(w, err)
		return
	}
	if txStatus == "completed" && txVersion != nil {
		writeJSON(w, 200, map[string]any{"version_id": *txVersion})
		return
	}
	if txStatus != "pending" {
		errorJSON(w, 409, "upload_not_pending", "上传任务已失效")
		return
	}
	var currentVersion *string
	var deletedAt *time.Time
	err = tx.QueryRow(r.Context(), `SELECT current_version_id,deleted_at FROM files WHERE id=$1 AND workspace_id=$2 FOR UPDATE`, fileID, workspaceID).Scan(&currentVersion, &deletedAt)
	if err != nil || deletedAt != nil {
		errorJSON(w, 409, "file_unavailable", "文件已失效")
		return
	}
	var nextNo int
	err = tx.QueryRow(r.Context(), `SELECT COALESCE(MAX(version_no),0)+1 FROM file_versions WHERE file_id=$1`, fileID).Scan(&nextNo)
	if err != nil {
		serverError(w, err)
		return
	}
	_, err = tx.Exec(r.Context(), `INSERT INTO file_versions(id,workspace_id,file_id,version_no,bucket,object_key,filename,content_type,size_bytes,etag,created_by,frozen_at)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())`, versionID, workspaceID, fileID, nextNo, s.bucket, finalKey, filename, contentType, expected, etag, uploader)
	if err != nil {
		serverError(w, err)
		return
	}
	_, err = tx.Exec(r.Context(), `UPDATE files SET status='uploaded',current_version_id=$1,bucket=$2,object_key=$3,filename=$4,content_type=$5,size_bytes=$6,etag=$7,updated_at=NOW() WHERE id=$8`, versionID, s.bucket, finalKey, filename, contentType, expected, etag, fileID)
	if err != nil {
		serverError(w, err)
		return
	}
	_, err = tx.Exec(r.Context(), `UPDATE file_upload_sessions SET status='completed',resulting_version_id=$1 WHERE id=$2`, versionID, id)
	if err != nil {
		serverError(w, err)
		return
	}
	if err = commitCopyAttempt(r.Context(), tx, versionID); err != nil {
		serverError(w, err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	committed = true
	writeJSON(w, 200, map[string]any{"version_id": versionID, "version_no": nextNo})
}
