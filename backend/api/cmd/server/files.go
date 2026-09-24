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
	client        *minio.Client
	presignClient *minio.Client
	bucket        string
	ttl           time.Duration
	maxBytes      int64
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
		if code != "BucketAlreadyOwnedByYou" && code != "BucketAlreadyExists" {
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
	max := int64(5 << 30)
	if v, e := strconv.ParseInt(os.Getenv("FILES_MAX_BYTES"), 10, 64); e == nil && v > 0 {
		max = v
	}
	publicURL, err := url.Parse(public)
	if err != nil || publicURL.Host == "" {
		return nil, fmt.Errorf("invalid S3_PUBLIC_ENDPOINT")
	}
	publicClient, err := minio.New(publicURL.Host, &minio.Options{Creds: creds, Secure: publicURL.Scheme == "https", Region: envOrDefault("S3_REGION", "us-east-1"), BucketLookup: lookup})
	if err != nil {
		return nil, err
	}
	return &objectStorage{client: client, presignClient: publicClient, bucket: bucket, ttl: ttl, maxBytes: max}, nil
}

func registerFileRoutes(app *application, mux *http.ServeMux) {
	mux.Handle("POST /v1/workspaces/{id}/files", app.auth(http.HandlerFunc(app.createFile)))
	mux.Handle("GET /v1/workspaces/{id}/files", app.auth(http.HandlerFunc(app.listFiles)))
	mux.Handle("POST /v1/workspaces/{id}/files/{fileId}/complete", app.auth(http.HandlerFunc(app.completeFile)))
	mux.Handle("GET /v1/workspaces/{id}/files/{fileId}/download", app.auth(http.HandlerFunc(app.downloadFile)))
	mux.Handle("DELETE /v1/workspaces/{id}/files/{fileId}", app.auth(http.HandlerFunc(app.deleteFile)))
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

	var role string
	err := app.db.QueryRow(r.Context(), `SELECT m.role FROM workspace_memberships m
		JOIN workspaces w ON w.id=m.workspace_id
		WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='active' AND w.deleted_at IS NULL`,
		workspaceID, claims(r).Subject).Scan(&role)
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
		FROM files WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`,
		r.PathValue("fileId"), r.PathValue("id")).Scan(&f.ProductionID, &f.Bucket, &f.ObjectKey, &f.Filename, &f.SizeBytes, &f.Status, &f.CreatedBy)
	return f, err
}

type storedFile struct {
	ID           string    `json:"id"`
	WorkspaceID  string    `json:"workspace_id"`
	ProductionID *string   `json:"production_id,omitempty"`
	Filename     string    `json:"filename"`
	ContentType  string    `json:"content_type"`
	SizeBytes    int64     `json:"size_bytes"`
	ETag         string    `json:"etag"`
	Status       string    `json:"status"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
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
	if in.SizeBytes <= 0 || in.SizeBytes > s.maxBytes {
		errorJSON(w, 400, "invalid_size", "文件大小无效或超过限制")
		return
	}
	id, key := newID(), "ws/"+workspaceID+"/files/"+newID()+"/"+filename
	contentType := strings.TrimSpace(in.ContentType)
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	_, err := app.db.Exec(r.Context(), `INSERT INTO files(id,workspace_id,production_id,bucket,object_key,filename,content_type,size_bytes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, id, workspaceID, in.ProductionID, s.bucket, key, filename, contentType, in.SizeBytes, claims(r).Subject)
	if err != nil {
		serverError(w, err)
		return
	}
	presigned, err := s.presignClient.PresignedPutObject(r.Context(), s.bucket, key, s.ttl)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 201, map[string]any{"file": map[string]any{"id": id, "filename": filename, "content_type": contentType, "size_bytes": in.SizeBytes, "status": "pending"}, "upload": map[string]any{"url": presigned.String(), "method": "PUT", "expires_in": int64(s.ttl.Seconds())}})
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
	tag, err := app.db.Exec(r.Context(), `UPDATE files SET status='uploaded',etag=$1,updated_at=NOW()
		WHERE id=$2 AND workspace_id=$3 AND status='pending' AND deleted_at IS NULL AND created_by=$4`,
		strings.Trim(info.ETag, `"`), r.PathValue("fileId"), r.PathValue("id"), claims(r).Subject)
	if err != nil {
		serverError(w, err)
		return
	}
	if tag.RowsAffected() != 1 {
		errorJSON(w, http.StatusConflict, "file_not_pending", "文件状态已变化，请重新上传")
		return
	}
	app.getFile(w, r)
}
func (app *application) getFile(w http.ResponseWriter, r *http.Request) {
	var f storedFile
	err := app.db.QueryRow(r.Context(), `SELECT id,workspace_id,production_id,filename,content_type,size_bytes,etag,status,created_at,updated_at FROM files WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`, r.PathValue("fileId"), r.PathValue("id")).Scan(&f.ID, &f.WorkspaceID, &f.ProductionID, &f.Filename, &f.ContentType, &f.SizeBytes, &f.ETag, &f.Status, &f.CreatedAt, &f.UpdatedAt)
	if err != nil {
		errorJSON(w, 404, "file_not_found", "文件不存在")
		return
	}
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
	q := `SELECT id,workspace_id,production_id,filename,content_type,size_bytes,etag,status,created_at,updated_at FROM files WHERE workspace_id=$1 AND deleted_at IS NULL`
	args := []any{workspaceID}
	if productionID == nil {
		q += " AND production_id IS NULL"
	} else {
		q += " AND production_id=$2"
		args = append(args, prod)
	}
	q += " ORDER BY created_at DESC"
	rows, err := app.db.Query(r.Context(), q, args...)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	items := []storedFile{}
	for rows.Next() {
		var f storedFile
		if err := rows.Scan(&f.ID, &f.WorkspaceID, &f.ProductionID, &f.Filename, &f.ContentType, &f.SizeBytes, &f.ETag, &f.Status, &f.CreatedAt, &f.UpdatedAt); err != nil {
			serverError(w, err)
			return
		}
		items = append(items, f)
	}
	writeJSON(w, 200, map[string]any{"items": items, "total": len(items)})
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
	s := app.storageRequired(w)
	if s == nil {
		return
	}
	u, err := s.presignClient.PresignedGetObject(r.Context(), f.Bucket, f.ObjectKey, 5*time.Minute, url.Values{"response-content-disposition": []string{"attachment; filename=\"" + strings.ReplaceAll(f.Filename, `"`, "") + "\""}})
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"url": u.String(), "expires_in": 300})
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
	tag, err := app.db.Exec(r.Context(), "UPDATE files SET deleted_at=NOW(),updated_at=NOW() WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL", r.PathValue("fileId"), r.PathValue("id"))
	if err != nil {
		serverError(w, err)
		return
	}
	if tag.RowsAffected() != 1 {
		errorJSON(w, 404, "file_not_found", "文件不存在")
		return
	}
	writeJSON(w, 200, map[string]string{"status": "deleted"})
}
