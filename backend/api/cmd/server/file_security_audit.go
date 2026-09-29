package main

import (
	"context"
	"net/http"

	"github.com/google/uuid"
)

func (app *application) recordSensitiveFileEvent(ctx context.Context, r *http.Request, actor, action, result, basis string, a attachmentAccess, versionIDs ...string) error {
	if a.SecurityClass != "restricted" {
		return nil
	}
	requestID := auditRequestID(r)
	versionID := ""
	if len(versionIDs) > 0 {
		versionID = versionIDs[0]
	}
	_, err := app.db.Exec(ctx, `INSERT INTO file_security_audit_events(actor_user_id,action,result,workspace_id,production_id,parent_type,parent_id,
		attachment_id,file_id,version_id,security_class,permission_basis,request_id,details)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'restricted',$11,$12,'{}'::jsonb)`, actor, action, result, a.Parent.WorkspaceID,
		a.Parent.ProductionID, string(a.Parent.Kind), a.Parent.ID, a.ID, a.FileID, versionID, basis, requestID)
	return err
}

func (app *application) recordSensitiveFileEventBestEffort(ctx context.Context, r *http.Request, actor, action, result, basis string, a attachmentAccess, versionIDs ...string) {
	if err := app.recordSensitiveFileEvent(ctx, r, actor, action, result, basis, a, versionIDs...); err != nil && app.logger != nil {
		app.logger.Warn("record restricted attachment security event", "action", action, "error", err)
	}
}

func (app *application) restrictedAttachmentForAudit(ctx context.Context, attachmentID string) (attachmentAccess, bool) {
	var a attachmentAccess
	var programID, productionID, productionProgramID *string
	err := app.db.QueryRow(ctx, `SELECT a.id,a.file_id,a.security_class,a.workspace_id,p.program_id,pp.production_id,pp.production_program_id
		FROM file_attachments a
		LEFT JOIN program_file_attachments p ON p.attachment_id=a.id
		LEFT JOIN production_program_file_attachments pp ON pp.attachment_id=a.id
		WHERE a.id=$1 AND a.security_class='restricted'`, attachmentID).
		Scan(&a.ID, &a.FileID, &a.SecurityClass, &a.Parent.WorkspaceID, &programID, &productionID, &productionProgramID)
	if err != nil {
		return attachmentAccess{}, false
	}
	if programID != nil && productionProgramID == nil {
		a.Parent.Kind, a.Parent.ID = programFileParent, *programID
	} else if productionProgramID != nil && productionID != nil && programID == nil {
		a.Parent.Kind, a.Parent.ID, a.Parent.ProductionID = productionProgramFileParent, *productionProgramID, *productionID
	}
	return a, true
}

func (app *application) auditDeniedAttachmentAction(r *http.Request, action fileAction, attachmentID string, a attachmentAccess) {
	if a.SecurityClass != "restricted" {
		if known, ok := app.restrictedAttachmentForAudit(r.Context(), attachmentID); ok {
			a = known
		}
	}
	if a.SecurityClass == "restricted" {
		auditAction := string(action)
		if action == fileDownload {
			auditAction = "download_denied"
		}
		app.recordSensitiveFileEventBestEffort(r.Context(), r, claims(r).Subject, auditAction, "denied", "authorization_denied", a, r.URL.Query().Get("version_id"))
	}
}

func auditRequestID(r *http.Request) string {
	if value := r.Header.Get("X-Request-ID"); value != "" && len(value) <= 128 {
		return value
	}
	return uuid.NewString()
}
