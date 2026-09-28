package main

import (
	"context"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
)

func registerFileAttachmentRoutes(app *application, mux *http.ServeMux) {
	mux.Handle("GET /v1/workspaces/{id}/programs/{programId}/attachments", app.auth(http.HandlerFunc(app.listProgramAttachments)))
	mux.Handle("POST /v1/workspaces/{id}/programs/{programId}/attachments", app.auth(http.HandlerFunc(app.createProgramAttachment)))
	mux.Handle("GET /v1/productions/{productionId}/programs/{programId}/attachments", app.auth(http.HandlerFunc(app.listProductionProgramAttachments)))
	mux.Handle("POST /v1/productions/{productionId}/programs/{programId}/attachments", app.auth(http.HandlerFunc(app.createProductionProgramAttachment)))
	mux.Handle("POST /v1/productions/{productionId}/programs/{programId}/attachments/copy", app.auth(http.HandlerFunc(app.copyProductionProgramAttachment)))
	mux.Handle("GET /v1/attachments/{attachmentId}/versions", app.auth(http.HandlerFunc(app.listAttachmentVersions)))
	mux.Handle("POST /v1/attachments/{attachmentId}/versions", app.auth(http.HandlerFunc(app.startAttachmentVersion)))
	mux.Handle("GET /v1/attachments/{attachmentId}/download", app.auth(http.HandlerFunc(app.downloadAttachment)))
	mux.Handle("DELETE /v1/attachments/{attachmentId}", app.auth(http.HandlerFunc(app.detachFile)))
}

func (app *application) parentFromRoute(r *http.Request, kind fileParentKind) (fileParent, error) {
	adapter := app.fileParentAdapter(kind)
	if adapter == nil {
		return fileParent{}, pgx.ErrNoRows
	}
	return adapter.FromRoute(r)
}

func (app *application) attachmentFileType(ctx context.Context, workspaceID string, id *string) (bool, bool) {
	if id == nil {
		return true, false
	}
	var key *string
	err := app.db.QueryRow(ctx, `SELECT template_key FROM file_types WHERE id=$1 AND workspace_id=$2 AND scope='program' AND is_active AND deleted_at IS NULL`, *id, workspaceID).Scan(&key)
	return err == nil, key != nil && *key == "program.rights"
}

func (app *application) listAttachments(w http.ResponseWriter, r *http.Request, kind fileParentKind) {
	p, err := app.parentFromRoute(r, kind)
	if err != nil || !app.authorizeFileParent(r.Context(), claims(r).Subject, p, "standard", fileView) {
		errorJSON(w, 404, "parent_not_found", "节目不存在或无权访问")
		return
	}
	adapter := app.fileParentAdapter(kind)
	if adapter == nil {
		serverError(w, pgx.ErrNoRows)
		return
	}
	rows, err := adapter.List(r.Context(), app.db, p)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var a attachmentAccess
		var versionID, filename, contentType, scanStatus string
		var versionNo int
		var size int64
		var hasCleanVersion bool
		if err := rows.Scan(&a.ID, &a.FileID, &a.FileTypeID, &a.SecurityClass, &a.Status, &versionID, &versionNo, &filename, &contentType, &size, &scanStatus, &hasCleanVersion); err != nil {
			serverError(w, err)
			return
		}
		a.Parent = p
		a.HasCleanVersion = hasCleanVersion
		if !app.authorizeFileParent(r.Context(), claims(r).Subject, p, a.SecurityClass, fileView) {
			continue
		}
		items = append(items, map[string]any{"id": a.ID, "file_id": a.FileID, "file_type_id": a.FileTypeID, "security_class": a.SecurityClass, "version_id": versionID, "version_no": versionNo, "filename": filename, "content_type": contentType, "size_bytes": size, "scan_status": publicScanStatus(scanStatus), "has_clean_version": hasCleanVersion, "capabilities": app.fileCapabilities(r.Context(), claims(r).Subject, a)})
	}
	if err := rows.Err(); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items, "total": len(items), "capabilities": map[string]bool{"can_attach": app.authorizeFileParent(r.Context(), claims(r).Subject, p, "standard", fileAttach), "can_attach_restricted": app.authorizeFileParent(r.Context(), claims(r).Subject, p, "restricted", fileAttach)}})
}

func (app *application) listProgramAttachments(w http.ResponseWriter, r *http.Request) {
	app.listAttachments(w, r, programFileParent)
}
func (app *application) listProductionProgramAttachments(w http.ResponseWriter, r *http.Request) {
	app.listAttachments(w, r, productionProgramFileParent)
}

type attachmentUploadInput struct {
	Filename    string  `json:"filename"`
	ContentType string  `json:"content_type"`
	SizeBytes   int64   `json:"size_bytes"`
	FileTypeID  *string `json:"file_type_id"`
	Restricted  bool    `json:"restricted"`
}

