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
	ID            string
	FileID        string
	FileTypeID    *string
	SecurityClass string
	Parent        fileParent
	Status        string
	Deleted       bool
}

// resolveFileParent is the allowlisted parent adapter. Neither a request's
// production_id nor an arbitrary table name can establish file access.
func (app *application) resolveFileParent(ctx context.Context, parent fileParent) (fileParent, error) {
	switch parent.Kind {
	case programFileParent:
		err := app.db.QueryRow(ctx, `SELECT workspace_id FROM programs WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`, parent.ID, parent.WorkspaceID).Scan(&parent.WorkspaceID)
		return parent, err
	case productionProgramFileParent:
		err := app.db.QueryRow(ctx, `SELECT workspace_id,production_id FROM production_programs
			WHERE id=$1 AND workspace_id=$2 AND production_id=$3`, parent.ID, parent.WorkspaceID, parent.ProductionID).Scan(&parent.WorkspaceID, &parent.ProductionID)
		return parent, err
	default:
		return fileParent{}, pgx.ErrNoRows
	}
}

func (app *application) workspaceFileRole(ctx context.Context, userID, workspaceID string) (string, error) {
	var role string
	err := app.db.QueryRow(ctx, `SELECT m.role FROM workspace_memberships m JOIN workspaces w ON w.id=m.workspace_id
		WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='active' AND w.deleted_at IS NULL`, workspaceID, userID).Scan(&role)
	return role, err
}

func (app *application) authorizeFileParent(ctx context.Context, userID string, parent fileParent, securityClass string, action fileAction) bool {
	write := action == fileAttach || action == fileUploadVersion || action == fileDetach || action == fileDelete
	switch parent.Kind {
	case programFileParent:
		role, err := app.workspaceFileRole(ctx, userID, parent.WorkspaceID)
		if err != nil {
			return false
		}
		if securityClass == "restricted" || write {
			return role == workspaceRoleOwner || role == workspaceRoleAdmin
		}
		return roleRank[role] >= roleRank[workspaceRoleMember]
	case productionProgramFileParent:
		access, err := app.productionAccessFor(ctx, userID, parent.ProductionID)
		if err != nil || access.WorkspaceID != parent.WorkspaceID {
			return false
		}
		if securityClass == "restricted" {
			return access.WorkspaceRole == workspaceRoleOwner || access.WorkspaceRole == workspaceRoleAdmin || access.DirectRole == "producer"
		}
		if write {
			return access.Permissions[productionEdit]
		}
		return access.Permissions[productionView]
	default:
		return false
	}
}

func (app *application) loadAttachmentAccess(ctx context.Context, attachmentID string) (attachmentAccess, error) {
	var a attachmentAccess
	var programID, productionID, productionProgramID *string
	err := app.db.QueryRow(ctx, `SELECT a.id,a.file_id,a.file_type_id,a.security_class,f.status,
		p.program_id,pp.production_id,pp.production_program_id,a.workspace_id
		FROM file_attachments a JOIN files f ON f.id=a.file_id AND f.workspace_id=a.workspace_id
		LEFT JOIN program_file_attachments p ON p.attachment_id=a.id
		LEFT JOIN production_program_file_attachments pp ON pp.attachment_id=a.id
		WHERE a.id=$1 AND a.deleted_at IS NULL AND f.deleted_at IS NULL`, attachmentID).Scan(
		&a.ID, &a.FileID, &a.FileTypeID, &a.SecurityClass, &a.Status,
		&programID, &productionID, &productionProgramID, &a.Parent.WorkspaceID)
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
		"can_download":       app.authorizeFileParent(ctx, userID, a.Parent, a.SecurityClass, fileDownload),
		"can_upload_version": app.authorizeFileParent(ctx, userID, a.Parent, a.SecurityClass, fileUploadVersion),
		"can_detach":         app.authorizeFileParent(ctx, userID, a.Parent, a.SecurityClass, fileDetach),
	}
}
