package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strconv"
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
	ScanStatus    string    `json:"scan_status"`
	SourceFileID  *string   `json:"source_file_id,omitempty"`
	SourceVersion *string   `json:"source_version_id,omitempty"`
}

func immutableKey(workspaceID, versionID string) string {
	return "ws/" + workspaceID + "/versions/" + versionID
}

type idempotentFileUpload struct {
	ID, FileID, StagingKey, Filename, ContentType, Transport, Status, FileStatus string
	ExpectedSize                                                                 int64
	MultipartID                                                                  *string
	ProductionID                                                                 *string
}

func findIdempotentFileUpload(ctx context.Context, db interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, workspaceID, userID, key string) (*idempotentFileUpload, error) {
	var existing idempotentFileUpload
	err := db.QueryRow(ctx, `SELECT s.id,s.file_id,s.staging_key,s.filename,s.content_type,s.expected_size,
		s.transport,s.multipart_upload_id,s.status,f.status,f.production_id
		FROM file_upload_sessions s JOIN files f ON f.id=s.file_id AND f.workspace_id=s.workspace_id
		WHERE s.workspace_id=$1 AND s.created_by=$2 AND s.idempotency_key=$3`, workspaceID, userID, key).
		Scan(&existing.ID, &existing.FileID, &existing.StagingKey, &existing.Filename, &existing.ContentType,
			&existing.ExpectedSize, &existing.Transport, &existing.MultipartID, &existing.Status, &existing.FileStatus, &existing.ProductionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &existing, nil
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
	tag, err := tx.Exec(ctx, `UPDATE file_copy_attempts SET status='committed' WHERE id=$1 AND status='pending' AND object_purged_at IS NULL`, versionID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("file copy attempt %s is no longer publishable", versionID)
	}
	return nil
}

func (app *application) finalizeLegacyFile(ctx context.Context, s *objectStorage, workspaceID, fileID, userID string, f fileLocation, sourceETag string) (bool, error) {
	versionID := newID()
	key := immutableKey(workspaceID, versionID)
	var uploadSessionID string
	if err := app.db.QueryRow(ctx, `SELECT id FROM file_upload_sessions WHERE file_id=$1 AND workspace_id=$2
		AND staging_key=$3 AND created_by=$4 AND status='pending'`, fileID, workspaceID, f.ObjectKey, userID).Scan(&uploadSessionID); err != nil {
		return false, err
	}
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
	if err := ensureWorkspaceStorageAccount(ctx, tx, workspaceID); err != nil {
		return false, err
	}
	if _, err := tx.Exec(ctx, `SELECT 1 FROM workspace_storage_accounts WHERE workspace_id=$1 FOR UPDATE`, workspaceID); err != nil {
		return false, err
	}
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
	_, err = tx.Exec(ctx, `INSERT INTO file_versions(id,workspace_id,file_id,version_no,bucket,object_key,filename,content_type,size_bytes,etag,created_by,frozen_at,policy_max_bytes,allowed_content_types)
		SELECT $1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,NOW(),policy_max_bytes,allowed_content_types
		FROM file_upload_sessions WHERE id=$11`, versionID, workspaceID, fileID, s.bucket, key, f.Filename, contentType, f.SizeBytes, etag, userID, uploadSessionID)
	if err != nil {
		return false, err
	}
	if err := commitUploadReservationTx(ctx, tx, uploadSessionID, versionID, workspaceID, userID, f.SizeBytes); err != nil {
		return false, err
	}
	_, err = tx.Exec(ctx, `UPDATE files SET status='uploaded',bucket=$1,object_key=$2,etag=$3,updated_at=NOW() WHERE id=$4`, s.bucket, key, etag, fileID)
	if err != nil {
		return false, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO file_scan_tasks(id,workspace_id,file_id,version_id,idempotency_key) VALUES($1,$2,$3,$4,$5)`, "scan-"+versionID, workspaceID, fileID, versionID, "version:"+versionID)
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

func (app *application) listVersionsForFile(ctx context.Context, fileID string, limit int, cursor *fileListCursor, fingerprint string) ([]fileVersion, int64, *string, error) {
	var total int64
	if err := app.db.QueryRow(ctx, `SELECT COUNT(*) FROM file_versions WHERE file_id=$1`, fileID).Scan(&total); err != nil {
		return nil, 0, nil, err
	}
	cursorAt := any(nil)
	cursorID := ""
	if cursor != nil {
		cursorAt = cursor.CreatedAt
		cursorID = cursor.ID
	}
	rows, err := app.db.Query(ctx, `SELECT id,file_id,version_no,filename,content_type,size_bytes,created_by,created_at,source_file_id,source_version_id,security_status
		FROM file_versions WHERE file_id=$1 AND ($2::timestamptz IS NULL OR (created_at,id)<($2::timestamptz,$3)) ORDER BY created_at DESC,id DESC LIMIT $4`, fileID, cursorAt, cursorID, limit+1)
	if err != nil {
		return nil, 0, nil, err
	}
	defer rows.Close()
	items := []fileVersion{}
	for rows.Next() {
		var v fileVersion
		var securityStatus string
		if err := rows.Scan(&v.ID, &v.FileID, &v.VersionNo, &v.Filename, &v.ContentType, &v.SizeBytes, &v.CreatedBy, &v.CreatedAt, &v.SourceFileID, &v.SourceVersion, &securityStatus); err != nil {
			return nil, 0, nil, err
		}
		v.ScanStatus = publicScanStatus(securityStatus)
		items = append(items, v)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, nil, err
	}
	var next *string
	if len(items) > limit {
		last := items[limit-1]
		encoded := encodeFileListCursor(last.CreatedAt, last.ID, fingerprint)
		next = &encoded
		items = items[:limit]
	}
	return items, total, next, nil
}

func (app *application) createFileUploadSession(ctx context.Context, s *objectStorage, workspaceID, fileID, userID, filename, contentType string, size int64, policy fileUploadPolicy, idempotencyKey string) (map[string]any, error) {
	if err := validateFileUploadSize(policy, size, s.maxBytes); err != nil {
		return nil, err
	}
	if policy.MaxBytes <= 0 {
		policy.MaxBytes = hardMaxFileBytes
	}
	allowedTypes, err := json.Marshal(policy.AllowedContentTypes)
	if err != nil {
		return nil, err
	}
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if len(idempotencyKey) > 200 {
		return nil, storageError(http.StatusBadRequest, "invalid_idempotency_key", "上传请求标识无效")
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	tx, err := app.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "file-upload-user:"+userID); err != nil {
		return nil, err
	}
	if idempotencyKey != "" {
		var existingID, existingFileID, existingBucket, existingKey, existingTransport, existingStatus string
		var existingExpected int64
		var multipartID *string
		var existingExpires time.Time
		err = tx.QueryRow(ctx, `SELECT id,file_id,staging_bucket,staging_key,expected_size,transport,multipart_upload_id,status,expires_at
			FROM file_upload_sessions WHERE workspace_id=$1 AND created_by=$2 AND idempotency_key=$3`, workspaceID, userID, idempotencyKey).
			Scan(&existingID, &existingFileID, &existingBucket, &existingKey, &existingExpected, &existingTransport, &multipartID, &existingStatus, &existingExpires)
		if err == nil {
			if existingFileID != fileID {
				return nil, storageError(http.StatusConflict, "idempotency_conflict", "该上传请求标识已用于其他文件")
			}
			if existingExpected != size {
				return nil, storageError(http.StatusConflict, "idempotency_conflict", "同一上传请求标识不能用于不同文件大小")
			}
			if existingStatus == "completed" {
				if err := tx.Commit(ctx); err != nil {
					return nil, err
				}
				return map[string]any{"id": existingID, "upload_id": existingID, "transport": "completed"}, nil
			}
			if existingStatus != "pending" || !existingExpires.After(time.Now()) {
				return nil, storageError(http.StatusConflict, "upload_session_expired", "上传会话已结束，请重新选择文件开始上传")
			}
			linkTTL := min(s.ttl, time.Until(existingExpires))
			if _, err := tx.Exec(ctx, `UPDATE file_upload_sessions SET upload_url_expires_at=NOW()+$2::interval WHERE id=$1`, existingID, linkTTL.String()); err != nil {
				return nil, err
			}
			if err := tx.Commit(ctx); err != nil {
				return nil, err
			}
			limitedStorage := *s
			limitedStorage.ttl = linkTTL
			upload, descriptorErr := app.uploadTransportDescriptor(ctx, &limitedStorage, existingBucket, existingID, existingKey, existingExpected, existingTransport, multipartID)
			if descriptorErr == nil {
				upload["session_expires_in"] = int64(uploadSessionLifetime.Seconds())
			}
			return upload, descriptorErr
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
	}
	if err := ensureWorkspaceStorageAccount(ctx, tx, workspaceID); err != nil {
		return nil, err
	}
	id := newID()
	key := "ws/" + workspaceID + "/staging/" + id
	transport := "post"
	if size > postUploadMaxBytes {
		transport = "multipart"
	}
	_, err = tx.Exec(ctx, `INSERT INTO file_upload_sessions(id,workspace_id,file_id,created_by,staging_bucket,staging_key,expected_size,filename,content_type,expires_at,transport,idempotency_key,policy_max_bytes,allowed_content_types,upload_url_expires_at)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()+$10::interval,$11,NULLIF($12,''),$13,$14::jsonb,NOW()+$15::interval)`, id, workspaceID, fileID, userID, s.stagingBucket, key, size, filename, contentType, uploadSessionLifetime.String(), transport, idempotencyKey, policy.MaxBytes, allowedTypes, s.ttl.String())
	if err != nil {
		return nil, err
	}
	_, err = tx.Exec(ctx, `UPDATE files SET bucket=$2,object_key=$3
		WHERE id=$1 AND status='pending' AND current_version_id IS NULL`, fileID, s.stagingBucket, key)
	if err != nil {
		return nil, err
	}
	physicalReservation := size * 2
	if err := reserveUploadStorageTx(ctx, tx, workspaceID, userID, id, idempotencyKey, size, physicalReservation, s.physicalMaxBytes); err != nil {
		return nil, err
	}
	var multipartID *string
	if transport == "multipart" {
		createdID, createErr := s.core.NewMultipartUpload(ctx, s.stagingBucket, key, minio.PutObjectOptions{Checksum: minio.ChecksumSHA256})
		if createErr != nil {
			return nil, fmt.Errorf("start multipart upload: %w", createErr)
		}
		multipartID = &createdID
		if _, err := tx.Exec(ctx, `UPDATE file_upload_sessions SET multipart_upload_id=$2 WHERE id=$1`, id, createdID); err != nil {
			_ = s.core.AbortMultipartUpload(context.Background(), s.stagingBucket, key, createdID)
			return nil, err
		}
	}
	upload, err := app.uploadTransportDescriptor(ctx, s, s.stagingBucket, id, key, size, transport, multipartID)
	if err != nil {
		if multipartID != nil {
			_ = s.core.AbortMultipartUpload(context.Background(), s.stagingBucket, key, *multipartID)
		}
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		if multipartID != nil {
			_ = s.core.AbortMultipartUpload(context.Background(), s.stagingBucket, key, *multipartID)
		}
		return nil, err
	}
	upload["id"], upload["upload_id"] = id, id
	upload["session_expires_in"] = int64(uploadSessionLifetime.Seconds())
	return upload, nil
}

func (app *application) uploadTransportDescriptor(ctx context.Context, s *objectStorage, bucket, id, key string, size int64, transport string, multipartID *string) (map[string]any, error) {
	if transport == "legacy_put" {
		u, err := s.presignClient.PresignedPutObject(ctx, bucket, key, s.ttl)
		if err != nil {
			return nil, err
		}
		return map[string]any{"id": id, "upload_id": id, "transport": "legacy_put", "url": u.String(), "method": "PUT", "expires_in": int64(s.ttl.Seconds())}, nil
	}
	if transport == "post" {
		policy := minio.NewPostPolicy()
		if err := policy.SetBucket(bucket); err != nil {
			return nil, err
		}
		if err := policy.SetKey(key); err != nil {
			return nil, err
		}
		if err := policy.SetExpires(time.Now().Add(s.ttl)); err != nil {
			return nil, err
		}
		if err := policy.SetContentLengthRange(size, size); err != nil {
			return nil, err
		}
		u, fields, err := s.presignClient.PresignedPostPolicy(ctx, policy)
		if err != nil {
			return nil, err
		}
		return map[string]any{"id": id, "upload_id": id, "transport": "post", "url": u.String(), "method": "POST", "fields": fields, "expires_in": int64(s.ttl.Seconds())}, nil
	}
	if transport == "multipart" && multipartID != nil {
		parts := int(math.Ceil(float64(size) / float64(multipartPartBytes)))
		return map[string]any{"id": id, "upload_id": id, "transport": "multipart", "method": "PUT", "part_size": multipartPartBytes, "part_count": parts, "expires_in": int64(s.ttl.Seconds())}, nil
	}
	return nil, fmt.Errorf("unsupported upload transport %q", transport)
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
	fingerprint := fileFilterFingerprint("file_versions", r.PathValue("id"), id)
	limit, cursor, pageErr := filePageParameters(r, fingerprint)
	if pageErr != nil {
		errorJSON(w, http.StatusBadRequest, "invalid_pagination", pageErr.Error())
		return
	}
	items, total, next, err := app.listVersionsForFile(r.Context(), id, limit, cursor, fingerprint)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items, "total": total, "next_cursor": next})
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
	policy := fileUploadPolicy{MaxBytes: s.maxBytes}
	if err := validateFileUploadSize(policy, in.SizeBytes, s.maxBytes); err != nil {
		writeFileStorageError(w, err)
		return
	}
	if in.ContentType == "" {
		in.ContentType = "application/octet-stream"
	}
	u, err := app.createFileUploadSession(r.Context(), s, r.PathValue("id"), id, claims(r).Subject, cleanFilename(in.Filename), in.ContentType, in.SizeBytes, policy, r.Header.Get("Idempotency-Key"))
	if err != nil {
		if !writeFileStorageError(w, err) {
			serverError(w, err)
		}
		return
	}
	writeJSON(w, 201, map[string]any{"upload": u})
}

func (app *application) downloadFileVersion(w http.ResponseWriter, r *http.Request) {
	id, ok := app.authorizeVersionFile(w, r, fileDownload)
	if !ok {
		return
	}
	app.presignVersion(w, r, id, r.PathValue("versionId"), nil)
}

func (app *application) presignVersion(w http.ResponseWriter, r *http.Request, fileID, versionID string, audit *attachmentAccess) bool {
	var bucket, key, filename, sha256, etag string
	var sizeBytes int64
	err := app.db.QueryRow(r.Context(), `SELECT bucket,object_key,filename,size_bytes,sha256,etag FROM file_versions WHERE id=$1 AND file_id=$2 AND security_status='clean' AND object_purged_at IS NULL`, versionID, fileID).Scan(&bucket, &key, &filename, &sizeBytes, &sha256, &etag)
	if err != nil {
		errorJSON(w, 404, "version_not_found", "文件版本不存在")
		return false
	}
	s := app.storageRequired(w)
	if s == nil {
		return false
	}
	u, err := s.presignClient.PresignedGetObject(r.Context(), bucket, key, 5*time.Minute, url.Values{"response-content-disposition": []string{"attachment; filename=\"" + strings.ReplaceAll(filename, `"`, "") + "\""}})
	if err != nil {
		serverError(w, err)
		return false
	}
	if audit != nil {
		if err := app.recordSensitiveFileEvent(r.Context(), r, claims(r).Subject, "download_granted", "allowed", "parent_permission", *audit, versionID); err != nil {
			serverError(w, err)
			return false
		}
	}
	writeJSON(w, 200, map[string]any{"url": u.String(), "expires_in": 300, "version_id": versionID,
		"filename": filename, "size_bytes": sizeBytes, "sha256": sha256, "etag": etag})
	return true
}

