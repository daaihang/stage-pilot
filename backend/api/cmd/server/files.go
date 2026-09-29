package main

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	minioCredentials "github.com/minio/minio-go/v7/pkg/credentials"
)

type objectStorage struct {
	client           *minio.Client
	presignClient    *minio.Client
	core             minio.Core
	bucket           string
	stagingBucket    string
	ttl              time.Duration
	maxBytes         int64
	physicalMaxBytes int64
}

func newObjectStorage(ctx context.Context) (*objectStorage, error) {
	endpoint := os.Getenv("S3_ENDPOINT")
	if endpoint == "" {
		return nil, fmt.Errorf("S3_ENDPOINT is not configured")
	}
	endpoint = strings.TrimPrefix(strings.TrimPrefix(endpoint, "http://"), "https://")
	secure := os.Getenv("S3_USE_SSL") == "true"
	lookup := minio.BucketLookupAuto
	if os.Getenv("S3_PATH_STYLE") == "true" {
		lookup = minio.BucketLookupPath
	}
	creds := minioCredentials.NewStaticV4(os.Getenv("S3_ACCESS_KEY"), os.Getenv("S3_SECRET_KEY"), "")
	client, err := minio.New(endpoint, &minio.Options{Creds: creds, Secure: secure, Region: envOrDefault("S3_REGION", "us-east-1"), BucketLookup: lookup})
	if err != nil {
		return nil, err
	}
	bucket := envOrDefault("S3_BUCKET", "stagepilot")
	if err := client.MakeBucket(ctx, bucket, minio.MakeBucketOptions{Region: envOrDefault("S3_REGION", "us-east-1")}); err != nil {
		code := minio.ToErrorResponse(err).Code
		if code != "BucketAlreadyOwnedByYou" {
			return nil, err
		}
	}
	stagingBucket := envOrDefault("S3_STAGING_BUCKET", bucket+"-staging")
	if stagingBucket == bucket {
		return nil, fmt.Errorf("S3_STAGING_BUCKET must be separate from S3_BUCKET")
	}
	if err := client.MakeBucket(ctx, stagingBucket, minio.MakeBucketOptions{Region: envOrDefault("S3_REGION", "us-east-1")}); err != nil {
		code := minio.ToErrorResponse(err).Code
		if code != "BucketAlreadyOwnedByYou" {
			return nil, err
		}
	}
	for _, name := range []string{bucket, stagingBucket} {
		versioning, err := client.GetBucketVersioning(ctx, name)
		if err != nil {
			return nil, fmt.Errorf("check object bucket %q versioning: %w", name, err)
		}
		if err := validateBucketVersioningDisabled(name, versioning); err != nil {
			return nil, err
		}
	}
	public := os.Getenv("S3_PUBLIC_ENDPOINT")
	if public == "" {
		public = endpoint
		if secure {
			public = "https://" + public
		} else {
			public = "http://" + public
		}
	}
	ttl := 15 * time.Minute
	if v, e := time.ParseDuration(os.Getenv("S3_UPLOAD_URL_TTL")); e == nil && v > 0 {
		ttl = v
	}
	max := int64(2_000_000_000)
	if v, e := strconv.ParseInt(os.Getenv("FILES_MAX_BYTES"), 10, 64); e == nil && v > 0 {
		max = min(v, hardMaxFileBytes)
	}
	physicalMax, err := strconv.ParseInt(os.Getenv("FILES_WORKSPACE_PHYSICAL_MAX_BYTES"), 10, 64)
	if err != nil || physicalMax <= 0 {
		return nil, fmt.Errorf("FILES_WORKSPACE_PHYSICAL_MAX_BYTES must be configured as a positive byte count")
	}
	publicURL, err := url.Parse(public)
	if err != nil || publicURL.Host == "" {
		return nil, fmt.Errorf("invalid S3_PUBLIC_ENDPOINT")
	}
	publicClient, err := minio.New(publicURL.Host, &minio.Options{Creds: creds, Secure: publicURL.Scheme == "https", Region: envOrDefault("S3_REGION", "us-east-1"), BucketLookup: lookup})
	if err != nil {
		return nil, err
	}
	return &objectStorage{client: client, presignClient: publicClient, core: minio.Core{Client: client}, bucket: bucket, stagingBucket: stagingBucket, ttl: ttl, maxBytes: max, physicalMaxBytes: physicalMax}, nil
}

