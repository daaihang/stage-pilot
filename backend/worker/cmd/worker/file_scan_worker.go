package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

const defaultMaxFileBytes int64 = 2_000_000_000

type scanTask struct {
	ID, WorkspaceID, FileID, VersionID, Bucket, ObjectKey, Filename, DeclaredType string
	SizeBytes                                                                     int64
	PolicyMaxBytes                                                                int64
	AllowedContentTypes                                                           []string
	Attempts                                                                      int
}

func newWorkerStorageClient() (*minio.Client, error) {
	endpoint := strings.TrimPrefix(strings.TrimPrefix(os.Getenv("S3_ENDPOINT"), "http://"), "https://")
	if endpoint == "" {
		return nil, errors.New("S3_ENDPOINT is not configured")
	}
	return minio.New(endpoint, &minio.Options{
		Creds:        credentials.NewStaticV4(os.Getenv("S3_ACCESS_KEY"), os.Getenv("S3_SECRET_KEY"), ""),
		Secure:       os.Getenv("S3_USE_SSL") == "true",
		Region:       envOrDefault("S3_REGION", "us-east-1"),
		BucketLookup: minio.BucketLookupPath,
	})
}

func maxFileBytesFromEnv() int64 {
	if n, err := strconv.ParseInt(os.Getenv("FILES_MAX_BYTES"), 10, 64); err == nil && n > 0 {
		return min(n, defaultMaxFileBytes)
	}
	return defaultMaxFileBytes
}

func claimFileScanTask(ctx context.Context, db *pgxpool.Pool, owner string) (scanTask, error) {
	var task scanTask
	var allowedTypes []byte
	err := db.QueryRow(ctx, `WITH candidate AS (
		SELECT t.id FROM file_scan_tasks t
		JOIN file_versions v ON v.id=t.version_id AND v.workspace_id=t.workspace_id
		WHERE v.frozen_at IS NOT NULL
		  AND ((t.status='pending' AND t.available_at <= NOW()) OR (t.status='leased' AND t.lease_until < NOW()))
		ORDER BY t.available_at,t.created_at,t.id
		FOR UPDATE OF t SKIP LOCKED LIMIT 1
	), claimed AS (
		UPDATE file_scan_tasks t SET status='leased',attempts=t.attempts+1,lease_owner=$1,
			lease_until=NOW()+INTERVAL '20 minutes',updated_at=NOW()
		FROM candidate c WHERE t.id=c.id
		RETURNING t.id,t.workspace_id,t.file_id,t.version_id,t.attempts
	)
	SELECT c.id,c.workspace_id,c.file_id,c.version_id,v.bucket,v.object_key,v.filename,v.content_type,v.size_bytes,
		v.policy_max_bytes,v.allowed_content_types,c.attempts
	FROM claimed c JOIN file_versions v ON v.id=c.version_id`, owner).Scan(
		&task.ID, &task.WorkspaceID, &task.FileID, &task.VersionID, &task.Bucket, &task.ObjectKey, &task.Filename, &task.DeclaredType, &task.SizeBytes, &task.PolicyMaxBytes, &allowedTypes, &task.Attempts)
	if err == nil && len(allowedTypes) > 0 {
		if unmarshalErr := json.Unmarshal(allowedTypes, &task.AllowedContentTypes); unmarshalErr != nil {
			return scanTask{}, unmarshalErr
		}
	}
	return task, err
}

func nextRetry(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	shift := attempt - 1
	if shift > 9 {
		shift = 9
	}
	wait := time.Second * time.Duration(1<<shift)
	if wait > 5*time.Minute {
		return 5 * time.Minute
	}
	return wait
}

func markScanRetry(ctx context.Context, db *pgxpool.Pool, task scanTask, owner string, cause error) error {
	_, err := db.Exec(ctx, `UPDATE file_scan_tasks SET status='pending',available_at=NOW()+make_interval(secs=>$1),
		lease_owner='',lease_until=NULL,last_error=$2,updated_at=NOW()
		WHERE id=$3 AND status='leased' AND lease_owner=$4`, nextRetry(task.Attempts).Seconds(), cause.Error(), task.ID, owner)
	return err
}

func mediaType(value string) string {
	parsed, _, err := mime.ParseMediaType(strings.TrimSpace(value))
	if err != nil {
		return ""
	}
	return strings.ToLower(parsed)
}