func publicScanStatus(status string) string {
	switch status {
	case "clean":
		return "ready"
	case "pending", "":
		return "processing"
	default:
		return "rejected"
	}
}

func (app *application) getFileUploadSessionStatus(w http.ResponseWriter, r *http.Request) {
	var owner, sessionStatus, fileID, transport string
	var versionID *string
	var expiresAt time.Time
	var expectedSize int64
	err := app.db.QueryRow(r.Context(), `SELECT created_by,status,resulting_version_id,file_id,transport,expires_at,expected_size FROM file_upload_sessions WHERE id=$1`, r.PathValue("uploadId")).Scan(&owner, &sessionStatus, &versionID, &fileID, &transport, &expiresAt, &expectedSize)
	if err != nil || owner != claims(r).Subject {
		errorJSON(w, 404, "upload_not_found", "上传任务不存在")
		return
	}
	status := "processing"
	phase := "awaiting_upload"
	if sessionStatus == "abandoned" || sessionStatus == "cancelled" {
		status = "rejected"
		if sessionStatus == "abandoned" {
			phase = "expired"
		} else {
			phase = "cancelled"
		}
	} else if sessionStatus == "pending" && !expiresAt.After(time.Now()) {
		status = "rejected"
		phase = "expired"
	} else if sessionStatus == "completed" && versionID != nil {
		var securityStatus string
		if err := app.db.QueryRow(r.Context(), `SELECT security_status FROM file_versions WHERE id=$1`, *versionID).Scan(&securityStatus); err != nil {
			errorJSON(w, 404, "upload_not_found", "上传任务不存在")
			return
		}
		status = publicScanStatus(securityStatus)
		phase = map[string]string{"ready": "ready", "rejected": "scan_rejected"}[status]
		if status == "processing" {
			phase = "scanning"
		}
	}
	writeJSON(w, 200, map[string]any{"upload_id": r.PathValue("uploadId"), "status": status, "phase": phase,
		"file_id": fileID, "version_id": versionID, "transport": transport, "expected_size": expectedSize,
		"expires_at": expiresAt})
}