func validateBucketVersioningDisabled(bucket string, config minio.BucketVersioningConfiguration) error {
	if config.Status != "" {
		return fmt.Errorf("object bucket %q must have versioning disabled (status %q)", bucket, config.Status)
	}
	return nil
}

func registerFileRoutes(app *application, mux *http.ServeMux) {
	mux.Handle("POST /v1/workspaces/{id}/files", app.auth(http.HandlerFunc(app.createFile)))
	mux.Handle("GET /v1/workspaces/{id}/files", app.auth(http.HandlerFunc(app.listFiles)))
	mux.Handle("POST /v1/workspaces/{id}/files/{fileId}/complete", app.auth(http.HandlerFunc(app.completeFile)))
	mux.Handle("GET /v1/workspaces/{id}/files/{fileId}/download", app.auth(http.HandlerFunc(app.downloadFile)))
	mux.Handle("DELETE /v1/workspaces/{id}/files/{fileId}", app.auth(http.HandlerFunc(app.deleteFile)))
	mux.Handle("GET /v1/workspaces/{id}/files/{fileId}/versions", app.auth(http.HandlerFunc(app.listFileVersions)))
	mux.Handle("POST /v1/workspaces/{id}/files/{fileId}/versions", app.auth(http.HandlerFunc(app.startFileVersion)))
	mux.Handle("GET /v1/workspaces/{id}/files/{fileId}/versions/{versionId}/download", app.auth(http.HandlerFunc(app.downloadFileVersion)))
	mux.Handle("POST /v1/file-upload-sessions/{uploadId}/complete", app.auth(http.HandlerFunc(app.completeFileUploadSession)))
	mux.Handle("GET /v1/file-upload-sessions/{uploadId}", app.auth(http.HandlerFunc(app.getFileUploadSessionStatus)))
	mux.Handle("POST /v1/file-upload-sessions/{uploadId}/parts/{partNumber}/url", app.auth(http.HandlerFunc(app.signFileUploadPart)))
	mux.Handle("GET /v1/file-upload-sessions/{uploadId}/parts", app.auth(http.HandlerFunc(app.listVerifiedUploadParts)))
	mux.Handle("DELETE /v1/file-upload-sessions/{uploadId}", app.auth(http.HandlerFunc(app.cancelFileUploadSession)))
	mux.Handle("GET /v1/workspaces/{id}/files/trash", app.auth(http.HandlerFunc(app.listDeletedFiles)))
	mux.Handle("POST /v1/workspaces/{id}/files/{fileId}/restore", app.auth(http.HandlerFunc(app.restoreFile)))
	registerFileAttachmentRoutes(app, mux)
}

// File URLs retain their Workspace prefix for compatibility. The file's stored
// scope, rather than the URL or a caller-supplied production_id, determines the
// authorization boundary for operations on an existing file.
func (app *application) authorizeFileScope(w http.ResponseWriter, r *http.Request, workspaceID string, productionID *string, operation string) bool {
	if productionID != nil {
		access, err := app.productionAccessFor(r.Context(), claims(r).Subject, *productionID)
		permission := productionView
		if operation != "read" {
			permission = productionEdit
		}
		if err != nil || access.WorkspaceID != workspaceID || !access.Permissions[permission] {
			errorJSON(w, http.StatusNotFound, "file_not_found", "文件不存在或无权访问")
			return false
		}
		return true
	}

	role, err := app.workspaceFileRole(r.Context(), claims(r).Subject, workspaceID)
	minimumRole := workspaceRoleMember
	if operation == "delete" {
		minimumRole = workspaceRoleAdmin
	}
	if err != nil || roleRank[role] < roleRank[minimumRole] {
		errorJSON(w, http.StatusForbidden, "workspace_forbidden", "没有访问这个工作空间文件的权限")
		return false
	}
	return true
}

