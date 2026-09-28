package main

import (
	"context"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// fileParentAdapter is the only boundary between generic attachment use cases
// and the concrete Program / ProductionProgram domains. It knows typed
// associations and authorization, but never object storage or scanner details.
type fileParentAdapter interface {
	FromRoute(*http.Request) (fileParent, error)
	Resolve(context.Context, fileParent) (fileParent, error)
	Authorize(context.Context, string, fileParent, string, fileAction) bool
	Attach(context.Context, pgx.Tx, string, fileParent) error
	List(context.Context, *pgxpool.Pool, fileParent) (pgx.Rows, error)
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

func (a programAttachmentAdapter) Attach(ctx context.Context, tx pgx.Tx, attachmentID string, parent fileParent) error {
	_, err := tx.Exec(ctx, `INSERT INTO program_file_attachments(attachment_id,workspace_id,program_id) VALUES($1,$2,$3)`, attachmentID, parent.WorkspaceID, parent.ID)
	return err
}

func (a programAttachmentAdapter) List(ctx context.Context, db *pgxpool.Pool, parent fileParent) (pgx.Rows, error) {
	return db.Query(ctx, attachmentListQuery, parent.WorkspaceID, parent.ID)
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

func (a productionProgramAttachmentAdapter) Attach(ctx context.Context, tx pgx.Tx, attachmentID string, parent fileParent) error {
	_, err := tx.Exec(ctx, `INSERT INTO production_program_file_attachments(attachment_id,workspace_id,production_id,production_program_id) VALUES($1,$2,$3,$4)`, attachmentID, parent.WorkspaceID, parent.ProductionID, parent.ID)
	return err
}

const attachmentListQuery = `SELECT a.id,a.file_id,a.file_type_id,a.security_class,f.status,
	COALESCE(published.id,latest.id,''),COALESCE(published.version_no,latest.version_no,0),
	COALESCE(published.filename,latest.filename,f.filename),COALESCE(published.content_type,latest.content_type,f.content_type),
	COALESCE(published.size_bytes,latest.size_bytes,f.size_bytes),COALESCE(latest.security_status,'pending'),published.id IS NOT NULL
	FROM file_attachments a
	JOIN files f ON f.id=a.file_id AND f.workspace_id=a.workspace_id
	LEFT JOIN file_versions published ON published.id=f.current_version_id AND published.file_id=f.id AND published.security_status='clean' AND published.object_purged_at IS NULL
	LEFT JOIN LATERAL (SELECT v.id,v.version_no,v.filename,v.content_type,v.size_bytes,v.security_status
		FROM file_versions v WHERE v.file_id=f.id ORDER BY v.version_no DESC LIMIT 1) latest ON TRUE
	JOIN program_file_attachments x ON x.attachment_id=a.id
	WHERE x.workspace_id=$1 AND x.program_id=$2 AND a.deleted_at IS NULL AND f.deleted_at IS NULL
	ORDER BY a.created_at,a.id`

func (a productionProgramAttachmentAdapter) List(ctx context.Context, db *pgxpool.Pool, parent fileParent) (pgx.Rows, error) {
	query := strings.Replace(attachmentListQuery,
		`JOIN program_file_attachments x ON x.attachment_id=a.id
	WHERE x.workspace_id=$1 AND x.program_id=$2`,
		`JOIN production_program_file_attachments x ON x.attachment_id=a.id
	WHERE x.workspace_id=$1 AND x.production_program_id=$2 AND x.production_id=$3`, 1)
	return db.Query(ctx, query, parent.WorkspaceID, parent.ID, parent.ProductionID)
}
