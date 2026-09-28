package main

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
)

type fileAction string

const (
	fileView          fileAction = "view"
	fileDownload      fileAction = "download"
	fileAttach        fileAction = "attach"
	fileUploadVersion fileAction = "upload_version"
	fileDetach        fileAction = "detach"
	fileDelete        fileAction = "delete"
)

type fileParentKind string

const (
	programFileParent           fileParentKind = "program"
	productionProgramFileParent fileParentKind = "production_program"
)

type fileParent struct {
	Kind         fileParentKind
	WorkspaceID  string
	ProductionID string
	ID           string
}

type attachmentAccess struct {
	ID              string
	FileID          string
	FileTypeID      *string
	SecurityClass   string
	Parent          fileParent
	Status          string
	HasCleanVersion bool
	Deleted         bool
}

// resolveFileParent is the allowlisted parent adapter. Neither a request's
// production_id nor an arbitrary table name can establish file access.
func (app *application) resolveFileParent(ctx context.Context, parent fileParent) (fileParent, error) {
	adapter := app.fileParentAdapter(parent.Kind)
	if adapter == nil {
		return fileParent{}, pgx.ErrNoRows
	}
	return adapter.Resolve(ctx, parent)
}

func (app *application) workspaceFileRole(ctx context.Context, userID, workspaceID string) (string, error) {
	var role string
	err := app.db.QueryRow(ctx, `SELECT m.role FROM workspace_memberships m JOIN workspaces w ON w.id=m.workspace_id
		WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='active' AND w.deleted_at IS NULL`, workspaceID, userID).Scan(&role)
	return role, err
}

func (app *application) authorizeFileParent(ctx context.Context, userID string, parent fileParent, securityClass string, action fileAction) bool {
	adapter := app.fileParentAdapter(parent.Kind)
	if adapter == nil {
		return false
	}
	return adapter.Authorize(ctx, userID, parent, securityClass, action)
}

func (app *application) loadAttachmentAccess(ctx context.Context, attachmentID string) (attachmentAccess, error) {
	var a attachmentAccess
	var programID, productionID, productionProgramID *string
	err := app.db.QueryRow(ctx, `SELECT a.id,a.file_id,a.file_type_id,a.security_class,f.status,
		p.program_id,pp.production_id,pp.production_program_id,a.workspace_id,
		EXISTS(SELECT 1 FROM file_versions v WHERE v.id=f.current_version_id AND v.file_id=f.id AND v.security_status='clean' AND v.object_purged_at IS NULL)
		FROM file_attachments a JOIN files f ON f.id=a.file_id AND f.workspace_id=a.workspace_id
		LEFT JOIN program_file_attachments p ON p.attachment_id=a.id
		LEFT JOIN production_program_file_attachments pp ON pp.attachment_id=a.id
		WHERE a.id=$1 AND a.deleted_at IS NULL AND f.deleted_at IS NULL`, attachmentID).Scan(
		&a.ID, &a.FileID, &a.FileTypeID, &a.SecurityClass, &a.Status,
		&programID, &productionID, &productionProgramID, &a.Parent.WorkspaceID, &a.HasCleanVersion)
	if err != nil {
		return a, err
	}
	if programID != nil && productionProgramID == nil {
		a.Parent.Kind, a.Parent.ID = programFileParent, *programID
	} else if productionProgramID != nil && programID == nil && productionID != nil {
		a.Parent.Kind, a.Parent.ID, a.Parent.ProductionID = productionProgramFileParent, *productionProgramID, *productionID
	} else {
		return a, errors.New("invalid attachment parent")
	}
	_, err = app.resolveFileParent(ctx, a.Parent)
	return a, err
}

func (app *application) requireAttachmentAction(w http.ResponseWriter, r *http.Request, action fileAction) (attachmentAccess, bool) {
	a, err := app.loadAttachmentAccess(r.Context(), r.PathValue("attachmentId"))
	if err != nil || !app.authorizeFileParent(r.Context(), claims(r).Subject, a.Parent, a.SecurityClass, action) {
		errorJSON(w, http.StatusNotFound, "attachment_not_found", "附件不存在或无权访问")
		return attachmentAccess{}, false
	}
	return a, true
}

func (app *application) fileCapabilities(ctx context.Context, userID string, a attachmentAccess) map[string]bool {
	return map[string]bool{
		"can_download":       a.HasCleanVersion && app.authorizeFileParent(ctx, userID, a.Parent, a.SecurityClass, fileDownload),
		"can_upload_version": a.Status == "uploaded" && app.authorizeFileParent(ctx, userID, a.Parent, a.SecurityClass, fileUploadVersion),
		"can_detach":         app.authorizeFileParent(ctx, userID, a.Parent, a.SecurityClass, fileDetach),
	}
}