type fileLocation struct {
	ProductionID *string
	Bucket       string
	ObjectKey    string
	Filename     string
	SizeBytes    int64
	Status       string
	CreatedBy    string
}

func (app *application) fileLocation(r *http.Request) (fileLocation, error) {
	var f fileLocation
	err := app.db.QueryRow(r.Context(), `SELECT production_id,bucket,object_key,filename,size_bytes,status,created_by
		FROM files WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL AND access_mode='library'`,
		r.PathValue("fileId"), r.PathValue("id")).Scan(&f.ProductionID, &f.Bucket, &f.ObjectKey, &f.Filename, &f.SizeBytes, &f.Status, &f.CreatedBy)
	return f, err
}

type storedFile struct {
	ID           string          `json:"id"`
	WorkspaceID  string          `json:"workspace_id"`
	ProductionID *string         `json:"production_id,omitempty"`
	Filename     string          `json:"filename"`
	ContentType  string          `json:"content_type"`
	SizeBytes    int64           `json:"size_bytes"`
	ETag         string          `json:"etag"`
	Status       string          `json:"status"`
	ScanStatus   string          `json:"scan_status"`
	CreatedAt    time.Time       `json:"created_at"`
	UpdatedAt    time.Time       `json:"updated_at"`
	Capabilities map[string]bool `json:"capabilities,omitempty"`
}

func (app *application) libraryFileCapabilities(ctx context.Context, userID, workspaceID string, productionID *string) map[string]bool {
	canWrite, canDelete := false, false
	if productionID == nil {
		role, err := app.workspaceFileRole(ctx, userID, workspaceID)
		canWrite = err == nil && roleRank[role] >= roleRank[workspaceRoleMember]
		canDelete = err == nil && roleRank[role] >= roleRank[workspaceRoleAdmin]
	} else if access, err := app.productionAccessFor(ctx, userID, *productionID); err == nil && access.WorkspaceID == workspaceID {
		canWrite = access.Permissions[productionEdit]
		canDelete = canWrite
	}
	return map[string]bool{"can_download": false, "can_upload_version": canWrite, "can_delete": canDelete, "can_manage_trash": canDelete}
}

func cleanFilename(name string) string {
	name = filepath.Base(strings.TrimSpace(name))
	name = strings.Map(func(r rune) rune {
		if r < 32 || r == '/' || r == '\\' {
			return -1
		}
		return r
	}, name)
	if name == "" {
		name = "unnamed"
	}
	if len(name) > 255 {
		name = name[:255]
	}
	return name
}
func (app *application) storageRequired(w http.ResponseWriter) *objectStorage {
	if app.storage == nil {
		errorJSON(w, 503, "storage_unavailable", "文件存储尚未配置")
		return nil
	}
	return app.storage
}

