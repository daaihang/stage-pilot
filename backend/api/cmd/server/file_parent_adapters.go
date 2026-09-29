package main

import (
	"context"
	"net/http"
)

// fileParentAdapter is the only boundary between generic attachment use cases
// and the concrete Program / ProductionProgram domains. It knows typed
// associations and authorization, but never object storage or scanner details.
type fileParentAdapter interface {
	FromRoute(*http.Request) (fileParent, error)
	Resolve(context.Context, fileParent) (fileParent, error)
	Authorize(context.Context, string, fileParent, string, fileAction) bool
	UploadPolicy(context.Context, fileParent) (fileUploadPolicy, error)
}

type programAttachmentAdapter struct{ app *application }
type productionProgramAttachmentAdapter struct{ app *application }

func (app *application) fileParentAdapter(kind fileParentKind) fileParentAdapter {
	switch kind {
	case programFileParent:
		return programAttachmentAdapter{app: app}
	case productionProgramFileParent:
		return productionProgramAttachmentAdapter{app: app}
	default:
		return nil
	}
}

func (a programAttachmentAdapter) FromRoute(r *http.Request) (fileParent, error) {
	return a.Resolve(r.Context(), fileParent{Kind: programFileParent, WorkspaceID: r.PathValue("id"), ID: r.PathValue("programId")})
}

func (a programAttachmentAdapter) Resolve(ctx context.Context, parent fileParent) (fileParent, error) {
	err := a.app.db.QueryRow(ctx, `SELECT workspace_id FROM programs WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`, parent.ID, parent.WorkspaceID).Scan(&parent.WorkspaceID)
	return parent, err
}

func (a programAttachmentAdapter) Authorize(ctx context.Context, userID string, parent fileParent, securityClass string, action fileAction) bool {
	role, err := a.app.workspaceFileRole(ctx, userID, parent.WorkspaceID)
	if err != nil {
		return false
	}
	write := action == fileAttach || action == fileUploadVersion || action == fileDetach || action == fileDelete
	if securityClass == "restricted" || write {
		return role == workspaceRoleOwner || role == workspaceRoleAdmin
	}
	return roleRank[role] >= roleRank[workspaceRoleMember]
}

func (a programAttachmentAdapter) UploadPolicy(ctx context.Context, parent fileParent) (fileUploadPolicy, error) {
	resolved, err := a.Resolve(ctx, parent)
	if err != nil {
		return fileUploadPolicy{}, err
	}
	_ = resolved
	return fileUploadPolicy{MaxBytes: hardMaxFileBytes}, nil
}

func (a productionProgramAttachmentAdapter) FromRoute(r *http.Request) (fileParent, error) {
	parent := fileParent{Kind: productionProgramFileParent, ID: r.PathValue("programId"), ProductionID: r.PathValue("productionId")}
	if err := a.app.db.QueryRow(r.Context(), `SELECT workspace_id FROM productions WHERE id=$1 AND deleted_at IS NULL`, parent.ProductionID).Scan(&parent.WorkspaceID); err != nil {
		return parent, err
	}
	return a.Resolve(r.Context(), parent)
}

func (a productionProgramAttachmentAdapter) Resolve(ctx context.Context, parent fileParent) (fileParent, error) {
	err := a.app.db.QueryRow(ctx, `SELECT workspace_id,production_id FROM production_programs
		WHERE id=$1 AND workspace_id=$2 AND production_id=$3`, parent.ID, parent.WorkspaceID, parent.ProductionID).Scan(&parent.WorkspaceID, &parent.ProductionID)
	return parent, err
}

func (a productionProgramAttachmentAdapter) Authorize(ctx context.Context, userID string, parent fileParent, securityClass string, action fileAction) bool {
	access, err := a.app.productionAccessFor(ctx, userID, parent.ProductionID)
	if err != nil || access.WorkspaceID != parent.WorkspaceID {
		return false
	}
	write := action == fileAttach || action == fileUploadVersion || action == fileDetach || action == fileDelete
	if securityClass == "restricted" {
		return access.WorkspaceRole == workspaceRoleOwner || access.WorkspaceRole == workspaceRoleAdmin || access.DirectRole == "producer"
	}
	if write {
		return access.Permissions[productionEdit]
	}
	return access.Permissions[productionView]
}

func (a productionProgramAttachmentAdapter) UploadPolicy(ctx context.Context, parent fileParent) (fileUploadPolicy, error) {
	resolved, err := a.Resolve(ctx, parent)
	if err != nil {
		return fileUploadPolicy{}, err
	}
	_ = resolved
	return fileUploadPolicy{MaxBytes: hardMaxFileBytes}, nil
}