func compatibleOfficeZip(ext, detected string) bool {
	if detected != "application/zip" {
		return false
	}
	switch strings.ToLower(ext) {
	case ".docx", ".xlsx", ".pptx", ".docm", ".xlsm", ".pptm":
		return true
	default:
		return false
	}
}

func compatibleTextType(extensionType, declaredType string) bool {
	switch extensionType {
	case "application/json", "application/ld+json", "application/yaml", "application/toml",
		"text/csv", "text/tab-separated-values", "text/markdown":
		return declaredType == "" || declaredType == "application/octet-stream" || declaredType == "text/plain" || declaredType == extensionType
	default:
		return false
	}
}

func mediaTypeForExtension(ext string) string {
	switch strings.ToLower(ext) {
	case ".csv":
		return "text/csv"
	case ".tsv":
		return "text/tab-separated-values"
	case ".json":
		return "application/json"
	default:
		return mediaType(mime.TypeByExtension(ext))
	}
}

func inspectContentType(filename, declared string, header []byte) (string, error) {
	detected := mediaType(http.DetectContentType(header))
	if detected == "" || detected == "application/octet-stream" {
		detected = "application/octet-stream"
	}
	declaredType := mediaType(declared)
	ext := strings.ToLower(filepath.Ext(filename))
	extensionType := mediaTypeForExtension(ext)
	if detected == "text/plain" && compatibleTextType(extensionType, declaredType) {
		detected = extensionType
	}
	if detected != "application/octet-stream" && declaredType != "" && declaredType != "application/octet-stream" && detected != declaredType {
		if !compatibleOfficeZip(ext, detected) {
			return "", fmt.Errorf("declared content type does not match file signature")
		}
	}
	if extensionType != "" && detected != "application/octet-stream" && extensionType != detected && !compatibleOfficeZip(ext, detected) {
		return "", fmt.Errorf("filename extension does not match file signature")
	}
	if detected == "application/octet-stream" {
		return detected, nil
	}
	return detected, nil
}

func scanContent(ctx context.Context, scanner fileScanner, source io.Reader, task scanTask, maxBytes int64) (scanResult, string, string, error) {
	if task.PolicyMaxBytes > 0 {
		maxBytes = min(maxBytes, task.PolicyMaxBytes)
	}
	if task.SizeBytes <= 0 || task.SizeBytes > maxBytes {
		return scanResult{Verdict: scanUnsupported, Reason: "size_limit"}, "", "application/octet-stream", nil
	}
	prefix := make([]byte, 512)
	n, readErr := io.ReadFull(source, prefix)
	if readErr != nil && readErr != io.EOF && readErr != io.ErrUnexpectedEOF {
		return scanResult{}, "", "", readErr
	}
	prefix = prefix[:n]
	contentType, validationErr := inspectContentType(task.Filename, task.DeclaredType, prefix)
	if validationErr == nil && len(task.AllowedContentTypes) > 0 {
		allowed := false
		for _, candidate := range task.AllowedContentTypes {
			if mediaType(candidate) == contentType {
				allowed = true
				break
			}
		}
		if !allowed {
			validationErr = fmt.Errorf("content type is not allowed for this file purpose")
		}
	}
	hasher := sha256.New()
	stream := io.TeeReader(io.MultiReader(bytes.NewReader(prefix), source), hasher)
	version, err := scanner.Version(ctx)
	if err != nil {
		return scanResult{}, "", "", err
	}
	engine, signatures := version, ""
	if split := strings.Index(version, "/"); split >= 0 {
		engine, signatures = version[:split], version[split+1:]
	}
	if validationErr != nil {
		if _, err := io.Copy(io.Discard, stream); err != nil {
			return scanResult{}, "", "", err
		}
		return scanResult{Verdict: scanUnsupported, Engine: engine, Sigs: signatures, Reason: "content_type_mismatch"}, hex.EncodeToString(hasher.Sum(nil)), contentType, nil
	}
	verdict, reason, err := scanner.Scan(ctx, stream, maxBytes)
	if err != nil {
		return scanResult{}, "", "", err
	}
	return scanResult{Verdict: verdict, Engine: engine, Sigs: signatures, Reason: reason}, hex.EncodeToString(hasher.Sum(nil)), contentType, nil
}

func isMissingObject(err error) bool {
	var response minio.ErrorResponse
	return errors.As(err, &response) && (response.Code == "NoSuchKey" || response.Code == "NoSuchBucket")
}

