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
	err := app.db.QueryRow(r.Context(), `SELECT c.status,COALESCE(cr.availability_policy->>'visibility','public'),c.published_revision_id, jsonb_build_object('schema_version',fv.schema_version,'blocks',fv.blocks,'fields',fv.fields,'logic_rules',fv.logic_rules,'end_screen',fv.end_screen)
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
	Answers map[string]any `json:"answers"`
}

func jsonScalarEqual(value any, expected any) bool { return fmt.Sprint(value) == fmt.Sprint(expected) }

func publicOptionAllowed(field map[string]any, value any) bool {
	allowed := map[string]bool{}
	if options, ok := field["options"].([]any); ok {
		for _, raw := range options {
			switch option := raw.(type) {
			case string:
				allowed[option] = true
			case map[string]any:
				if optionValue, ok := option["value"].(string); ok {
					allowed[optionValue] = true
				}
			}
		}
	}
	if values, ok := value.([]any); ok {
		for _, item := range values {
			if text, ok := item.(string); !ok || !allowed[text] {
				return false
			}
		}
		return len(values) > 0
	}
	text, ok := value.(string)
	return ok && allowed[text]
}

func publicFieldVisible(field map[string]any, answers map[string]any, rules []map[string]any) bool {
	visible := true
	for _, rule := range rules {
		if stringValue(rule, "effect") != "show" && stringValue(rule, "effect") != "hide" {
			continue
		}
		target := firstReference(rule, "target_field_id", "target_field_key")
		if target != stringValue(field, "id") {
			continue
		}
		conditions, _ := rule["conditions"].(map[string]any)
		items, _ := conditions["items"].([]any)
		matches := []bool{}
		for _, raw := range items {
			item, _ := raw.(map[string]any)
			source := stringValue(item, "field_id")
			current, exists := answers[source]
			op := stringValue(item, "operator")
			expected := item["value"]
			ok := false
			switch op {
			case "empty":
				ok = !exists || current == nil || current == ""
			case "not_empty":
				ok = exists && current != nil && current != ""
			case "equals":
				ok = exists && jsonScalarEqual(current, expected)
			case "not_equals":
				ok = !exists || !jsonScalarEqual(current, expected)
			case "contains":
				ok = exists && strings.Contains(fmt.Sprint(current), fmt.Sprint(expected))
			default:
				ok = false
			}
			matches = append(matches, ok)
		}
		match := stringValue(conditions, "match")
		conditionResult := match != "any"
		if match == "any" {
			conditionResult = false
		}
		for _, itemResult := range matches {
			if match == "any" {
				conditionResult = conditionResult || itemResult
			} else {
				conditionResult = conditionResult && itemResult
			}
		}
		if conditionResult {
			visible = stringValue(rule, "effect") == "show"
		}
	}
	return visible
}

func publicFieldRequired(field map[string]any, answers map[string]any, rules []map[string]any) bool {
	required, _ := field["required"].(bool)
	for _, rule := range rules {
		effect := stringValue(rule, "effect")
		if effect != "required" && effect != "optional" {
			continue
		}
		if firstReference(rule, "target_field_id", "target_field_key") != stringValue(field, "id") {
			continue
		}
		conditions, _ := rule["conditions"].(map[string]any)
		items, _ := conditions["items"].([]any)
		match := stringValue(conditions, "match")
		result := match != "any"
		if match == "any" {
			result = false
		}
		for _, raw := range items {
			item, _ := raw.(map[string]any)
			source := stringValue(item, "field_id")
			current, exists := answers[source]
			expected := item["value"]
			ok := false
			switch stringValue(item, "operator") {
			case "empty":
				ok = !exists || current == nil || current == ""
			case "not_empty":
				ok = exists && current != nil && current != ""
			case "equals":
				ok = exists && jsonScalarEqual(current, expected)
			case "not_equals":
				ok = !exists || !jsonScalarEqual(current, expected)
			case "contains":
				ok = exists && strings.Contains(fmt.Sprint(current), fmt.Sprint(expected))
			}
			if match == "any" {
				result = result || ok
			} else {
				result = result && ok
			}
		}
		if result {
			required = effect == "required"
		}
	}
	return required
}

func validatePublicAnswers(form json.RawMessage, answers map[string]any) (string, error) {
	var definition map[string]any
	if err := json.Unmarshal(form, &definition); err != nil {
		return "", errors.New("表单定义不存在")
	}
	fieldsRaw, _ := definition["fields"].([]any)
	rulesRaw, _ := definition["logic_rules"].([]any)
	rules := make([]map[string]any, 0, len(rulesRaw))
	for _, raw := range rulesRaw {
		if rule, ok := raw.(map[string]any); ok {
			rules = append(rules, rule)
		}
	}
	known := map[string]bool{}
	contact := ""
	for _, raw := range fieldsRaw {
		field, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		id, typ := stringValue(field, "id"), stringValue(field, "type")
		if id == "" {
			continue
		}
		known[id] = true
		if typ == "file" {
			return "", errors.New("当前公开表单暂不支持文件字段")
		}
		value, exists := answers[id]
		visible := publicFieldVisible(field, answers, rules)
		required := publicFieldRequired(field, answers, rules)
		if visible && required && (!exists || value == nil || value == "" || (typ == "multiselect" && lenAny(value) == 0)) {
			return "", fmt.Errorf("字段 %s 为必填项", id)
		}
		if !exists || value == nil {
			continue
		}
		switch typ {
		case "number":
			if _, ok := value.(float64); !ok {
				return "", fmt.Errorf("字段 %s 必须是数字", id)
			}
		case "email":
			text, ok := value.(string)
			if !ok || !validEmail(normalizeEmail(text)) {
				return "", fmt.Errorf("字段 %s 邮箱格式无效", id)
			}
			if contact == "" {
				contact = normalizeEmail(text)
			}
		case "text", "textarea", "phone", "url", "date", "datetime", "hidden":
			if _, ok := value.(string); !ok {
				return "", fmt.Errorf("字段 %s 格式无效", id)
			}
		case "select", "radio":
			if !publicOptionAllowed(field, value) {
				return "", fmt.Errorf("字段 %s 选项无效", id)
			}
		case "checkbox":
			if _, ok := value.(bool); !ok {
				return "", fmt.Errorf("字段 %s 必须是布尔值", id)
			}
		case "multiselect":
			if !publicOptionAllowed(field, value) {
				return "", fmt.Errorf("字段 %s 选项无效", id)
			}
		}
		if stringValue(field, "semantic_key") == "CONTACT_EMAIL" && contact == "" {
			if text, ok := value.(string); ok && validEmail(normalizeEmail(text)) {
				contact = normalizeEmail(text)
			}
		}
	}
	for id := range answers {
		if !known[id] {
			return "", fmt.Errorf("未知字段 %s", id)
		}
	}
	return contact, nil
}

func lenAny(value any) int {
	if values, ok := value.([]any); ok {
		return len(values)
	}
	return 0
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
	var policy json.RawMessage
	err = app.db.QueryRow(r.Context(), `SELECT c.name,c.description,c.kind,c.status,c.production_id,p.name,p.timezone,p.planned_start_at,p.planned_end_at,c.published_revision_id,cr.revision_no, jsonb_build_object('schema_version',fv.schema_version,'blocks',fv.blocks,'fields',fv.fields,'logic_rules',fv.logic_rules,'end_screen',fv.end_screen),cr.availability_policy FROM campaigns c JOIN productions p ON p.id=c.production_id AND p.workspace_id=c.workspace_id LEFT JOIN campaign_revisions cr ON cr.workspace_id=c.workspace_id AND cr.id=c.published_revision_id LEFT JOIN form_versions fv ON fv.workspace_id=cr.workspace_id AND fv.id=cr.form_version_id WHERE c.id=$1 AND c.workspace_id=$2 AND c.deleted_at IS NULL`, campaignID, workspaceID).Scan(&name, &description, &kind, &campaignStatus, &productionID, &productionName, &timezone, &plannedStart, &plannedEnd, &revisionID, &revisionNo, &form, &policy)
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
	if visibility, _ := policyMap["visibility"].(string); visibility != "" && visibility != "public" {
		errorJSON(w, 404, "share_unavailable", "该表单不是公开表单")
		return
	}
	if campaignPublishedFormHasFiles(form) {
		policyMap["public_submission_unavailable"] = "file_upload_unavailable"
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
	if _, blocked := policyMap["public_submission_unavailable"]; blocked {
		accepting = false
		reason = "file_upload_unavailable"
	}
	_ = app.db.QueryRow(r.Context(), `UPDATE campaign_share_links SET last_accessed_at=NOW() WHERE id=$1`, shareID)
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
	answerBytes, _ := json.Marshal(in.Answers)
	answerDigest := sha256.Sum256(answerBytes)
	requestHash := hex.EncodeToString(answerDigest[:])
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
	var shareID, workspaceID, campaignID, productionID, campaignStatus string
	var revisionID, formVersionID string
	var schemaVersion int
	var form json.RawMessage
	var policy json.RawMessage
	if err = tx.QueryRow(r.Context(), `SELECT sl.id,sl.workspace_id,sl.campaign_id,sl.production_id,c.status,c.published_revision_id,cr.form_version_id,fv.schema_version,jsonb_build_object('schema_version',fv.schema_version,'blocks',fv.blocks,'fields',fv.fields,'logic_rules',fv.logic_rules,'end_screen',fv.end_screen),cr.availability_policy FROM campaign_share_links sl JOIN campaigns c ON c.workspace_id=sl.workspace_id AND c.id=sl.campaign_id AND c.production_id=sl.production_id JOIN campaign_revisions cr ON cr.workspace_id=c.workspace_id AND cr.id=c.published_revision_id JOIN form_versions fv ON fv.workspace_id=cr.workspace_id AND fv.id=cr.form_version_id WHERE sl.`+column+`=$1 AND sl.revoked_at IS NULL AND (sl.expires_at IS NULL OR sl.expires_at>NOW()) AND c.deleted_at IS NULL FOR UPDATE`, tokenHash(token)).Scan(&shareID, &workspaceID, &campaignID, &productionID, &campaignStatus, &revisionID, &formVersionID, &schemaVersion, &form, &policy); err != nil {
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
	contact, validationErr := validatePublicAnswers(form, in.Answers)
	if validationErr != nil {
		errorJSON(w, 422, "invalid_answers", validationErr.Error())
		return
	}
	if raw, ok := policyMap["submission_limit"].(float64); ok && raw > 0 {
		var count int
		if err = tx.QueryRow(r.Context(), `SELECT COUNT(*) FROM entries WHERE workspace_id=$1 AND campaign_id=$2 AND deleted_at IS NULL AND status<>'withdrawn'`, workspaceID, campaignID).Scan(&count); err != nil {
			serverError(w, err)
			return
		}
		if float64(count) >= raw {
			errorJSON(w, 409, "submission_limit_reached", "表单提交名额已满")
			return
		}
	}
	if _, err = tx.Exec(r.Context(), `INSERT INTO campaign_public_submission_idempotency(id,workspace_id,campaign_id,share_link_id,idempotency_key_hash,request_hash,status) VALUES($1,$2,$3,$4,$5,$6,'pending')`, newID(), workspaceID, campaignID, shareID, keyHash, requestHash); err != nil {
		serverError(w, err)
		return
	}
	entryID, entryRevisionID := newID(), newID()
	if _, err = tx.Exec(r.Context(), `INSERT INTO entries(id,workspace_id,production_id,campaign_id,campaign_revision_id,status,contact_email,submitted_at,last_activity_at) VALUES($1,$2,$3,$4,$5,'submitted',$6,NOW(),NOW())`, entryID, workspaceID, productionID, campaignID, revisionID, contact); err != nil {
		serverError(w, err)
		return
	}
	if _, err = tx.Exec(r.Context(), `INSERT INTO entry_revisions(id,workspace_id,entry_id,revision_no,schema_version,answers,source) VALUES($1,$2,$3,1,$4,$5,'public')`, entryRevisionID, workspaceID, entryID, schemaVersion, answerBytes); err != nil {
		serverError(w, err)
		return
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