func (app *application) createFile(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.PathValue("id")
	var in struct {
		Filename     string  `json:"filename"`
		ContentType  string  `json:"content_type"`
		SizeBytes    int64   `json:"size_bytes"`
		ProductionID *string `json:"production_id"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if !app.authorizeFileScope(w, r, workspaceID, in.ProductionID, "write") {
		return
	}
	s := app.storageRequired(w)
	if s == nil {
		return
	}
	filename := cleanFilename(in.Filename)
	policy := fileUploadPolicy{MaxBytes: s.maxBytes}
	if err := validateFileUploadSize(policy, in.SizeBytes, s.maxBytes); err != nil {
		writeFileStorageError(w, err)
		return
	}
	id, key := newID(), "ws/"+workspaceID+"/staging/"+newID()
	contentType := strings.TrimSpace(in.ContentType)
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	idempotencyKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if len(idempotencyKey) > 200 {
		writeFileStorageError(w, storageError(http.StatusBadRequest, "invalid_idempotency_key", "上传请求标识无效"))
		return
	}
	if idempotencyKey != "" {
		existing, err := findIdempotentFileUpload(r.Context(), app.db, workspaceID, claims(r).Subject, idempotencyKey)
		if err != nil {
			serverError(w, err)
			return
		}
		if existing != nil {
			if existing.ExpectedSize != in.SizeBytes || existing.Filename != filename || existing.ContentType != contentType || !sameOptionalString(existing.ProductionID, in.ProductionID) {
				writeFileStorageError(w, storageError(http.StatusConflict, "idempotency_conflict", "该上传请求标识已用于不同文件"))
				return
			}
			var upload map[string]any
			if existing.Status == "pending" {
				upload, err = app.createFileUploadSession(r.Context(), s, workspaceID, existing.FileID, claims(r).Subject, filename, contentType, in.SizeBytes, policy, idempotencyKey)
			} else if existing.Status == "completed" {
				upload = map[string]any{"id": existing.ID, "upload_id": existing.ID, "transport": "completed"}
			} else {
				writeFileStorageError(w, storageError(http.StatusConflict, "upload_not_pending", "该上传会话已结束，请重新选择文件开始上传"))
				return
			}
			if err != nil {
				if !writeFileStorageError(w, err) {
					serverError(w, err)
				}
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"file": map[string]any{"id": existing.FileID, "filename": filename,
				"content_type": contentType, "size_bytes": in.SizeBytes, "status": existing.FileStatus}, "upload": upload})
			return
		}
	}
	_, err := app.db.Exec(r.Context(), `INSERT INTO files(id,workspace_id,production_id,bucket,object_key,filename,content_type,size_bytes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, id, workspaceID, in.ProductionID, s.bucket, key, filename, contentType, in.SizeBytes, claims(r).Subject)
	if err != nil {
		serverError(w, err)
		return
	}
	upload, err := app.createFileUploadSession(r.Context(), s, workspaceID, id, claims(r).Subject, filename, contentType, in.SizeBytes, policy, idempotencyKey)
	if err != nil {
		_, _ = app.db.Exec(r.Context(), `UPDATE files SET deleted_at=NOW(),purge_after=NOW()+INTERVAL '30 days',updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL`, id)
		if !writeFileStorageError(w, err) {
			serverError(w, err)
		}
		return
	}
	writeJSON(w, 201, map[string]any{"file": map[string]any{"id": id, "filename": filename, "content_type": contentType, "size_bytes": in.SizeBytes, "status": "pending"}, "upload": upload})
}

func (app *application) completeFile(w http.ResponseWriter, r *http.Request) {
	f, err := app.fileLocation(r)
	if err != nil {
		errorJSON(w, 404, "file_not_found", "文件不存在")
		return
	}
	if !app.authorizeFileScope(w, r, r.PathValue("id"), f.ProductionID, "write") {
		return
	}
	if f.CreatedBy != claims(r).Subject {
		errorJSON(w, http.StatusForbidden, "file_upload_owner_required", "只有原上传者可以完成上传")
		return
	}
	if f.Status == "uploaded" && f.CreatedBy == claims(r).Subject {
		var versionID string
		if err := app.db.QueryRow(r.Context(), `SELECT id FROM file_versions WHERE file_id=$1 ORDER BY version_no DESC LIMIT 1`, r.PathValue("fileId")).Scan(&versionID); err == nil {
			writeJSON(w, http.StatusAccepted, map[string]any{"version_id": versionID, "status": "processing"})
			return
		}
	}
	if f.Status != "pending" {
		errorJSON(w, 409, "file_not_pending", "文件状态不可确认")
		return
	}
	s := app.storageRequired(w)
	if s == nil {
		return
	}
	info, err := s.client.StatObject(r.Context(), f.Bucket, f.ObjectKey, minio.StatObjectOptions{})
	if err != nil {
		errorJSON(w, 400, "upload_missing", "对象尚未上传")
		return
	}
	if info.Size != f.SizeBytes || info.Size > s.maxBytes {
		_ = s.client.RemoveObject(r.Context(), f.Bucket, f.ObjectKey, minio.RemoveObjectOptions{})
		errorJSON(w, 400, "size_mismatch", "上传文件大小与声明不一致")
		return
	}
	committed, err := app.finalizeLegacyFile(r.Context(), s, r.PathValue("id"), r.PathValue("fileId"), claims(r).Subject, f, strings.Trim(info.ETag, `"`))
	if err != nil {
		serverError(w, err)
		return
	}
	if !committed {
		errorJSON(w, http.StatusConflict, "file_not_pending", "文件状态已变化，请重新上传")
		return
	}
	var versionID string
	if err := app.db.QueryRow(r.Context(), `SELECT id FROM file_versions WHERE file_id=$1 AND version_no=1`, r.PathValue("fileId")).Scan(&versionID); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"file_id": r.PathValue("fileId"), "version_id": versionID, "status": "processing"})
}
func (app *application) getFile(w http.ResponseWriter, r *http.Request) {
	var f storedFile
	err := app.db.QueryRow(r.Context(), `SELECT f.id,f.workspace_id,f.production_id,f.filename,f.content_type,f.size_bytes,f.etag,f.status,
		f.created_at,f.updated_at,COALESCE(latest.security_status,'pending')
		FROM files f LEFT JOIN LATERAL (SELECT v.security_status FROM file_versions v WHERE v.file_id=f.id ORDER BY v.version_no DESC LIMIT 1) latest ON TRUE
		WHERE f.id=$1 AND f.workspace_id=$2 AND f.deleted_at IS NULL AND f.access_mode='library'`, r.PathValue("fileId"), r.PathValue("id")).Scan(&f.ID, &f.WorkspaceID, &f.ProductionID, &f.Filename, &f.ContentType, &f.SizeBytes, &f.ETag, &f.Status, &f.CreatedAt, &f.UpdatedAt, &f.ScanStatus)
	if err != nil {
		errorJSON(w, 404, "file_not_found", "文件不存在")
		return
	}
	f.ScanStatus = publicScanStatus(f.ScanStatus)
	writeJSON(w, 200, f)
}
func (app *application) listFiles(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.PathValue("id")
	prod := strings.TrimSpace(r.URL.Query().Get("production_id"))
	var productionID *string
	if prod != "" && prod != "workspace" {
		productionID = &prod
	}
	if !app.authorizeFileScope(w, r, workspaceID, productionID, "read") {
		return
	}
	q := `SELECT f.id,f.workspace_id,f.production_id,f.filename,f.content_type,f.size_bytes,f.etag,f.status,f.created_at,f.updated_at,
		COALESCE(latest.security_status,'pending'),
		EXISTS(SELECT 1 FROM file_versions current_version WHERE current_version.id=f.current_version_id AND current_version.file_id=f.id AND current_version.security_status='clean' AND current_version.object_purged_at IS NULL)
		FROM files f LEFT JOIN LATERAL (SELECT v.security_status FROM file_versions v WHERE v.file_id=f.id ORDER BY v.version_no DESC LIMIT 1) latest ON TRUE
		WHERE f.workspace_id=$1 AND f.deleted_at IS NULL AND f.access_mode='library'`
	args := []any{workspaceID}
	if productionID == nil {
		q += " AND f.production_id IS NULL"
	} else {
		q += " AND f.production_id=$2"
		args = append(args, prod)
	}
	q += " ORDER BY f.created_at DESC"
	rows, err := app.db.Query(r.Context(), q, args...)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	items := []storedFile{}
	for rows.Next() {
		var f storedFile
		var securityStatus string
		var hasCleanCurrent bool
		if err := rows.Scan(&f.ID, &f.WorkspaceID, &f.ProductionID, &f.Filename, &f.ContentType, &f.SizeBytes, &f.ETag, &f.Status, &f.CreatedAt, &f.UpdatedAt, &securityStatus, &hasCleanCurrent); err != nil {
			serverError(w, err)
			return
		}
		f.Capabilities = app.libraryFileCapabilities(r.Context(), claims(r).Subject, workspaceID, f.ProductionID)
		f.Capabilities["can_download"] = hasCleanCurrent
		f.ScanStatus = publicScanStatus(securityStatus)
		items = append(items, f)
	}
	capabilities := app.libraryFileCapabilities(r.Context(), claims(r).Subject, workspaceID, productionID)
	writeJSON(w, 200, map[string]any{"items": items, "total": len(items), "capabilities": map[string]bool{
		"can_upload": capabilities["can_upload_version"], "can_manage_trash": capabilities["can_manage_trash"],
	}})
}
func (app *application) downloadFile(w http.ResponseWriter, r *http.Request) {
	f, err := app.fileLocation(r)
	if err != nil {
		errorJSON(w, 404, "file_not_found", "文件不存在")
		return
	}
	if !app.authorizeFileScope(w, r, r.PathValue("id"), f.ProductionID, "read") {
		return
	}
	if f.Status != "uploaded" {
		errorJSON(w, 404, "file_not_found", "文件不存在")
		return
	}
	var versionID string
	err = app.db.QueryRow(r.Context(), `SELECT v.id FROM files f
		JOIN file_versions v ON v.id=f.current_version_id AND v.file_id=f.id
		WHERE f.id=$1 AND f.workspace_id=$2 AND f.deleted_at IS NULL AND v.security_status='clean' AND v.object_purged_at IS NULL`, r.PathValue("fileId"), r.PathValue("id")).Scan(&versionID)
	if err != nil {
		errorJSON(w, 404, "file_not_ready", "文件尚未通过安全检查")
		return
	}
	app.presignVersion(w, r, r.PathValue("fileId"), versionID)
}
func (app *application) deleteFile(w http.ResponseWriter, r *http.Request) {
	f, err := app.fileLocation(r)
	if err != nil {
		errorJSON(w, 404, "file_not_found", "文件不存在")
		return
	}
	if !app.authorizeFileScope(w, r, r.PathValue("id"), f.ProductionID, "delete") {
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	workspaceID, fileID := r.PathValue("id"), r.PathValue("fileId")
	if err := ensureWorkspaceStorageAccount(r.Context(), tx, workspaceID); err != nil {
		serverError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `SELECT 1 FROM workspace_storage_accounts WHERE workspace_id=$1 FOR UPDATE`, workspaceID); err != nil {
		serverError(w, err)
		return
	}
	var status string
	err = tx.QueryRow(r.Context(), `SELECT status FROM files WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL FOR UPDATE`, fileID, workspaceID).Scan(&status)
	if err != nil {
		errorJSON(w, 404, "file_not_found", "文件不存在")
		return
	}
	if _, err := tx.Exec(r.Context(), `UPDATE files SET deleted_at=NOW(),purge_after=NOW()+INTERVAL '30 days',updated_at=NOW() WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`, fileID, workspaceID); err != nil {
		serverError(w, err)
		return
	}
	if err := releaseVersionChargeTx(r.Context(), tx, workspaceID, fileID, claims(r).Subject, "file_trashed"); err != nil {
		serverError(w, err)
		return
	}
	if err := cancelPendingFileSessionsTx(r.Context(), tx, workspaceID, fileID, claims(r).Subject); err != nil {
		serverError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, map[string]string{"status": "deleted"})
}