func rejectLegacyFileVersion(ctx context.Context, logger *slog.Logger, db *pgxpool.Pool, versionID, reason string) {
	tx, err := db.Begin(ctx)
	if err != nil {
		logger.Warn("begin legacy file rejection", "version_id", versionID, "error", err)
		return
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `UPDATE file_versions SET security_status='unsupported',security_reason=$1,scanned_at=NOW()
		WHERE id=$2 AND frozen_at IS NULL AND security_status='pending'`, reason, versionID)
	if err != nil {
		logger.Warn("reject unavailable legacy file version", "version_id", versionID, "error", err)
		return
	}
	if tag.RowsAffected() == 0 {
		return
	}
	if _, err := tx.Exec(ctx, `UPDATE file_scan_tasks SET status='completed',outcome='unsupported',last_error='',completed_at=NOW(),updated_at=NOW()
		WHERE version_id=$1 AND status='pending'`, versionID); err != nil {
		logger.Warn("complete unavailable legacy file scan", "version_id", versionID, "error", err)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		logger.Warn("commit unavailable legacy file rejection", "version_id", versionID, "error", err)
	}
}

func processFileScanTask(ctx context.Context, logger *slog.Logger, db *pgxpool.Pool, storage *minio.Client, scanner fileScanner, task scanTask, owner string, maxBytes int64) {
	if task.SizeBytes > maxBytes || task.SizeBytes <= 0 {
		commitScanResult(ctx, logger, db, task, owner, scanResult{Verdict: scanUnsupported, Reason: "size_limit"}, "", "application/octet-stream")
		return
	}
	info, err := storage.StatObject(ctx, task.Bucket, task.ObjectKey, minio.StatObjectOptions{})
	if err != nil {
		if isMissingObject(err) {
			commitScanResult(ctx, logger, db, task, owner, scanResult{Verdict: scanUnsupported, Reason: "object_missing"}, "", "application/octet-stream")
			return
		}
		if retryErr := markScanRetry(ctx, db, task, owner, err); retryErr != nil {
			logger.Warn("schedule file scan retry", "version_id", task.VersionID, "error", retryErr)
		}
		logger.Warn("stat file for security scan", "version_id", task.VersionID, "error", err)
		return
	}
	if info.Size != task.SizeBytes {
		commitScanResult(ctx, logger, db, task, owner, scanResult{Verdict: scanUnsupported, Reason: "size_mismatch"}, "", "application/octet-stream")
		return
	}
	inspectCtx, cancel := context.WithTimeout(ctx, 15*time.Minute)
	defer cancel()
	object, err := storage.GetObject(inspectCtx, task.Bucket, task.ObjectKey, minio.GetObjectOptions{})
	if err != nil {
		if isMissingObject(err) {
			commitScanResult(inspectCtx, logger, db, task, owner, scanResult{Verdict: scanUnsupported, Reason: "object_missing"}, "", "application/octet-stream")
		} else {
			if retryErr := markScanRetry(inspectCtx, db, task, owner, err); retryErr != nil {
				logger.Warn("schedule file scan retry", "version_id", task.VersionID, "error", retryErr)
			}
		}
		return
	}
	defer object.Close()
	result, hash, contentType, err := scanContent(inspectCtx, scanner, object, task, maxBytes)
	if err != nil {
		if retryErr := markScanRetry(inspectCtx, db, task, owner, err); retryErr != nil {
			logger.Warn("schedule file scan retry", "version_id", task.VersionID, "error", retryErr)
		}
		logger.Warn("file security scan failed; queued for retry", "version_id", task.VersionID, "error", err)
		return
	}
	commitScanResult(ctx, logger, db, task, owner, result, hash, contentType)
}