func (app *application) createAttachment(w http.ResponseWriter, r *http.Request, kind fileParentKind) {
	p, err := app.parentFromRoute(r, kind)
	if err != nil {
		errorJSON(w, 404, "parent_not_found", "节目不存在")
		return
	}
	var in attachmentUploadInput
	if !decodeJSON(w, r, &in) {
		return
	}
	valid, rights := app.attachmentFileType(r.Context(), p.WorkspaceID, in.FileTypeID)
	if !valid {
		errorJSON(w, 400, "invalid_file_type", "文件类型不属于当前工作空间节目范围")
		return
	}
	securityClass := "standard"
	if in.Restricted || rights {
		securityClass = "restricted"
	}
	if !app.authorizeFileParent(r.Context(), claims(r).Subject, p, securityClass, fileAttach) {
		errorJSON(w, 404, "parent_not_found", "节目不存在或无权访问")
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
	fileID, attachmentID := newID(), newID()
	filename := cleanFilename(in.Filename)
	placeholder := "ws/" + p.WorkspaceID + "/staging/" + newID()
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	_, err = tx.Exec(r.Context(), `INSERT INTO files(id,workspace_id,production_id,bucket,object_key,filename,content_type,size_bytes,created_by,access_mode)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'attachment')`, fileID, p.WorkspaceID, nullableProduction(p), s.bucket, placeholder, filename, in.ContentType, in.SizeBytes, claims(r).Subject)
	if err != nil {
		serverError(w, err)
		return
	}
	_, err = tx.Exec(r.Context(), `INSERT INTO file_attachments(id,workspace_id,file_id,file_type_id,security_class,created_by) VALUES($1,$2,$3,$4,$5,$6)`, attachmentID, p.WorkspaceID, fileID, in.FileTypeID, securityClass, claims(r).Subject)
	if err != nil {
		serverError(w, err)
		return
	}
	adapter := app.fileParentAdapter(kind)
	if adapter == nil {
		serverError(w, pgx.ErrNoRows)
		return
	}
	err = adapter.Attach(r.Context(), tx, attachmentID, p)
	if err != nil {
		serverError(w, err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	u, err := app.createFileUploadSession(r.Context(), s, p.WorkspaceID, fileID, claims(r).Subject, filename, in.ContentType, in.SizeBytes)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 201, map[string]any{"attachment_id": attachmentID, "file_id": fileID, "upload": u})
}

func nullableProduction(p fileParent) *string {
	if p.ProductionID == "" {
		return nil
	}
	return &p.ProductionID
}
func (app *application) createProgramAttachment(w http.ResponseWriter, r *http.Request) {
	app.createAttachment(w, r, programFileParent)
}
func (app *application) createProductionProgramAttachment(w http.ResponseWriter, r *http.Request) {
	app.createAttachment(w, r, productionProgramFileParent)
}

func (app *application) listAttachmentVersions(w http.ResponseWriter, r *http.Request) {
	a, ok := app.requireAttachmentAction(w, r, fileView)
	if !ok {
		return
	}
	items, err := app.listVersionsForFile(r.Context(), a.FileID)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items, "total": len(items)})
}

func (app *application) startAttachmentVersion(w http.ResponseWriter, r *http.Request) {
	a, ok := app.requireAttachmentAction(w, r, fileUploadVersion)
	if !ok {
		return
	}
	if a.Status != "uploaded" {
		errorJSON(w, 409, "file_not_uploaded", "附件尚未上传完成")
		return
	}
	var in attachmentUploadInput
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
	u, err := app.createFileUploadSession(r.Context(), s, a.Parent.WorkspaceID, a.FileID, claims(r).Subject, cleanFilename(in.Filename), in.ContentType, in.SizeBytes)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 201, map[string]any{"upload": u})
}

func (app *application) downloadAttachment(w http.ResponseWriter, r *http.Request) {
	a, ok := app.requireAttachmentAction(w, r, fileDownload)
	if !ok {
		return
	}
	if a.Status != "uploaded" {
		errorJSON(w, 404, "attachment_not_found", "附件不存在")
		return
	}
	versionID := strings.TrimSpace(r.URL.Query().Get("version_id"))
	if versionID == "" {
		if err := app.db.QueryRow(r.Context(), `SELECT v.id FROM files f JOIN file_versions v ON v.id=f.current_version_id
			WHERE f.id=$1 AND v.security_status='clean' AND v.object_purged_at IS NULL`, a.FileID).Scan(&versionID); err != nil {
			errorJSON(w, 404, "version_not_ready", "附件尚无通过安全检查的版本")
			return
		}
	}
	app.presignVersion(w, r, a.FileID, versionID)
}

func (app *application) detachFile(w http.ResponseWriter, r *http.Request) {
	_, ok := app.requireAttachmentAction(w, r, fileDetach)
	if !ok {
		return
	}
	tag, err := app.db.Exec(r.Context(), `UPDATE file_attachments SET deleted_at=NOW() WHERE id=$1 AND deleted_at IS NULL`, r.PathValue("attachmentId"))
	if err != nil {
		serverError(w, err)
		return
	}
	if tag.RowsAffected() != 1 {
		errorJSON(w, 404, "attachment_not_found", "附件不存在")
		return
	}
	writeJSON(w, 200, map[string]string{"status": "detached"})
}

