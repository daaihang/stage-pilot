package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type campaignShareLink struct {
	ID             string     `json:"id"`
	CampaignID     string     `json:"campaign_id"`
	LongURL        string     `json:"long_url,omitempty"`
	ShortURL       string     `json:"short_url,omitempty"`
	ExpiresAt      *time.Time `json:"expires_at,omitempty"`
	RevokedAt      *time.Time `json:"revoked_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	RotatedAt      *time.Time `json:"rotated_at,omitempty"`
	LastAccessedAt *time.Time `json:"last_accessed_at,omitempty"`
}

func publicCampaignOriginURL(r *http.Request, path string) string { return shareURL(r, path) }

func (app *application) campaignShareAccess(w http.ResponseWriter, r *http.Request, campaignID string) (productionAccess, bool) {
	access, err := app.campaignAccessForID(r.Context(), claims(r).Subject, campaignID, productionShare)
	if err != nil {
		if errors.Is(err, errCampaignPermissionDenied) {
			errorJSON(w, http.StatusForbidden, "forbidden", "没有管理公开链接的权限")
		} else {
			errorJSON(w, http.StatusNotFound, "campaign_not_found", "表单不存在或无权访问")
		}
		return productionAccess{}, false
	}
	return access, true
}

func campaignPublicShareResponse(r *http.Request, id, campaignID, longToken, shortCode string, expiresAt *time.Time, revokedAt *time.Time, createdAt time.Time, rotatedAt, lastAccessedAt *time.Time) campaignShareLink {
	return campaignShareLink{
		ID: id, CampaignID: campaignID,
		LongURL:   publicCampaignOriginURL(r, "/share/campaign/"+longToken),
		ShortURL:  publicCampaignOriginURL(r, "/s/c/"+shortCode),
		ExpiresAt: expiresAt, RevokedAt: revokedAt, CreatedAt: createdAt, RotatedAt: rotatedAt, LastAccessedAt: lastAccessedAt,
	}
}

func (app *application) listCampaignShareLinks(w http.ResponseWriter, r *http.Request) {
	campaignID := r.PathValue("campaignId")
	access, ok := app.campaignShareAccess(w, r, campaignID)
	if !ok {
		return
	}
	rows, err := app.db.Query(r.Context(), `SELECT id,campaign_id,long_token_ciphertext,short_code_ciphertext,expires_at,revoked_at,created_at,rotated_at,last_accessed_at FROM campaign_share_links WHERE workspace_id=$1 AND campaign_id=$2 ORDER BY created_at DESC`, access.WorkspaceID, campaignID)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	items := []campaignShareLink{}
	for rows.Next() {
		var id, cid, longCipher, shortCipher string
		var expires, revoked, rotated, lastAccessed *time.Time
		var created time.Time
		if err := rows.Scan(&id, &cid, &longCipher, &shortCipher, &expires, &revoked, &created, &rotated, &lastAccessed); err != nil {
			serverError(w, err)
			return
		}
		longToken, err1 := decryptInvitationCode(app, longCipher)
		shortCode, err2 := decryptInvitationCode(app, shortCipher)
		if err1 != nil || err2 != nil {
			serverError(w, fmt.Errorf("decrypt campaign share: %v %v", err1, err2))
			return
		}
		items = append(items, campaignPublicShareResponse(r, id, cid, longToken, shortCode, expires, revoked, created, rotated, lastAccessed))
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "next_cursor": nil, "total": len(items)})
}

func campaignPublishedFormHasFiles(form json.RawMessage) bool {
	var definition map[string]any
	if json.Unmarshal(form, &definition) != nil {
		return true
	}
	fields, _ := definition["fields"].([]any)
	for _, raw := range fields {
		if field, ok := raw.(map[string]any); ok && stringValue(field, "type") == "file" {
			return true
		}
	}
	return false
}

func normalizePublicForm(raw json.RawMessage) json.RawMessage {
	var form formDefinition
	if json.Unmarshal(raw, &form) != nil {
		return raw
	}
	form = normalizeFormDefinition(form)
	encoded, err := json.Marshal(form)
	if err != nil {
		return raw
	}
	return encoded
}

func (app *application) createCampaignShareLink(w http.ResponseWriter, r *http.Request) {
	campaignID := r.PathValue("campaignId")
	access, ok := app.campaignShareAccess(w, r, campaignID)
	if !ok {
		return
	}
	var status, visibility string
	var revisionID *string
	var form json.RawMessage
	err := app.db.QueryRow(r.Context(), `SELECT c.status,COALESCE(cr.availability_policy->>'visibility','public'),c.published_revision_id, jsonb_build_object('schema_version',fv.schema_version,'blocks',fv.blocks,'fields',fv.fields,'logic_rules',fv.logic_rules,'presentation',fv.presentation,'end_screen',fv.end_screen)
		FROM campaigns c LEFT JOIN campaign_revisions cr ON cr.workspace_id=c.workspace_id AND cr.id=c.published_revision_id LEFT JOIN form_versions fv ON fv.workspace_id=cr.workspace_id AND fv.id=cr.form_version_id WHERE c.id=$1 AND c.workspace_id=$2 AND c.production_id=$3 AND c.deleted_at IS NULL`, campaignID, access.WorkspaceID, access.ProductionID).Scan(&status, &visibility, &revisionID, &form)
	if err != nil || revisionID == nil {
		errorJSON(w, http.StatusConflict, "campaign_not_published", "表单必须先发布后才能生成公开链接")
		return
	}
	if status == "archived" {
		errorJSON(w, http.StatusConflict, "campaign_archived", "归档表单不能生成公开链接")
		return
	}
	if visibility != "public" {
		errorJSON(w, http.StatusUnprocessableEntity, "public_link_unavailable", "只有公开可见的表单才能生成公开链接")
		return
	}
	if campaignPublishedFormHasFiles(form) {
		errorJSON(w, http.StatusUnprocessableEntity, "file_upload_unavailable", "当前版本包含文件字段，暂不能生成公开链接")
		return
	}
	var expires *time.Time
	var body struct {
		ExpiresAt *time.Time `json:"expires_at"`
	}
	if r.ContentLength > 0 && !decodeJSON(w, r, &body) {
		return
	}
	expires = body.ExpiresAt
	longToken, shortCode := randomShareToken(32), randomShortCode()
	longCipher, err1 := encryptInvitationCode(app, longToken)
	shortCipher, err2 := encryptInvitationCode(app, shortCode)
	if err1 != nil || err2 != nil {
		serverError(w, fmt.Errorf("encrypt campaign share: %v %v", err1, err2))
		return
	}
	now := time.Now().UTC()
	id := newID()
	_, err = app.db.Exec(r.Context(), `INSERT INTO campaign_share_links(id,workspace_id,production_id,campaign_id,long_token_hash,short_code_hash,long_token_ciphertext,short_code_ciphertext,expires_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, id, access.WorkspaceID, access.ProductionID, campaignID, tokenHash(longToken), tokenHash(shortCode), longCipher, shortCipher, expires, claims(r).Subject)
	if err != nil {
		if strings.Contains(err.Error(), "campaign_share_links_one_active") {
			errorJSON(w, http.StatusConflict, "active_share_exists", "该表单已有有效公开链接")
			return
		}
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, campaignPublicShareResponse(r, id, campaignID, longToken, shortCode, expires, nil, now, nil, nil))
}