func commitScanResult(ctx context.Context, logger *slog.Logger, db *pgxpool.Pool, task scanTask, owner string, result scanResult, hash, contentType string) {
	tx, err := db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		logger.Warn("begin file scan result", "version_id", task.VersionID, "error", err)
		return
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT 1 FROM workspace_storage_accounts WHERE workspace_id=$1 FOR UPDATE`, task.WorkspaceID); err != nil {
		logger.Warn("lock workspace storage for scan result", "version_id", task.VersionID, "error", err)
		return
	}
	var leaseID string
	err = tx.QueryRow(ctx, `SELECT id FROM file_scan_tasks WHERE id=$1 AND status='leased' AND lease_owner=$2 FOR UPDATE`, task.ID, owner).Scan(&leaseID)
	if err != nil {
		return
	}
	var versionNo int
	var size int64
	var quotaCharged bool
	err = tx.QueryRow(ctx, `UPDATE file_versions SET security_status=$1,sha256=$2,scan_engine=$3,scan_signature=$4,
		scanned_at=NOW(),security_reason=$5,quarantine_until=CASE WHEN $1 IN ('infected','unsupported') THEN NOW()+INTERVAL '30 days' ELSE NULL END,
		content_type=CASE WHEN $1='clean' THEN $6 ELSE content_type END
		WHERE id=$7 AND security_status='pending' RETURNING version_no,size_bytes,quota_charged`, result.Verdict, hash, result.Engine, result.Sigs, securityReasonCode(result), contentType, task.VersionID).Scan(&versionNo, &size, &quotaCharged)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			logger.Warn("store file scan result", "version_id", task.VersionID, "error", err)
		}
		return
	}
	if result.Verdict != scanClean && quotaCharged {
		if _, err = tx.Exec(ctx, `UPDATE file_versions SET quota_charged=FALSE WHERE id=$1`, task.VersionID); err != nil {
			logger.Warn("release rejected file version charge", "version_id", task.VersionID, "error", err)
			return
		}
		if _, err = tx.Exec(ctx, `UPDATE workspace_storage_accounts SET quota_used_bytes=GREATEST(0,quota_used_bytes-$2),updated_at=NOW()
			WHERE workspace_id=$1`, task.WorkspaceID, size); err != nil {
			logger.Warn("decrement workspace quota after scan rejection", "version_id", task.VersionID, "error", err)
			return
		}
		if _, err = tx.Exec(ctx, `INSERT INTO workspace_storage_events(workspace_id,event_type,quota_used_delta,reference_type,reference_id)
			VALUES($1,'scan_rejected',-($2::bigint),'file_version',$3)`, task.WorkspaceID, size, task.VersionID); err != nil {
			logger.Warn("record scan quota release", "version_id", task.VersionID, "error", err)
			return
		}
	}
	if result.Verdict == scanClean {
		_, err = tx.Exec(ctx, `UPDATE files f SET current_version_id=v.id,status='uploaded',bucket=v.bucket,object_key=v.object_key,
			filename=v.filename,content_type=v.content_type,size_bytes=v.size_bytes,etag=v.etag,updated_at=NOW()
			FROM file_versions v WHERE f.id=v.file_id AND v.id=$1 AND
			f.deleted_at IS NULL AND (f.current_version_id IS NULL OR COALESCE((SELECT cv.version_no FROM file_versions cv WHERE cv.id=f.current_version_id),0)<v.version_no)`, task.VersionID)
		if err != nil {
			logger.Warn("publish clean file version", "version_id", task.VersionID, "error", err)
			return
		}
	}
	outcome := string(result.Verdict)
	tag, err := tx.Exec(ctx, `UPDATE file_scan_tasks SET status='completed',lease_owner='',lease_until=NULL,
		outcome=$1,last_error='',completed_at=NOW(),updated_at=NOW()
		WHERE id=$2 AND status='leased' AND lease_owner=$3`, outcome, task.ID, owner)
	if err != nil {
		logger.Warn("complete file scan task", "version_id", task.VersionID, "error", err)
		return
	}
	if tag.RowsAffected() != 1 {
		return
	}
	if err := tx.Commit(ctx); err != nil {
		logger.Warn("commit file scan result", "version_id", task.VersionID, "error", err)
	}
}

func securityReasonCode(result scanResult) string {
	switch result.Verdict {
	case scanInfected:
		return "malware_detected"
	case scanUnsupported:
		switch result.Reason {
		case "object_missing":
			return "object_missing"
		case "size_mismatch":
			return "object_size_mismatch"
		}
		if strings.Contains(strings.ToLower(result.Reason), "size limit") || strings.Contains(result.Reason, "Heuristics.Limits.Exceeded") {
			return "scan_limit_exceeded"
		}
		return "content_validation_failed"
	default:
		return ""
	}
}

func processFileScanQueue(ctx context.Context, logger *slog.Logger, db *pgxpool.Pool, storage *minio.Client, scanner fileScanner, maxBytes int64) {
	owner := uuid.NewString()
	for i := 0; i < 8; i++ {
		task, err := claimFileScanTask(ctx, db, owner)
		if errors.Is(err, pgx.ErrNoRows) {
			return
		}
		if err != nil {
			logger.Warn("claim file scan task", "error", err)
			return
		}
		processFileScanTask(ctx, logger, db, storage, scanner, task, owner, maxBytes)
	}
}