func (app *application) signFileUploadPart(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("uploadId")
	partNumber, err := strconv.Atoi(r.PathValue("partNumber"))
	if err != nil || partNumber < 1 {
		errorJSON(w, http.StatusBadRequest, "invalid_part_number", "分段编号无效")
		return
	}
	var workspaceID, fileID, uploader, bucket, key, transport, status string
	var sessionExpires time.Time
	var size int64
	var multipartID *string
	err = app.db.QueryRow(r.Context(), `SELECT workspace_id,file_id,created_by,staging_bucket,staging_key,
		expected_size,transport,multipart_upload_id,status,expires_at FROM file_upload_sessions WHERE id=$1`, id).
		Scan(&workspaceID, &fileID, &uploader, &bucket, &key, &size, &transport, &multipartID, &status, &sessionExpires)
	if err != nil || uploader != claims(r).Subject {
		errorJSON(w, http.StatusNotFound, "upload_not_found", "上传任务不存在")
		return
	}
	if transport != "multipart" || multipartID == nil || status != "pending" || !sessionExpires.After(time.Now()) {
		errorJSON(w, http.StatusConflict, "upload_not_pending", "上传任务不可继续")
		return
	}
	var productionID *string
	var mode string
	if err := app.db.QueryRow(r.Context(), `SELECT production_id,access_mode FROM files WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`, fileID, workspaceID).Scan(&productionID, &mode); err != nil {
		errorJSON(w, http.StatusNotFound, "upload_not_found", "上传任务不存在")
		return
	}
	if mode == "library" {
		if !app.authorizeFileScope(w, r, workspaceID, productionID, "write") {
			return
		}
	} else {
		var attachmentID string
		if err := app.db.QueryRow(r.Context(), `SELECT id FROM file_attachments WHERE file_id=$1 AND deleted_at IS NULL`, fileID).Scan(&attachmentID); err != nil {
			errorJSON(w, http.StatusNotFound, "upload_not_found", "上传任务不存在")
			return
		}
		a, loadErr := app.loadAttachmentAccess(r.Context(), attachmentID)
		if loadErr != nil || !app.authorizeFileParent(r.Context(), claims(r).Subject, a.Parent, a.SecurityClass, fileUploadVersion) {
			errorJSON(w, http.StatusNotFound, "upload_not_found", "上传任务不存在或无权访问")
			return
		}
	}
	partCount := int(math.Ceil(float64(size) / float64(multipartPartBytes)))
	if partNumber > partCount {
		errorJSON(w, http.StatusBadRequest, "invalid_part_number", "分段编号超出文件范围")
		return
	}
	var in struct {
		SHA256 string `json:"sha256"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	checksumBytes, err := base64.StdEncoding.DecodeString(in.SHA256)
	if err != nil || len(checksumBytes) != 32 {
		errorJSON(w, http.StatusBadRequest, "invalid_part_checksum", "分段 SHA-256 校验值无效")
		return
	}
	partSize := multipartPartBytes
	if final := size - int64(partNumber-1)*multipartPartBytes; final < partSize {
		partSize = final
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var lockedStatus string
	var lockedExpiry time.Time
	if err := tx.QueryRow(r.Context(), `SELECT status,expires_at FROM file_upload_sessions WHERE id=$1 FOR UPDATE`, id).Scan(&lockedStatus, &lockedExpiry); err != nil || lockedStatus != "pending" || !lockedExpiry.After(time.Now()) {
		errorJSON(w, http.StatusConflict, "upload_not_pending", "上传任务不可继续")
		return
	}
	_, err = tx.Exec(r.Context(), `INSERT INTO file_upload_session_parts(upload_session_id,part_number,expected_size,sha256_base64)
		VALUES($1,$2,$3,$4) ON CONFLICT(upload_session_id,part_number) DO UPDATE SET
		expected_size=EXCLUDED.expected_size,sha256_base64=EXCLUDED.sha256_base64,updated_at=NOW()`, id, partNumber, partSize, in.SHA256)
	if err != nil {
		serverError(w, err)
		return
	}
	s := app.storageRequired(w)
	if s == nil {
		return
	}
	linkTTL := min(s.ttl, time.Until(lockedExpiry))
	if linkTTL <= 0 {
		errorJSON(w, http.StatusConflict, "upload_not_pending", "上传任务已过期")
		return
	}
	if _, err := tx.Exec(r.Context(), `UPDATE file_upload_sessions SET upload_url_expires_at=NOW()+$2::interval
		WHERE id=$1 AND status='pending'`, id, linkTTL.String()); err != nil {
		serverError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	params := url.Values{"uploadId": []string{*multipartID}, "partNumber": []string{strconv.Itoa(partNumber)}}
	headers := http.Header{
		"X-Amz-Checksum-Sha256": []string{in.SHA256},
		"Content-Length":        []string{strconv.FormatInt(partSize, 10)},
	}
	u, err := s.presignClient.PresignHeader(r.Context(), http.MethodPut, bucket, key, linkTTL, params, headers)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"url": u.String(), "method": http.MethodPut, "headers": map[string]string{"x-amz-checksum-sha256": in.SHA256}, "part_number": partNumber, "size_bytes": partSize, "expires_in": int64(linkTTL.Seconds())})
}

func (app *application) listVerifiedUploadParts(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("uploadId")
	var workspaceID, fileID, uploader, bucket, key, transport, status string
	var size int64
	var multipartID *string
	var expiresAt time.Time
	err := app.db.QueryRow(r.Context(), `SELECT workspace_id,file_id,created_by,staging_bucket,staging_key,
		expected_size,transport,multipart_upload_id,status,expires_at FROM file_upload_sessions WHERE id=$1`, id).
		Scan(&workspaceID, &fileID, &uploader, &bucket, &key, &size, &transport, &multipartID, &status, &expiresAt)
	if err != nil || uploader != claims(r).Subject {
		errorJSON(w, http.StatusNotFound, "upload_not_found", "上传任务不存在")
		return
	}
	if transport != "multipart" || multipartID == nil || status != "pending" || !expiresAt.After(time.Now()) {
		errorJSON(w, http.StatusConflict, "upload_not_pending", "上传任务不可继续")
		return
	}
	var productionID *string
	var mode string
	if err := app.db.QueryRow(r.Context(), `SELECT production_id,access_mode FROM files WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`, fileID, workspaceID).Scan(&productionID, &mode); err != nil {
		errorJSON(w, http.StatusNotFound, "upload_not_found", "上传任务不存在")
		return
	}
	if mode == "library" {
		if !app.authorizeFileScope(w, r, workspaceID, productionID, "write") {
			return
		}
	} else {
		var attachmentID string
		if err := app.db.QueryRow(r.Context(), `SELECT id FROM file_attachments WHERE file_id=$1 AND deleted_at IS NULL`, fileID).Scan(&attachmentID); err != nil {
			errorJSON(w, http.StatusNotFound, "upload_not_found", "上传任务不存在")
			return
		}
		a, loadErr := app.loadAttachmentAccess(r.Context(), attachmentID)
		if loadErr != nil || !app.authorizeFileParent(r.Context(), claims(r).Subject, a.Parent, a.SecurityClass, fileUploadVersion) {
			errorJSON(w, http.StatusNotFound, "upload_not_found", "上传任务不存在或无权访问")
			return
		}
	}
	s := app.storageRequired(w)
	if s == nil {
		return
	}
	parts, err := s.core.ListObjectParts(r.Context(), bucket, key, *multipartID, 0, 1000)
	if err != nil {
		serverError(w, err)
		return
	}
	actual := map[int]minio.ObjectPart{}
	for _, part := range parts.ObjectParts {
		actual[part.PartNumber] = part
	}
	for parts.IsTruncated {
		parts, err = s.core.ListObjectParts(r.Context(), bucket, key, *multipartID, parts.NextPartNumberMarker, 1000)
		if err != nil {
			serverError(w, err)
			return
		}
		for _, part := range parts.ObjectParts {
			actual[part.PartNumber] = part
		}
	}
	rows, err := app.db.Query(r.Context(), `SELECT part_number,expected_size,sha256_base64 FROM file_upload_session_parts WHERE upload_session_id=$1`, id)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	verified := []map[string]any{}
	for rows.Next() {
		var number int
		var expectedSize int64
		var checksum string
		if err := rows.Scan(&number, &expectedSize, &checksum); err != nil {
			serverError(w, err)
			return
		}
		part, ok := actual[number]
		if ok && part.Size == expectedSize && part.ChecksumSHA256 == checksum {
			verified = append(verified, map[string]any{"part_number": number, "size_bytes": part.Size, "sha256": checksum})
		}
	}
	if err := rows.Err(); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": verified, "total": len(verified), "expected_size": size})
}

func (app *application) completeMultipartStagingObject(ctx context.Context, s *objectStorage, sessionID, uploadID, bucket, key string, size int64) (minio.UploadInfo, error) {
	partCount := int(math.Ceil(float64(size) / float64(multipartPartBytes)))
	rows, err := s.core.ListObjectParts(ctx, bucket, key, uploadID, 0, 1000)
	if err != nil {
		return minio.UploadInfo{}, err
	}
	partsByNumber := make(map[int]minio.ObjectPart, partCount)
	for _, part := range rows.ObjectParts {
		partsByNumber[part.PartNumber] = part
	}
	for rows.IsTruncated {
		rows, err = s.core.ListObjectParts(ctx, bucket, key, uploadID, rows.NextPartNumberMarker, 1000)
		if err != nil {
			return minio.UploadInfo{}, err
		}
		for _, part := range rows.ObjectParts {
			partsByNumber[part.PartNumber] = part
		}
	}
	if len(partsByNumber) != partCount {
		return minio.UploadInfo{}, storageError(http.StatusConflict, "multipart_incomplete", "仍有文件分段未上传")
	}
	manifestRows, err := app.db.Query(ctx, `SELECT part_number,expected_size,sha256_base64 FROM file_upload_session_parts
		WHERE upload_session_id=$1 ORDER BY part_number`, sessionID)
	if err != nil {
		return minio.UploadInfo{}, err
	}
	defer manifestRows.Close()
	completeParts := make([]minio.CompletePart, 0, partCount)
	for expectedPart := 1; expectedPart <= partCount; expectedPart++ {
		var number int
		var expectedSize int64
		var expectedSHA256 string
		if !manifestRows.Next() {
			return minio.UploadInfo{}, storageError(http.StatusConflict, "multipart_incomplete", "文件分段校验信息不完整")
		}
		if err := manifestRows.Scan(&number, &expectedSize, &expectedSHA256); err != nil {
			return minio.UploadInfo{}, err
		}
		part, ok := partsByNumber[expectedPart]
		if !ok || number != expectedPart || part.PartNumber != expectedPart || part.Size != expectedSize || part.ChecksumSHA256 == "" || part.ChecksumSHA256 != expectedSHA256 {
			return minio.UploadInfo{}, storageError(http.StatusConflict, "multipart_part_mismatch", "文件分段大小或校验值不匹配")
		}
		completeParts = append(completeParts, minio.CompletePart{PartNumber: part.PartNumber, ETag: part.ETag, ChecksumSHA256: part.ChecksumSHA256})
	}
	if manifestRows.Next() {
		return minio.UploadInfo{}, storageError(http.StatusConflict, "multipart_part_mismatch", "存在超出预期的文件分段")
	}
	if err := manifestRows.Err(); err != nil {
		return minio.UploadInfo{}, err
	}
	return s.core.CompleteMultipartUpload(ctx, bucket, key, uploadID, completeParts, minio.PutObjectOptions{})
}

func (app *application) cancelFileUploadSession(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("uploadId")
	var workspaceID, fileID, uploader string
	var status string
	err := app.db.QueryRow(r.Context(), `SELECT workspace_id,file_id,created_by,status FROM file_upload_sessions WHERE id=$1`, id).
		Scan(&workspaceID, &fileID, &uploader, &status)
	if err != nil || uploader != claims(r).Subject {
		errorJSON(w, http.StatusNotFound, "upload_not_found", "上传任务不存在")
		return
	}
	var productionID *string
	var mode string
	if err := app.db.QueryRow(r.Context(), `SELECT production_id,access_mode FROM files WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`, fileID, workspaceID).Scan(&productionID, &mode); err != nil {
		errorJSON(w, http.StatusNotFound, "upload_not_found", "上传任务不存在")
		return
	}
	if mode == "library" {
		if !app.authorizeFileScope(w, r, workspaceID, productionID, "write") {
			return
		}
	} else {
		var attachmentID string
		if err := app.db.QueryRow(r.Context(), `SELECT id FROM file_attachments WHERE file_id=$1 AND deleted_at IS NULL`, fileID).Scan(&attachmentID); err != nil {
			errorJSON(w, http.StatusNotFound, "upload_not_found", "上传任务不存在")
			return
		}
		a, loadErr := app.loadAttachmentAccess(r.Context(), attachmentID)
		if loadErr != nil || !app.authorizeFileParent(r.Context(), claims(r).Subject, a.Parent, a.SecurityClass, fileUploadVersion) {
			errorJSON(w, http.StatusNotFound, "upload_not_found", "上传任务不存在或无权访问")
			return
		}
	}
	if status == "completed" {
		writeJSON(w, http.StatusOK, map[string]string{"upload_id": id, "status": "completed"})
		return
	}
	if status == "cancelled" || status == "abandoned" {
		writeJSON(w, http.StatusOK, map[string]string{"upload_id": id, "status": status})
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	if _, err := tx.Exec(r.Context(), `SELECT 1 FROM workspace_storage_accounts WHERE workspace_id=$1 FOR UPDATE`, workspaceID); err != nil {
		serverError(w, err)
		return
	}
	var lockedStatus string
	if err := tx.QueryRow(r.Context(), `SELECT status FROM file_upload_sessions WHERE id=$1 FOR UPDATE`, id).Scan(&lockedStatus); err != nil {
		serverError(w, err)
		return
	}
	if lockedStatus == "pending" {
		if _, err := tx.Exec(r.Context(), `UPDATE file_upload_sessions SET status='cancelled',cancelled_at=NOW() WHERE id=$1`, id); err != nil {
			serverError(w, err)
			return
		}
		if err := releaseSessionQuotaTx(r.Context(), tx, id, claims(r).Subject, workspaceID); err != nil {
			serverError(w, err)
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"upload_id": id, "status": "cancelled"})
}

func (app *application) completeFileUploadSession(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("uploadId")
	var fileID, workspaceID, uploader, bucket, key, filename, contentType, status, transport string
	var expected int64
	var sessionExpires time.Time
	var completedVersion *string
	var multipartID *string
	err := app.db.QueryRow(r.Context(), `SELECT file_id,workspace_id,created_by,staging_bucket,staging_key,filename,content_type,expected_size,status,resulting_version_id,transport,multipart_upload_id,expires_at
		FROM file_upload_sessions WHERE id=$1`, id).Scan(&fileID, &workspaceID, &uploader, &bucket, &key, &filename, &contentType, &expected, &status, &completedVersion, &transport, &multipartID, &sessionExpires)
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
	currentPolicy := fileUploadPolicy{MaxBytes: hardMaxFileBytes}
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
		adapter := app.fileParentAdapter(a.Parent.Kind)
		if adapter == nil {
			errorJSON(w, http.StatusNotFound, "upload_not_found", "上传任务不存在")
			return
		}
		currentPolicy, err = adapter.UploadPolicy(r.Context(), a.Parent)
		if err != nil {
			serverError(w, err)
			return
		}
	}
	if status == "completed" && completedVersion != nil {
		var securityStatus string
		if err := app.db.QueryRow(r.Context(), `SELECT security_status FROM file_versions WHERE id=$1`, *completedVersion).Scan(&securityStatus); err != nil {
			serverError(w, err)
			return
		}
		writeJSON(w, http.StatusAccepted, map[string]any{"version_id": *completedVersion, "status": publicScanStatus(securityStatus)})
		return
	}
	if status != "pending" || !sessionExpires.After(time.Now()) {
		errorJSON(w, 409, "upload_not_pending", "上传任务已失效")
		return
	}
	s := app.storageRequired(w)
	if s == nil {
		return
	}
	if err := validateFileUploadSize(currentPolicy, expected, s.maxBytes); err != nil {
		writeFileStorageError(w, err)
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, fmt.Errorf("begin upload completion: %w", err))
		return
	}
	defer tx.Rollback(r.Context())
	if err := ensureWorkspaceStorageAccount(r.Context(), tx, workspaceID); err != nil {
		serverError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `SELECT 1 FROM workspace_storage_accounts WHERE workspace_id=$1 FOR UPDATE`, workspaceID); err != nil {
		serverError(w, err)
		return
	}
	var txStatus string
	var txVersion *string
	var txExpires time.Time
	if err := tx.QueryRow(r.Context(), `SELECT status,resulting_version_id,expires_at FROM file_upload_sessions WHERE id=$1 FOR UPDATE`, id).Scan(&txStatus, &txVersion, &txExpires); err != nil {
		serverError(w, fmt.Errorf("lock upload session: %w", err))
		return
	}
	if txStatus == "completed" && txVersion != nil {
		var securityStatus string
		if err := tx.QueryRow(r.Context(), `SELECT security_status FROM file_versions WHERE id=$1`, *txVersion).Scan(&securityStatus); err != nil {
			serverError(w, fmt.Errorf("read completed upload status: %w", err))
			return
		}
		writeJSON(w, http.StatusAccepted, map[string]any{"version_id": *txVersion, "status": publicScanStatus(securityStatus)})
		return
	}
	if txStatus != "pending" || !txExpires.After(time.Now()) {
		errorJSON(w, 409, "upload_not_pending", "上传任务已失效")
		return
	}
	var currentVersion *string
	var deletedAt *time.Time
	if err := tx.QueryRow(r.Context(), `SELECT current_version_id,deleted_at FROM files WHERE id=$1 AND workspace_id=$2 FOR UPDATE`, fileID, workspaceID).Scan(&currentVersion, &deletedAt); err != nil || deletedAt != nil {
		errorJSON(w, 409, "file_unavailable", "文件已失效")
		return
	}
	if transport == "multipart" {
		if multipartID == nil {
			errorJSON(w, http.StatusConflict, "multipart_upload_missing", "分段上传会话无效")
			return
		}
		if _, err := app.completeMultipartStagingObject(r.Context(), s, id, *multipartID, bucket, key, expected); err != nil {
			// A previous completion may have atomically assembled the staging
			// object but failed before its database commit. That object is still
			// server-owned and can safely resume the immutable-copy step.
			staging, statErr := s.client.StatObject(r.Context(), bucket, key, minio.StatObjectOptions{})
			if statErr != nil || staging.Size != expected {
				if !writeFileStorageError(w, err) {
					serverError(w, err)
				}
				return
			}
		}
	}
	info, err := s.client.StatObject(r.Context(), bucket, key, minio.StatObjectOptions{})
	if err != nil || info.Size != expected || info.Size > s.maxBytes || info.Size > hardMaxFileBytes || currentPolicy.MaxBytes > 0 && info.Size > currentPolicy.MaxBytes {
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
	var nextNo int
	err = tx.QueryRow(r.Context(), `SELECT COALESCE(MAX(version_no),0)+1 FROM file_versions WHERE file_id=$1`, fileID).Scan(&nextNo)
	if err != nil {
		serverError(w, fmt.Errorf("allocate file version number: %w", err))
		return
	}
	_, err = tx.Exec(r.Context(), `INSERT INTO file_versions(id,workspace_id,file_id,version_no,bucket,object_key,filename,content_type,size_bytes,etag,created_by,frozen_at,policy_max_bytes,allowed_content_types)
		SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),policy_max_bytes,allowed_content_types
		FROM file_upload_sessions WHERE id=$12`, versionID, workspaceID, fileID, nextNo, s.bucket, finalKey, filename, contentType, expected, etag, uploader, id)
	if err != nil {
		serverError(w, fmt.Errorf("insert file version: %w", err))
		return
	}
	if err = commitUploadReservationTx(r.Context(), tx, id, versionID, workspaceID, uploader, expected); err != nil {
		serverError(w, fmt.Errorf("settle upload quota reservation: %w", err))
		return
	}
	_, err = tx.Exec(r.Context(), `UPDATE files SET status='uploaded',
		bucket=CASE WHEN current_version_id IS NULL THEN $1 ELSE bucket END,
		object_key=CASE WHEN current_version_id IS NULL THEN $2 ELSE object_key END,
		filename=CASE WHEN current_version_id IS NULL THEN $3 ELSE filename END,
		content_type=CASE WHEN current_version_id IS NULL THEN $4 ELSE content_type END,
		size_bytes=CASE WHEN current_version_id IS NULL THEN $5 ELSE size_bytes END,
		etag=CASE WHEN current_version_id IS NULL THEN $6 ELSE etag END,updated_at=NOW() WHERE id=$7`, s.bucket, finalKey, filename, contentType, expected, etag, fileID)
	if err != nil {
		serverError(w, fmt.Errorf("update file after upload: %w", err))
		return
	}
	_, err = tx.Exec(r.Context(), `INSERT INTO file_scan_tasks(id,workspace_id,file_id,version_id,idempotency_key) VALUES($1,$2,$3,$4,$5)`, "scan-"+versionID, workspaceID, fileID, versionID, "version:"+versionID)
	if err != nil {
		serverError(w, fmt.Errorf("enqueue file scan: %w", err))
		return
	}
	_, err = tx.Exec(r.Context(), `UPDATE file_upload_sessions SET status='completed',resulting_version_id=$1 WHERE id=$2`, versionID, id)
	if err != nil {
		serverError(w, fmt.Errorf("complete upload session: %w", err))
		return
	}
	if err = commitCopyAttempt(r.Context(), tx, versionID); err != nil {
		serverError(w, fmt.Errorf("commit immutable object record: %w", err))
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		serverError(w, fmt.Errorf("commit upload completion: %w", err))
		return
	}
	committed = true
	writeJSON(w, http.StatusAccepted, map[string]any{"version_id": versionID, "version_no": nextNo, "status": "processing"})
}