func (app *application) revokeCampaignShareLink(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("linkId")
	var campaignID, productionID string
	if err := app.db.QueryRow(r.Context(), `SELECT campaign_id,production_id FROM campaign_share_links WHERE id=$1`, id).Scan(&campaignID, &productionID); err != nil {
		errorJSON(w, 404, "share_link_not_found", "公开链接不存在")
		return
	}
	access, ok := app.campaignShareAccess(w, r, campaignID)
	if !ok || access.ProductionID != productionID {
		return
	}
	if tag, err := app.db.Exec(r.Context(), `UPDATE campaign_share_links SET revoked_at=NOW() WHERE id=$1 AND revoked_at IS NULL`, id); err != nil {
		serverError(w, err)
		return
	} else if tag.RowsAffected() == 0 {
		errorJSON(w, 404, "share_link_not_found", "公开链接不存在或已撤销")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "revoked"})
}

func (app *application) rotateCampaignShareLink(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("linkId")
	var campaignID, productionID string
	if err := app.db.QueryRow(r.Context(), `SELECT campaign_id,production_id FROM campaign_share_links WHERE id=$1 AND revoked_at IS NULL`, id).Scan(&campaignID, &productionID); err != nil {
		errorJSON(w, 404, "share_link_not_found", "公开链接不存在")
		return
	}
	access, ok := app.campaignShareAccess(w, r, campaignID)
	if !ok || access.ProductionID != productionID {
		return
	}
	longToken, shortCode := randomShareToken(32), randomShortCode()
	longCipher, err1 := encryptInvitationCode(app, longToken)
	shortCipher, err2 := encryptInvitationCode(app, shortCode)
	if err1 != nil || err2 != nil {
		serverError(w, errors.New("无法生成公开链接"))
		return
	}
	now := time.Now().UTC()
	newIDValue := newID()
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var expires *time.Time
	if err = tx.QueryRow(r.Context(), `UPDATE campaign_share_links SET revoked_at=$1,rotated_at=$1 WHERE id=$2 RETURNING expires_at`, now, id).Scan(&expires); err != nil {
		errorJSON(w, 404, "share_link_not_found", "公开链接不存在或已撤销")
		return
	}
	if _, err = tx.Exec(r.Context(), `INSERT INTO campaign_share_links(id,workspace_id,production_id,campaign_id,long_token_hash,short_code_hash,long_token_ciphertext,short_code_ciphertext,expires_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, newIDValue, access.WorkspaceID, productionID, campaignID, tokenHash(longToken), tokenHash(shortCode), longCipher, shortCipher, expires, claims(r).Subject); err != nil {
		serverError(w, err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, campaignPublicShareResponse(r, newIDValue, campaignID, longToken, shortCode, expires, nil, now, nil, nil))
}

type publicCampaignPayload struct {
	ExpectedRevisionID string         `json:"expected_revision_id"`
	Answers            map[string]any `json:"answers"`
}

func publicSubmissionRequestHash(revisionID string, answers map[string]any) (string, error) {
	requestBytes, err := json.Marshal(struct {
		RevisionID string         `json:"revision_id"`
		Answers    map[string]any `json:"answers"`
	}{RevisionID: revisionID, Answers: answers})
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(requestBytes)
	return hex.EncodeToString(digest[:]), nil
}

func validatePublicAnswers(form json.RawMessage, answers map[string]any) (string, error) {
	runtime, err := newPublicFormRuntime(form)
	if err != nil {
		return "", err
	}
	result, err := runtime.normalizeAnswers(answers, "Asia/Shanghai")
	if err != nil {
		return "", err
	}
	return result.Contact, nil
}
func (app *application) publicCampaign(w http.ResponseWriter, r *http.Request) {
	if !app.allowWindow(r, "campaign-public-read:"+requestClientIP(r), 60, time.Minute) {
		errorJSON(w, 429, "too_many_requests", "公开表单访问过于频繁")
		return
	}
	short := r.PathValue("shortCode") != ""
	pathValue := r.PathValue("token")
	if short {
		pathValue = r.PathValue("shortCode")
	}
	var shareID, workspaceID, campaignID string
	var err error
	if short {
		normalized, e := normalizeInvitationCode(pathValue)
		if e != nil {
			errorJSON(w, 404, "share_unavailable", "公开链接不可用")
			return
		}
		pathValue = normalized
	}
	err = app.db.QueryRow(r.Context(), `SELECT id,workspace_id,campaign_id FROM campaign_share_links WHERE `+map[bool]string{true: "short_code_hash", false: "long_token_hash"}[short]+`=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>NOW())`, tokenHash(pathValue)).Scan(&shareID, &workspaceID, &campaignID)
	if err != nil {
		errorJSON(w, 404, "share_unavailable", "公开链接不可用")
		return
	}
	var name, description, kind, campaignStatus, productionID, productionName, timezone string
	var plannedStart, plannedEnd *time.Time
	var revisionID *string
	var revisionNo *int
	var form json.RawMessage
	var policy, reviewWorkflow json.RawMessage
	var processingMode string
	err = app.db.QueryRow(r.Context(), `SELECT c.name,c.description,c.kind,c.status,c.production_id,p.name,p.timezone,p.planned_start_at,p.planned_end_at,c.published_revision_id,cr.revision_no, jsonb_build_object('schema_version',fv.schema_version,'blocks',fv.blocks,'fields',fv.fields,'logic_rules',fv.logic_rules,'presentation',fv.presentation,'end_screen',fv.end_screen),cr.processing_mode,cr.availability_policy,cr.review_workflow FROM campaigns c JOIN productions p ON p.id=c.production_id AND p.workspace_id=c.workspace_id LEFT JOIN campaign_revisions cr ON cr.workspace_id=c.workspace_id AND cr.id=c.published_revision_id LEFT JOIN form_versions fv ON fv.workspace_id=cr.workspace_id AND fv.id=cr.form_version_id WHERE c.id=$1 AND c.workspace_id=$2 AND c.deleted_at IS NULL`, campaignID, workspaceID).Scan(&name, &description, &kind, &campaignStatus, &productionID, &productionName, &timezone, &plannedStart, &plannedEnd, &revisionID, &revisionNo, &form, &processingMode, &policy, &reviewWorkflow)
	if err != nil || revisionID == nil || campaignStatus == "archived" {
		errorJSON(w, 404, "share_unavailable", "公开表单不可用")
		return
	}
	form = normalizePublicForm(form)
	var policyMap map[string]any
	_ = json.Unmarshal(policy, &policyMap)
	if policyMap == nil {
		policyMap = map[string]any{}
	}
	delete(policyMap, "close_behavior")
	if visibility, _ := policyMap["visibility"].(string); visibility != "" && visibility != "public" {
		errorJSON(w, 404, "share_unavailable", "该表单不是公开表单")
		return
	}
	now := time.Now().UTC()
	accepting := campaignStatus == "published"
	reason := ""
	if !accepting {
		reason = "campaign_not_open"
	}
	if raw, ok := policyMap["opens_at"].(string); ok {
		if t, e := time.Parse(time.RFC3339, raw); e == nil && now.Before(t) {
			accepting = false
			reason = "campaign_not_open"
		}
	}
	if raw, ok := policyMap["closes_at"].(string); ok {
		if t, e := time.Parse(time.RFC3339, raw); e == nil && !now.Before(t) {
			accepting = false
			reason = "campaign_closed"
		}
	}
	if campaignPublishedFormHasFiles(form) {
		accepting = false
		reason = "file_upload_unavailable"
	}
	if accepting {
		if policyLimit(policyMap, "submission_limit") > 0 {
			var count int64
			if err := app.db.QueryRow(r.Context(), `SELECT COUNT(*) FROM entries WHERE workspace_id=$1 AND campaign_id=$2 AND deleted_at IS NULL AND status NOT IN ('draft','withdrawn')`, workspaceID, campaignID).Scan(&count); err != nil {
				serverError(w, err)
				return
			}
			if count >= policyLimit(policyMap, "submission_limit") {
				accepting = false
				reason = "submission_limit_reached"
			}
		}
	}
	if accepting {
		if unavailable := publicSubmissionUnavailableReason(processingMode, policy, form, reviewWorkflow); unavailable != "" {
			accepting = false
			reason = unavailable
		}
	}
	if _, err := app.db.Exec(r.Context(), `UPDATE campaign_share_links SET last_accessed_at=NOW() WHERE id=$1`, shareID); err != nil {
		serverError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	writeJSON(w, 200, map[string]any{"campaign": map[string]any{"name": name, "description": description, "kind": kind, "status": campaignStatus}, "production": map[string]any{"name": productionName, "timezone": timezone, "planned_start_at": plannedStart, "planned_end_at": plannedEnd}, "revision": map[string]any{"id": *revisionID, "revision_no": revisionNo}, "form": form, "availability": policyMap, "accepting": accepting, "accepting_reason": reason})
}

func (app *application) publicCampaignSubmit(w http.ResponseWriter, r *http.Request) {
	if !app.allowWindow(r, "campaign-public-submit:"+requestClientIP(r), 30, time.Minute) {
		errorJSON(w, 429, "too_many_requests", "提交过于频繁")
		return
	}
	short := r.PathValue("shortCode") != ""
	token := r.PathValue("token")
	if short {
		token = r.PathValue("shortCode")
		normalized, e := normalizeInvitationCode(token)
		if e != nil {
			errorJSON(w, 404, "share_unavailable", "公开链接不可用")
			return
		}
		token = normalized
	}
	var in publicCampaignPayload
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.Answers == nil {
		in.Answers = map[string]any{}
	}
	in.ExpectedRevisionID = strings.TrimSpace(in.ExpectedRevisionID)
	if in.ExpectedRevisionID == "" {
		errorJSON(w, http.StatusBadRequest, "expected_revision_required", "提交时必须包含当前表单版本")
		return
	}
	requestHash, err := publicSubmissionRequestHash(in.ExpectedRevisionID, in.Answers)
	if err != nil {
		serverError(w, err)
		return
	}
	idem := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if idem == "" {
		idem = newID()
	}
	if len(idem) > 255 {
		errorJSON(w, 400, "invalid_idempotency_key", "幂等键过长")
		return
	}
	keyDigest := sha256.Sum256([]byte(idem))
	keyHash := hex.EncodeToString(keyDigest[:])
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	_, _ = tx.Exec(r.Context(), `DELETE FROM campaign_public_submission_idempotency WHERE expires_at<=NOW()`)
	column := "long_token_hash"
	if short {
		column = "short_code_hash"
	}
	var shareID, workspaceID, campaignID, productionID, campaignStatus, timezone string
	var revisionID, formVersionID string
	var schemaVersion, revisionNo int
	var form json.RawMessage
	var policy, reviewWorkflow json.RawMessage
	var processingMode string
	if err = tx.QueryRow(r.Context(), `SELECT sl.id,sl.workspace_id,sl.campaign_id,sl.production_id,c.status,p.timezone,c.published_revision_id,cr.revision_no,cr.form_version_id,fv.schema_version,jsonb_build_object('schema_version',fv.schema_version,'blocks',fv.blocks,'fields',fv.fields,'logic_rules',fv.logic_rules,'presentation',fv.presentation,'end_screen',fv.end_screen),cr.processing_mode,cr.availability_policy,cr.review_workflow FROM campaign_share_links sl JOIN campaigns c ON c.workspace_id=sl.workspace_id AND c.id=sl.campaign_id AND c.production_id=sl.production_id JOIN productions p ON p.workspace_id=c.workspace_id AND p.id=c.production_id JOIN campaign_revisions cr ON cr.workspace_id=c.workspace_id AND cr.id=c.published_revision_id JOIN form_versions fv ON fv.workspace_id=cr.workspace_id AND fv.id=cr.form_version_id WHERE sl.`+column+`=$1 AND sl.revoked_at IS NULL AND (sl.expires_at IS NULL OR sl.expires_at>NOW()) AND c.deleted_at IS NULL FOR UPDATE OF sl,c`, tokenHash(token)).Scan(&shareID, &workspaceID, &campaignID, &productionID, &campaignStatus, &timezone, &revisionID, &revisionNo, &formVersionID, &schemaVersion, &form, &processingMode, &policy, &reviewWorkflow); err != nil {
		errorJSON(w, 404, "share_unavailable", "公开链接不可用")
		return
	}
	form = normalizePublicForm(form)
	var existingRequestHash, existingStatus string
	var existingResponse []byte
	var existingResponseStatus *int
	err = tx.QueryRow(r.Context(), `SELECT request_hash,status,response_status,response_body FROM campaign_public_submission_idempotency WHERE workspace_id=$1 AND share_link_id=$2 AND idempotency_key_hash=$3 AND expires_at>NOW() FOR UPDATE`, workspaceID, shareID, keyHash).Scan(&existingRequestHash, &existingStatus, &existingResponseStatus, &existingResponse)
	if err == nil {
		if existingRequestHash != requestHash {
			errorJSON(w, 409, "idempotency_key_reused", "幂等键已用于其他请求")
			return
		}
		if existingStatus == "succeeded" && len(existingResponse) > 0 {
			w.Header().Set("Idempotent-Replayed", "true")
			w.Header().Set("Cache-Control", "no-store")
			writeJSONBytes(w, *existingResponseStatus, existingResponse)
			return
		}
		errorJSON(w, 409, "submission_in_progress", "相同提交正在处理中")
		return
	} else if !errors.Is(err, pgx.ErrNoRows) {
		serverError(w, err)
		return
	}
	if in.ExpectedRevisionID != revisionID {
		errorJSONWithFields(w, http.StatusConflict, "form_version_changed", "表单已发布新版本，请确认后切换版本；原版本草稿仍会保留", map[string]any{
			"current_revision": map[string]any{"id": revisionID, "revision_no": revisionNo},
		})
		return
	}
	var policyMap map[string]any
	_ = json.Unmarshal(policy, &policyMap)
	if visibility, _ := policyMap["visibility"].(string); visibility != "" && visibility != "public" {
		errorJSON(w, 404, "share_unavailable", "该表单不是公开表单")
		return
	}
	now := time.Now().UTC()
	if campaignStatus != "published" {
		errorJSON(w, 409, "campaign_not_open", "表单当前未开放")
		return
	}
	if raw, ok := policyMap["opens_at"].(string); ok {
		if t, e := time.Parse(time.RFC3339, raw); e == nil && now.Before(t) {
			errorJSON(w, 409, "campaign_not_open", "表单尚未开放")
			return
		}
	}
	if raw, ok := policyMap["closes_at"].(string); ok {
		if t, e := time.Parse(time.RFC3339, raw); e == nil && !now.Before(t) {
			errorJSON(w, 409, "campaign_closed", "表单已截止")
			return
		}
	}
	if campaignPublishedFormHasFiles(form) {
		errorJSON(w, 422, "file_upload_unavailable", "当前公开表单暂不支持文件字段")
		return
	}
	if unavailable := publicSubmissionUnavailableReason(processingMode, policy, form, reviewWorkflow); unavailable != "" {
		message := "当前发布版本的公开收件策略暂不可用，请联系管理员修正并重新发布"
		switch unavailable {
		case "auto_accept_unavailable":
			message = "该表单配置了尚未开放的自动确认流程，请联系管理员改用人工决定并重新发布"
		case "contact_email_required_for_actor_limit":
			message = "该表单的每邮箱次数限制缺少必填联系邮箱字段，请联系管理员修正"
		case "close_behavior_unsupported":
			message = "该表单使用了暂不支持的截止后转候补策略，请联系管理员修正并重新发布"
		case "review_workflow_unsupported":
			message = "该表单审核配置暂不支持公开收件，请联系管理员改为单轮人工审核并重新发布"
		case "processing_mode_unavailable":
			message = "该表单处理方式暂不可运行，请联系管理员修正并重新发布"
		}
		errorJSON(w, http.StatusConflict, unavailable, message)
		return
	}
	if limit := policyLimit(policyMap, "submission_limit"); limit > 0 {
		var count int64
		if err = tx.QueryRow(r.Context(), `SELECT COUNT(*) FROM entries WHERE workspace_id=$1 AND campaign_id=$2 AND deleted_at IS NULL AND status NOT IN ('draft','withdrawn')`, workspaceID, campaignID).Scan(&count); err != nil {
			serverError(w, err)
			return
		}
		if count >= limit {
			errorJSON(w, http.StatusConflict, "submission_limit_reached", "表单提交名额已满")
			return
		}
	}
	runtime, runtimeErr := newPublicFormRuntime(form)
	if runtimeErr != nil {
		errorJSON(w, 422, "invalid_form_definition", runtimeErr.Error())
		return
	}
	runtimeResult, validationErr := runtime.normalizeAnswers(in.Answers, timezone)
	if validationErr != nil {
		errorJSON(w, 422, "invalid_answers", validationErr.Error())
		return
	}
	contact := runtimeResult.Contact
	if limit := policyLimit(policyMap, "per_actor_limit"); limit > 0 {
		var count int64
		if err = tx.QueryRow(r.Context(), `SELECT COUNT(*) FROM entries WHERE workspace_id=$1 AND campaign_id=$2 AND contact_email=$3 AND deleted_at IS NULL AND status NOT IN ('draft','withdrawn')`, workspaceID, campaignID, contact).Scan(&count); err != nil {
			serverError(w, err)
			return
		}
		if count >= limit {
			errorJSON(w, http.StatusConflict, "per_actor_limit_reached", "该联系邮箱的提交次数已达上限")
			return
		}
	}
	answerBytes, _ := json.Marshal(runtimeResult.Answers)
	if _, err = tx.Exec(r.Context(), `INSERT INTO campaign_public_submission_idempotency(id,workspace_id,campaign_id,share_link_id,idempotency_key_hash,request_hash,status) VALUES($1,$2,$3,$4,$5,$6,'pending')`, newID(), workspaceID, campaignID, shareID, keyHash, requestHash); err != nil {
		serverError(w, err)
		return
	}
	entryID, entryRevisionID := newID(), newID()
	contract := intakeProcessingContracts[processingMode]
	if _, err = tx.Exec(r.Context(), `INSERT INTO entries(id,workspace_id,production_id,campaign_id,campaign_revision_id,status,contact_email,submitted_at,last_activity_at) VALUES($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())`, entryID, workspaceID, productionID, campaignID, revisionID, contract.EntryStatus, contact); err != nil {
		serverError(w, err)
		return
	}
	if _, err = tx.Exec(r.Context(), `INSERT INTO entry_revisions(id,workspace_id,entry_id,revision_no,schema_version,answers,source) VALUES($1,$2,$3,1,$4,$5,'public')`, entryRevisionID, workspaceID, entryID, schemaVersion, answerBytes); err != nil {
		serverError(w, err)
		return
	}
	if contract.CreatesReviewRun {
		if err = createEntryReviewRun(r.Context(), tx, workspaceID, productionID, revisionID, entryID, entryRevisionID, reviewWorkflow); err != nil {
			serverError(w, err)
			return
		}
	}
	response := map[string]any{"status": "submitted", "submitted_at": now}
	responseBytes, _ := json.Marshal(response)
	if _, err = tx.Exec(r.Context(), `UPDATE campaign_public_submission_idempotency SET status='succeeded',response_status=201,response_body=$1,entry_id=$2,completed_at=NOW() WHERE workspace_id=$3 AND share_link_id=$4 AND idempotency_key_hash=$5`, responseBytes, entryID, workspaceID, shareID, keyHash); err != nil {
		serverError(w, err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	writeJSONBytes(w, 201, responseBytes)
}
