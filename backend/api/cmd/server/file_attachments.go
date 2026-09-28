package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

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
	mux.Handle("POST /v1/attachments/{attachmentId}/restore", app.auth(http.HandlerFunc(app.restoreAttachment)))
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
	trash := r.URL.Query().Get("trash") == "true"
	action := fileView
	if trash {
		action = fileAttach
	}
	if err != nil || !app.authorizeFileParent(r.Context(), claims(r).Subject, p, "standard", action) {
		errorJSON(w, 404, "parent_not_found", "节目不存在或无权访问")
		return
	}
	adapter := app.fileParentAdapter(kind)
	if adapter == nil {
		serverError(w, pgx.ErrNoRows)
		return
	}
	var rows pgx.Rows
	if trash {
		rows, err = adapter.ListTrash(r.Context(), app.db, p)
	} else {
		rows, err = adapter.List(r.Context(), app.db, p)
	}
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
		var contentPurged bool
		var restoreUntil *time.Time
		if err := rows.Scan(&a.ID, &a.FileID, &a.FileTypeID, &a.SecurityClass, &a.Status, &versionID, &versionNo, &filename, &contentType, &size, &scanStatus, &hasCleanVersion, &restoreUntil, &contentPurged); err != nil {
			serverError(w, err)
			return
		}
		a.Parent = p
		a.HasCleanVersion = hasCleanVersion
		if !app.authorizeFileParent(r.Context(), claims(r).Subject, p, a.SecurityClass, action) {
			continue
		}
		item := map[string]any{"id": a.ID, "file_id": a.FileID, "file_type_id": a.FileTypeID, "security_class": a.SecurityClass, "version_id": versionID, "version_no": versionNo, "filename": filename, "content_type": contentType, "size_bytes": size, "scan_status": publicScanStatus(scanStatus), "has_clean_version": hasCleanVersion, "capabilities": app.fileCapabilities(r.Context(), claims(r).Subject, a)}
		if trash {
			item["restore_until"] = restoreUntil
			item["content_purged"] = contentPurged
			item["capabilities"] = map[string]bool{"can_restore": restoreUntil != nil && restoreUntil.After(time.Now())}
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		serverError(w, err)
		return
	}
	capabilities := map[string]bool{"can_attach": app.authorizeFileParent(r.Context(), claims(r).Subject, p, "standard", fileAttach), "can_attach_restricted": app.authorizeFileParent(r.Context(), claims(r).Subject, p, "restricted", fileAttach)}
	if trash {
		capabilities = map[string]bool{"can_restore": true}
	}
	writeJSON(w, 200, map[string]any{"items": items, "total": len(items), "capabilities": capabilities})
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
	adapter := app.fileParentAdapter(kind)
	if adapter == nil {
		serverError(w, pgx.ErrNoRows)
		return
	}
	policy, err := adapter.UploadPolicy(r.Context(), p)
	if err != nil {
		serverError(w, err)
		return
	}
	if err := validateFileUploadSize(policy, in.SizeBytes, s.maxBytes); err != nil {
		writeFileStorageError(w, err)
		return
	}
	if in.ContentType == "" {
		in.ContentType = "application/octet-stream"
	}
	idempotencyKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if len(idempotencyKey) > 200 {
		writeFileStorageError(w, storageError(http.StatusBadRequest, "invalid_idempotency_key", "上传请求标识无效"))
		return
	}
	if idempotencyKey != "" {
		existing, err := findIdempotentFileUpload(r.Context(), app.db, p.WorkspaceID, claims(r).Subject, idempotencyKey)
		if err != nil {
			serverError(w, err)
			return
		}
		if existing != nil {
			if existing.ExpectedSize != in.SizeBytes || existing.Filename != cleanFilename(in.Filename) || existing.ContentType != in.ContentType {
				writeFileStorageError(w, storageError(http.StatusConflict, "idempotency_conflict", "该上传请求标识已用于不同文件"))
				return
			}
			var attachmentID string
			var existingType *string
			var existingClass string
			query := `SELECT a.id,a.file_type_id,a.security_class FROM file_attachments a JOIN files f ON f.id=a.file_id AND f.workspace_id=a.workspace_id
				JOIN program_file_attachments x ON x.attachment_id=a.id
				WHERE a.file_id=$1 AND a.deleted_at IS NULL AND f.deleted_at IS NULL AND x.workspace_id=$2 AND x.program_id=$3`
			args := []any{existing.FileID, p.WorkspaceID, p.ID}
			if kind == productionProgramFileParent {
				query = `SELECT a.id,a.file_type_id,a.security_class FROM file_attachments a JOIN files f ON f.id=a.file_id AND f.workspace_id=a.workspace_id
					JOIN production_program_file_attachments x ON x.attachment_id=a.id
					WHERE a.file_id=$1 AND a.deleted_at IS NULL AND f.deleted_at IS NULL AND x.workspace_id=$2 AND x.production_id=$3 AND x.production_program_id=$4`
				args = []any{existing.FileID, p.WorkspaceID, p.ProductionID, p.ID}
			}
			err = app.db.QueryRow(r.Context(), query, args...).Scan(&attachmentID, &existingType, &existingClass)
			if err != nil || !sameOptionalString(existingType, in.FileTypeID) || existingClass != securityClass {
				writeFileStorageError(w, storageError(http.StatusConflict, "idempotency_conflict", "该上传请求标识已用于其他附件"))
				return
			}
			var upload map[string]any
			statusCode := http.StatusOK
			if existing.Status == "pending" {
				upload, err = app.createFileUploadSession(r.Context(), s, p.WorkspaceID, existing.FileID, claims(r).Subject, cleanFilename(in.Filename), in.ContentType, in.SizeBytes, policy, idempotencyKey)
			} else if existing.Status == "completed" {
				upload = map[string]any{"id": existing.ID, "upload_id": existing.ID, "transport": "completed"}
				statusCode = http.StatusAccepted
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
			writeJSON(w, statusCode, map[string]any{"attachment_id": attachmentID, "file_id": existing.FileID, "upload": upload})
			return
		}
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
	err = adapter.Attach(r.Context(), tx, attachmentID, p)
	if err != nil {
		serverError(w, err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	u, err := app.createFileUploadSession(r.Context(), s, p.WorkspaceID, fileID, claims(r).Subject, filename, in.ContentType, in.SizeBytes, policy, idempotencyKey)
	if err != nil {
		_, _ = app.db.Exec(r.Context(), `UPDATE file_attachments SET deleted_at=NOW(),purge_after=NOW()+INTERVAL '30 days' WHERE id=$1 AND deleted_at IS NULL`, attachmentID)
		_, _ = app.db.Exec(r.Context(), `UPDATE files SET deleted_at=NOW(),purge_after=NOW()+INTERVAL '30 days',updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL`, fileID)
		if !writeFileStorageError(w, err) {
			serverError(w, err)
		}
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
	adapter := app.fileParentAdapter(a.Parent.Kind)
	if adapter == nil {
		serverError(w, pgx.ErrNoRows)
		return
	}
	policy, err := adapter.UploadPolicy(r.Context(), a.Parent)
	if err != nil {
		serverError(w, err)
		return
	}
	if err := validateFileUploadSize(policy, in.SizeBytes, s.maxBytes); err != nil {
		writeFileStorageError(w, err)
		return
	}
	if in.ContentType == "" {
		in.ContentType = "application/octet-stream"
	}
	u, err := app.createFileUploadSession(r.Context(), s, a.Parent.WorkspaceID, a.FileID, claims(r).Subject, cleanFilename(in.Filename), in.ContentType, in.SizeBytes, policy, r.Header.Get("Idempotency-Key"))
	if err != nil {
		if !writeFileStorageError(w, err) {
			serverError(w, err)
		}
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
	a, ok := app.requireAttachmentAction(w, r, fileDetach)
	if !ok {
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	if err := ensureWorkspaceStorageAccount(r.Context(), tx, a.Parent.WorkspaceID); err != nil {
		serverError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `SELECT 1 FROM workspace_storage_accounts WHERE workspace_id=$1 FOR UPDATE`, a.Parent.WorkspaceID); err != nil {
		serverError(w, err)
		return
	}
	var fileID string
	err = tx.QueryRow(r.Context(), `SELECT file_id FROM file_attachments WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, a.ID).Scan(&fileID)
	if err != nil || fileID != a.FileID {
		errorJSON(w, 404, "attachment_not_found", "附件不存在")
		return
	}
	if _, err := tx.Exec(r.Context(), `UPDATE file_attachments SET deleted_at=NOW(),purge_after=NOW()+INTERVAL '30 days' WHERE id=$1 AND deleted_at IS NULL`, a.ID); err != nil {
		serverError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `UPDATE files SET deleted_at=NOW(),purge_after=NOW()+INTERVAL '30 days',updated_at=NOW()
		WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`, a.FileID, a.Parent.WorkspaceID); err != nil {
		serverError(w, err)
		return
	}
	if err := releaseVersionChargeTx(r.Context(), tx, a.Parent.WorkspaceID, a.FileID, claims(r).Subject, "attachment_detached"); err != nil {
		serverError(w, err)
		return
	}
	if err := cancelPendingFileSessionsTx(r.Context(), tx, a.Parent.WorkspaceID, a.FileID, claims(r).Subject); err != nil {
		serverError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, map[string]string{"status": "detached"})
}

func (app *application) restoreAttachment(w http.ResponseWriter, r *http.Request) {
	var a attachmentAccess
	var programID, productionID, productionProgramID *string
	var purgeAfter, filePurgeAfter *time.Time
	var contentPurged bool
	err := app.db.QueryRow(r.Context(), `SELECT a.id,a.file_id,a.file_type_id,a.security_class,a.workspace_id,
		a.purge_after,f.purge_after,
		p.program_id,pp.production_id,pp.production_program_id,
		NOT EXISTS(SELECT 1 FROM file_versions v WHERE v.file_id=f.id AND v.object_purged_at IS NULL)
		FROM file_attachments a JOIN files f ON f.id=a.file_id AND f.workspace_id=a.workspace_id
		LEFT JOIN program_file_attachments p ON p.attachment_id=a.id
		LEFT JOIN production_program_file_attachments pp ON pp.attachment_id=a.id
		WHERE a.id=$1 AND a.deleted_at IS NOT NULL AND f.deleted_at IS NOT NULL`, r.PathValue("attachmentId")).
		Scan(&a.ID, &a.FileID, &a.FileTypeID, &a.SecurityClass, &a.Parent.WorkspaceID, &purgeAfter, &filePurgeAfter, &programID, &productionID, &productionProgramID, &contentPurged)
	if err != nil {
		errorJSON(w, http.StatusNotFound, "attachment_not_found", "回收站附件不存在")
		return
	}
	// Use the earlier deadline so restoring an attachment never extends the
	// retention window of either its relation or underlying file.
	if filePurgeAfter != nil && (purgeAfter == nil || filePurgeAfter.Before(*purgeAfter)) {
		purgeAfter = filePurgeAfter
	}
	if programID != nil && productionProgramID == nil {
		a.Parent.Kind, a.Parent.ID = programFileParent, *programID
	} else if productionProgramID != nil && productionID != nil && programID == nil {
		a.Parent.Kind, a.Parent.ID, a.Parent.ProductionID = productionProgramFileParent, *productionProgramID, *productionID
	} else {
		errorJSON(w, http.StatusNotFound, "attachment_not_found", "附件关联无效")
		return
	}
	if _, err := app.resolveFileParent(r.Context(), a.Parent); err != nil || !app.authorizeFileParent(r.Context(), claims(r).Subject, a.Parent, a.SecurityClass, fileAttach) {
		errorJSON(w, http.StatusNotFound, "attachment_not_found", "附件不存在或无权恢复")
		return
	}
	if contentPurged || purgeAfter == nil || !purgeAfter.After(time.Now()) {
		errorJSON(w, http.StatusConflict, "restore_window_expired", "附件已超过恢复期限，内容已清除或无法恢复")
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	if err := ensureWorkspaceStorageAccount(r.Context(), tx, a.Parent.WorkspaceID); err != nil {
		serverError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `SELECT 1 FROM workspace_storage_accounts WHERE workspace_id=$1 FOR UPDATE`, a.Parent.WorkspaceID); err != nil {
		serverError(w, err)
		return
	}
	if err := chargeRestoredFileTx(r.Context(), tx, a.Parent.WorkspaceID, a.FileID, claims(r).Subject); err != nil {
		if !writeFileStorageError(w, err) {
			serverError(w, err)
		}
		return
	}
	if _, err := tx.Exec(r.Context(), `UPDATE files SET deleted_at=NULL,purge_after=NULL,updated_at=NOW()
		WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NOT NULL`, a.FileID, a.Parent.WorkspaceID); err != nil {
		serverError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `UPDATE file_attachments SET deleted_at=NULL,purge_after=NULL WHERE id=$1 AND deleted_at IS NOT NULL`, a.ID); err != nil {
		serverError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"attachment_id": a.ID, "status": "restored"})
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
	adapter := app.fileParentAdapter(p.Kind)
	if adapter == nil {
		serverError(w, pgx.ErrNoRows)
		return
	}
	policy, err := adapter.UploadPolicy(r.Context(), p)
	if err != nil {
		serverError(w, err)
		return
	}
	if err := validateFileUploadSize(policy, size, s.maxBytes); err != nil {
		writeFileStorageError(w, err)
		return
	}
	if policy.MaxBytes <= 0 {
		policy.MaxBytes = hardMaxFileBytes
	}
	idempotencyKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if idempotencyKey != "" {
		var reservationID, reservationStatus string
		err := app.db.QueryRow(r.Context(), `SELECT id,status FROM workspace_storage_reservations
			WHERE workspace_id=$1 AND user_id=$2 AND idempotency_key=$3`, p.WorkspaceID, claims(r).Subject, idempotencyKey).
			Scan(&reservationID, &reservationStatus)
		if err == nil {
			if reservationStatus == "committed" {
				var copiedFileID, copiedVersionID, copiedAttachmentID, copiedSourceID, copiedSourceVersionID, scanStatus string
				query := `SELECT v.file_id,v.id,a.id,v.source_file_id,v.source_version_id,v.security_status
					FROM file_copy_attempts c JOIN file_versions v ON v.id=c.id AND v.workspace_id=c.workspace_id
					JOIN file_attachments a ON a.file_id=v.file_id AND a.workspace_id=v.workspace_id AND a.deleted_at IS NULL
					JOIN production_program_file_attachments x ON x.attachment_id=a.id
					WHERE c.storage_reservation_id=$1 AND c.status='committed' AND x.workspace_id=$2
					AND x.production_id=$3 AND x.production_program_id=$4`
				err = app.db.QueryRow(r.Context(), query, reservationID, p.WorkspaceID, p.ProductionID, p.ID).
					Scan(&copiedFileID, &copiedVersionID, &copiedAttachmentID, &copiedSourceID, &copiedSourceVersionID, &scanStatus)
				if err != nil || copiedSourceID != source.FileID || copiedSourceVersionID != versionID {
					writeFileStorageError(w, storageError(http.StatusConflict, "idempotency_conflict", "该复制请求标识已用于其他来源或目标"))
					return
				}
				writeJSON(w, http.StatusAccepted, map[string]any{"attachment_id": copiedAttachmentID, "file_id": copiedFileID,
					"version_id": copiedVersionID, "status": publicScanStatus(scanStatus)})
				return
			}
			if reservationStatus == "reserved" {
				writeFileStorageError(w, storageError(http.StatusConflict, "idempotency_in_progress", "该固定版本复制正在处理"))
				return
			}
			writeFileStorageError(w, storageError(http.StatusConflict, "idempotency_conflict", "该复制请求标识已结束，请为新的复制请求生成新标识"))
			return
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			serverError(w, err)
			return
		}
	}
	allowedTypes, err := json.Marshal(policy.AllowedContentTypes)
	if err != nil {
		serverError(w, err)
		return
	}
	reservationID, err := reserveCopyStorage(r.Context(), app.db, p.WorkspaceID, claims(r).Subject, idempotencyKey, size, s.physicalMaxBytes)
	if err != nil {
		if !writeFileStorageError(w, err) {
			serverError(w, err)
		}
		return
	}
	newFileID, newVersionID, newAttachmentID := newID(), newID(), newID()
	finalKey := immutableKey(p.WorkspaceID, newVersionID)
	if err = app.recordCopyAttempt(r.Context(), p.WorkspaceID, s, newVersionID); err != nil {
		_ = releaseUncommittedCopyStorage(r.Context(), app.db, reservationID, p.WorkspaceID, claims(r).Subject, true)
		serverError(w, err)
		return
	}
	if _, err = app.db.Exec(r.Context(), `UPDATE file_copy_attempts SET storage_reservation_id=$2 WHERE id=$1`, newVersionID, reservationID); err != nil {
		_ = releaseUncommittedCopyStorage(r.Context(), app.db, reservationID, p.WorkspaceID, claims(r).Subject, true)
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
	if _, err := tx.Exec(r.Context(), `SELECT 1 FROM workspace_storage_accounts WHERE workspace_id=$1 FOR UPDATE`, p.WorkspaceID); err != nil {
		serverError(w, err)
		return
	}
	_, err = tx.Exec(r.Context(), `INSERT INTO files(id,workspace_id,production_id,bucket,object_key,filename,content_type,size_bytes,etag,status,created_by,access_mode)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'uploaded',$10,'attachment')`, newFileID, p.WorkspaceID, p.ProductionID, s.bucket, finalKey, filename, contentType, size, etag, claims(r).Subject)
	if err != nil {
		serverError(w, err)
		return
	}
	_, err = tx.Exec(r.Context(), `INSERT INTO file_versions(id,workspace_id,file_id,version_no,bucket,object_key,filename,content_type,size_bytes,etag,created_by,source_file_id,source_version_id,frozen_at,policy_max_bytes,allowed_content_types)
		VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),$13,$14::jsonb)`, newVersionID, p.WorkspaceID, newFileID, s.bucket, finalKey, filename, contentType, size, etag, claims(r).Subject, source.FileID, versionID, policy.MaxBytes, allowedTypes)
	if err != nil {
		serverError(w, err)
		return
	}
	if err = commitCopyStorageTx(r.Context(), tx, reservationID, p.WorkspaceID, claims(r).Subject, newVersionID, size); err != nil {
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
