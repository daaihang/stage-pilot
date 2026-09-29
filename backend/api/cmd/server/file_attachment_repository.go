package main

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// fileAttachmentRepository owns typed association persistence and attachment
// queries. Parent adapters resolve domain records and decide access; they do
// not own generic attachment storage concerns.
type fileAttachmentRepository struct{ db *pgxpool.Pool }

func (app *application) fileAttachments() fileAttachmentRepository {
	return fileAttachmentRepository{db: app.db}
}

func (repo fileAttachmentRepository) Attach(ctx context.Context, tx pgx.Tx, attachmentID string, parent fileParent) error {
	switch parent.Kind {
	case programFileParent:
		_, err := tx.Exec(ctx, `INSERT INTO program_file_attachments(attachment_id,workspace_id,program_id) VALUES($1,$2,$3)`, attachmentID, parent.WorkspaceID, parent.ID)
		return err
	case productionProgramFileParent:
		_, err := tx.Exec(ctx, `INSERT INTO production_program_file_attachments(attachment_id,workspace_id,production_id,production_program_id) VALUES($1,$2,$3,$4)`, attachmentID, parent.WorkspaceID, parent.ProductionID, parent.ID)
		return err
	default:
		return pgx.ErrNoRows
	}
}

func (repo fileAttachmentRepository) ListPage(ctx context.Context, parent fileParent, trash, restricted bool, limit int, cursor *fileListCursor) (pgx.Rows, error) {
	query := attachmentListQuery
	args := []any{parent.WorkspaceID, parent.ID}
	if parent.Kind == productionProgramFileParent {
		query = strings.Replace(query,
			`JOIN program_file_attachments x ON x.attachment_id=a.id
	WHERE x.workspace_id=$1 AND x.program_id=$2`,
			`JOIN production_program_file_attachments x ON x.attachment_id=a.id
	WHERE x.workspace_id=$1 AND x.production_program_id=$2 AND x.production_id=$3`, 1)
		args = append(args, parent.ProductionID)
	} else if parent.Kind != programFileParent {
		return nil, pgx.ErrNoRows
	}
	if trash {
		query = strings.Replace(query, "a.deleted_at IS NULL AND f.deleted_at IS NULL", "a.deleted_at IS NOT NULL AND f.deleted_at IS NOT NULL", 1)
	}
	cursorAt, cursorID := any(nil), ""
	if cursor != nil {
		cursorAt, cursorID = cursor.CreatedAt, cursor.ID
	}
	if parent.Kind == productionProgramFileParent {
		query += ` AND (a.security_class='standard' OR $4::boolean) AND ($5::timestamptz IS NULL OR (a.created_at,a.id)<($5::timestamptz,$6)) ORDER BY a.created_at DESC,a.id DESC LIMIT $7`
		args = append(args, restricted, cursorAt, cursorID, limit+1)
	} else {
		query += ` AND (a.security_class='standard' OR $3::boolean) AND ($4::timestamptz IS NULL OR (a.created_at,a.id)<($4::timestamptz,$5)) ORDER BY a.created_at DESC,a.id DESC LIMIT $6`
		args = append(args, restricted, cursorAt, cursorID, limit+1)
	}
	return repo.db.Query(ctx, query, args...)
}

func (repo fileAttachmentRepository) Count(ctx context.Context, parent fileParent, trash, restricted bool) (int64, error) {
	state := "a.deleted_at IS NULL AND f.deleted_at IS NULL"
	if trash {
		state = "a.deleted_at IS NOT NULL AND f.deleted_at IS NOT NULL"
	}
	var query string
	var args []any
	switch parent.Kind {
	case programFileParent:
		query = `SELECT COUNT(*) FROM file_attachments a JOIN files f ON f.id=a.file_id AND f.workspace_id=a.workspace_id JOIN program_file_attachments x ON x.attachment_id=a.id WHERE x.workspace_id=$1 AND x.program_id=$2 AND ` + state + ` AND (a.security_class='standard' OR $3::boolean)`
		args = []any{parent.WorkspaceID, parent.ID, restricted}
	case productionProgramFileParent:
		query = `SELECT COUNT(*) FROM file_attachments a JOIN files f ON f.id=a.file_id AND f.workspace_id=a.workspace_id JOIN production_program_file_attachments x ON x.attachment_id=a.id WHERE x.workspace_id=$1 AND x.production_program_id=$2 AND x.production_id=$3 AND ` + state + ` AND (a.security_class='standard' OR $4::boolean)`
		args = []any{parent.WorkspaceID, parent.ID, parent.ProductionID, restricted}
	default:
		return 0, pgx.ErrNoRows
	}
	var total int64
	err := repo.db.QueryRow(ctx, query, args...).Scan(&total)
	return total, err
}

const attachmentListQuery = `SELECT a.id,a.file_id,a.file_type_id,a.security_class,f.status,
	COALESCE(published.id,latest.id,''),COALESCE(published.version_no,latest.version_no,0),
	COALESCE(published.filename,latest.filename,f.filename),COALESCE(published.content_type,latest.content_type,f.content_type),
	COALESCE(published.size_bytes,latest.size_bytes,f.size_bytes),COALESCE(latest.security_status,'pending'),published.id IS NOT NULL,
	COALESCE(a.purge_after,f.purge_after),NOT EXISTS(SELECT 1 FROM file_versions purged WHERE purged.file_id=f.id AND purged.object_purged_at IS NULL),a.created_at
	FROM file_attachments a
	JOIN files f ON f.id=a.file_id AND f.workspace_id=a.workspace_id
	LEFT JOIN file_versions published ON published.id=f.current_version_id AND published.file_id=f.id AND published.security_status='clean' AND published.object_purged_at IS NULL
	LEFT JOIN LATERAL (SELECT v.id,v.version_no,v.filename,v.content_type,v.size_bytes,v.security_status
		FROM file_versions v WHERE v.file_id=f.id ORDER BY v.version_no DESC LIMIT 1) latest ON TRUE
	JOIN program_file_attachments x ON x.attachment_id=a.id
	WHERE x.workspace_id=$1 AND x.program_id=$2 AND a.deleted_at IS NULL AND f.deleted_at IS NULL`