func (app *application) copyProductionProgramAttachment(w http.ResponseWriter, r *http.Request) {
	p, err := app.parentFromRoute(r, productionProgramFileParent)
	if err != nil {
		errorJSON(w, 404, "parent_not_found", "活动节目不存在")
		return
	}
	var in struct {
		AttachmentID string `json:"attachment_id"`
		VersionID    string `json:"version_id"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	source, err := app.loadAttachmentAccess(r.Context(), in.AttachmentID)
	if err != nil || source.Parent.WorkspaceID != p.WorkspaceID || source.Status != "uploaded" || !app.authorizeFileParent(r.Context(), claims(r).Subject, source.Parent, source.SecurityClass, fileDownload) {
		errorJSON(w, 404, "attachment_not_found", "来源附件不存在或无权访问")
		return
	}
	if !app.authorizeFileParent(r.Context(), claims(r).Subject, p, source.SecurityClass, fileAttach) {
		errorJSON(w, 404, "parent_not_found", "目标活动节目不存在或无权修改")
		return
	}
	versionID := in.VersionID
	if versionID == "" {
		if err := app.db.QueryRow(r.Context(), `SELECT v.id FROM files f JOIN file_versions v ON v.id=f.current_version_id
			WHERE f.id=$1 AND v.security_status='clean' AND v.object_purged_at IS NULL`, source.FileID).Scan(&versionID); err != nil {
			errorJSON(w, 409, "version_not_ready", "来源附件尚无通过安全检查的版本")
			return
		}
	}
	var bucket, key, filename, contentType, sourceETag string
	var size int64
	err = app.db.QueryRow(r.Context(), `SELECT bucket,object_key,filename,content_type,size_bytes,etag FROM file_versions
		WHERE id=$1 AND file_id=$2 AND security_status='clean' AND object_purged_at IS NULL`, versionID, source.FileID).Scan(&bucket, &key, &filename, &contentType, &size, &sourceETag)
	if err != nil {
		errorJSON(w, 404, "version_not_found", "来源版本不存在")
		return
	}
	s := app.storageRequired(w)
	if s == nil {
		return
	}
	newFileID, newVersionID, newAttachmentID := newID(), newID(), newID()
	finalKey := immutableKey(p.WorkspaceID, newVersionID)
	if err = app.recordCopyAttempt(r.Context(), p.WorkspaceID, s, newVersionID); err != nil {
		serverError(w, err)
		return
	}
	etag, err := copyImmutableObject(r.Context(), s, bucket, key, sourceETag, size, finalKey)
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
	_, err = tx.Exec(r.Context(), `INSERT INTO files(id,workspace_id,production_id,bucket,object_key,filename,content_type,size_bytes,etag,status,created_by,access_mode)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'uploaded',$10,'attachment')`, newFileID, p.WorkspaceID, p.ProductionID, s.bucket, finalKey, filename, contentType, size, etag, claims(r).Subject)
	if err != nil {
		serverError(w, err)
		return
	}
	_, err = tx.Exec(r.Context(), `INSERT INTO file_versions(id,workspace_id,file_id,version_no,bucket,object_key,filename,content_type,size_bytes,etag,created_by,source_file_id,source_version_id,frozen_at)
		VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())`, newVersionID, p.WorkspaceID, newFileID, s.bucket, finalKey, filename, contentType, size, etag, claims(r).Subject, source.FileID, versionID)
	if err != nil {
		serverError(w, err)
		return
	}
	_, err = tx.Exec(r.Context(), `INSERT INTO file_attachments(id,workspace_id,file_id,file_type_id,security_class,created_by) VALUES($1,$2,$3,$4,$5,$6)`, newAttachmentID, p.WorkspaceID, newFileID, source.FileTypeID, source.SecurityClass, claims(r).Subject)
	if err != nil {
		serverError(w, err)
		return
	}
	_, err = tx.Exec(r.Context(), `INSERT INTO production_program_file_attachments(attachment_id,workspace_id,production_id,production_program_id) VALUES($1,$2,$3,$4)`, newAttachmentID, p.WorkspaceID, p.ProductionID, p.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	if err = commitCopyAttempt(r.Context(), tx, newVersionID); err != nil {
		serverError(w, err)
		return
	}
	_, err = tx.Exec(r.Context(), `INSERT INTO file_scan_tasks(id,workspace_id,file_id,version_id,idempotency_key) VALUES($1,$2,$3,$4,$5)`, "scan-"+newVersionID, p.WorkspaceID, newFileID, newVersionID, "version:"+newVersionID)
	if err != nil {
		serverError(w, err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	committed = true
	writeJSON(w, http.StatusAccepted, map[string]any{"attachment_id": newAttachmentID, "file_id": newFileID, "version_id": newVersionID, "status": "processing"})
}
