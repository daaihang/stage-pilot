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
	mux.Handle("POST /v1/workspaces/{id}/files", app.auth(app.requireWorkspaceRole(workspaceRoleMember, http.HandlerFunc(app.createFile))))
	mux.Handle("GET /v1/workspaces/{id}/files", app.auth(app.requireWorkspaceRole(workspaceRoleMember, http.HandlerFunc(app.listFiles))))
	mux.Handle("POST /v1/workspaces/{id}/files/{fileId}/complete", app.auth(app.requireWorkspaceRole(workspaceRoleMember, http.HandlerFunc(app.completeFile))))
	mux.Handle("GET /v1/workspaces/{id}/files/{fileId}/download", app.auth(app.requireWorkspaceRole(workspaceRoleMember, http.HandlerFunc(app.downloadFile))))
	mux.Handle("DELETE /v1/workspaces/{id}/files/{fileId}", app.auth(app.requireWorkspaceRole(workspaceRoleAdmin, http.HandlerFunc(app.deleteFile))))
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
	s := app.storageRequired(w)
	if s == nil {
		return
	}
	access := currentWorkspaceAccess(r)
	var in struct {
		Filename     string  `json:"filename"`
		ContentType  string  `json:"content_type"`
		SizeBytes    int64   `json:"size_bytes"`
		ProductionID *string `json:"production_id"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	filename := cleanFilename(in.Filename)
	if in.SizeBytes <= 0 || in.SizeBytes > s.maxBytes {
		errorJSON(w, 400, "invalid_size", "文件大小无效或超过限制")
		return
	}
	if in.ProductionID != nil {
		var ok bool
		if err := app.db.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM productions WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL)", *in.ProductionID, access.WorkspaceID).Scan(&ok); err != nil || !ok {
			errorJSON(w, 404, "production_not_found", "活动不存在")
			return
		}
	}
	id, key := newID(), "ws/"+access.WorkspaceID+"/files/"+newID()+"/"+filename
	contentType := strings.TrimSpace(in.ContentType)
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	_, err := app.db.Exec(r.Context(), `INSERT INTO files(id,workspace_id,production_id,bucket,object_key,filename,content_type,size_bytes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, id, access.WorkspaceID, in.ProductionID, s.bucket, key, filename, contentType, in.SizeBytes, access.UserID)
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
	s := app.storageRequired(w)
	if s == nil {
		return
	}
	a := currentWorkspaceAccess(r)
	id := r.PathValue("fileId")
	var key, bucket string
	var expected int64
	var status string
	if err := app.db.QueryRow(r.Context(), "SELECT object_key,bucket,size_bytes,status FROM files WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL", id, a.WorkspaceID).Scan(&key, &bucket, &expected, &status); err != nil {
		errorJSON(w, 404, "file_not_found", "文件不存在")
		return
	}
	if status != "pending" {
		errorJSON(w, 409, "file_not_pending", "文件状态不可确认")
		return
	}
	info, err := s.client.StatObject(r.Context(), bucket, key, minio.StatObjectOptions{})
	if err != nil {
		errorJSON(w, 400, "upload_missing", "对象尚未上传")
		return
	}
	if info.Size != expected || info.Size > s.maxBytes {
		_ = s.client.RemoveObject(r.Context(), bucket, key, minio.RemoveObjectOptions{})
		errorJSON(w, 400, "size_mismatch", "上传文件大小与声明不一致")
		return
	}
	if _, err = app.db.Exec(r.Context(), "UPDATE files SET status='uploaded',etag=$1,updated_at=NOW() WHERE id=$2 AND workspace_id=$3", strings.Trim(info.ETag, `"`), id, a.WorkspaceID); err != nil {
		serverError(w, err)
		return
	}
	app.getFile(w, r)
}
func (app *application) getFile(w http.ResponseWriter, r *http.Request) {
	a := currentWorkspaceAccess(r)
	var f storedFile
	err := app.db.QueryRow(r.Context(), `SELECT id,workspace_id,production_id,filename,content_type,size_bytes,etag,status,created_at,updated_at FROM files WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`, r.PathValue("fileId"), a.WorkspaceID).Scan(&f.ID, &f.WorkspaceID, &f.ProductionID, &f.Filename, &f.ContentType, &f.SizeBytes, &f.ETag, &f.Status, &f.CreatedAt, &f.UpdatedAt)
	if err != nil {
		errorJSON(w, 404, "file_not_found", "文件不存在")
		return
	}
	writeJSON(w, 200, f)
}
func (app *application) listFiles(w http.ResponseWriter, r *http.Request) {
	a := currentWorkspaceAccess(r)
	prod := r.URL.Query().Get("production_id")
	q := `SELECT id,workspace_id,production_id,filename,content_type,size_bytes,etag,status,created_at,updated_at FROM files WHERE workspace_id=$1 AND deleted_at IS NULL`
	args := []any{a.WorkspaceID}
	if prod == "workspace" {
		q += " AND production_id IS NULL"
	} else if prod != "" {
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
	s := app.storageRequired(w)
	if s == nil {
		return
	}
	a := currentWorkspaceAccess(r)
	var key, bucket, filename string
	if err := app.db.QueryRow(r.Context(), "SELECT object_key,bucket,filename FROM files WHERE id=$1 AND workspace_id=$2 AND status='uploaded' AND deleted_at IS NULL", r.PathValue("fileId"), a.WorkspaceID).Scan(&key, &bucket, &filename); err != nil {
		errorJSON(w, 404, "file_not_found", "文件不存在")
		return
	}
	u, err := s.presignClient.PresignedGetObject(r.Context(), bucket, key, 5*time.Minute, url.Values{"response-content-disposition": []string{"attachment; filename=\"" + strings.ReplaceAll(filename, `"`, "") + "\""}})
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"url": u.String(), "expires_in": 300})
}
func (app *application) deleteFile(w http.ResponseWriter, r *http.Request) {
	a := currentWorkspaceAccess(r)
	tag, err := app.db.Exec(r.Context(), "UPDATE files SET deleted_at=NOW(),updated_at=NOW() WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL", r.PathValue("fileId"), a.WorkspaceID)
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
