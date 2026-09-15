package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

type campaignTemplateVersionItem struct {
	ID                    string          `json:"id"`
	TemplateID            string          `json:"template_id"`
	WorkspaceID           *string         `json:"workspace_id"`
	Version               int             `json:"version"`
	Status                string          `json:"status"`
	Definition            json.RawMessage `json:"definition"`
	ReviewRecipeVersionID *string         `json:"review_recipe_version_id,omitempty"`
	CreatedBy             *string         `json:"created_by,omitempty"`
	CreatedAt             time.Time       `json:"created_at"`
	PublishedAt           *time.Time      `json:"published_at,omitempty"`
	ETag                  string          `json:"etag"`
}

type templateManagementQueryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func templateVersionETag(item campaignTemplateVersionItem) string {
	var value any
	_ = json.Unmarshal(item.Definition, &value)
	payload := map[string]any{"id": item.ID, "template_id": item.TemplateID, "workspace_id": item.WorkspaceID, "version": item.Version, "status": item.Status, "definition": value, "review_recipe_version_id": item.ReviewRecipeVersionID}
	encoded, _ := json.Marshal(payload)
	digest := sha256.Sum256(encoded)
	return `"` + hex.EncodeToString(digest[:]) + `"`
}

func templateItemETag(item campaignTemplateItem) string {
	payload := map[string]any{"id": item.ID, "workspace_id": item.WorkspaceID, "name": item.Name, "description": item.Description, "status": item.Status, "latest_version": item.LatestVersion, "published_version": item.PublishedVersion}
	encoded, _ := json.Marshal(payload)
	digest := sha256.Sum256(encoded)
	return `"` + hex.EncodeToString(digest[:]) + `"`
}

func loadCampaignTemplateItem(ctx context.Context, q templateManagementQueryer, id string) (campaignTemplateItem, error) {
	var item campaignTemplateItem
	var metadata []byte
	err := q.QueryRow(ctx, `SELECT t.id,t.scope,t.workspace_id,t.kind,t.name,t.description,t.status,t.latest_version,t.published_version,
		draft.id,published.id,t.source_template_id,t.source_campaign_id,t.source_campaign_revision_id,t.created_at,t.updated_at,
		COALESCE(published.definition->'metadata',draft.definition->'metadata','{}'::jsonb)
		FROM campaign_templates t
		LEFT JOIN campaign_template_versions draft ON draft.template_id=t.id AND draft.published_at IS NULL
		LEFT JOIN campaign_template_versions published ON published.template_id=t.id AND published.version=t.published_version
		WHERE t.id=$1`, id).Scan(&item.ID, &item.Scope, &item.WorkspaceID, &item.Kind, &item.Name, &item.Description, &item.Status, &item.LatestVersion, &item.PublishedVersion,
		&item.DraftVersionID, &item.PublishedVersionID, &item.SourceTemplate, &item.SourceCampaign, &item.SourceCampaignRevision, &item.CreatedAt, &item.UpdatedAt, &metadata)
	if err != nil {
		return item, err
	}
	item.Metadata = map[string]any{}
	_ = json.Unmarshal(metadata, &item.Metadata)
	return item, nil
}

func loadCampaignTemplateVersion(ctx context.Context, q templateManagementQueryer, templateID, versionID string) (campaignTemplateVersionItem, error) {
	var item campaignTemplateVersionItem
	err := q.QueryRow(ctx, `SELECT v.id,v.template_id,v.workspace_id,v.version,
		CASE WHEN v.published_at IS NULL THEN 'draft' WHEN t.published_version=v.version THEN 'published' ELSE 'superseded' END,
		v.definition,v.review_recipe_version_id,v.created_by,v.created_at,v.published_at
		FROM campaign_template_versions v JOIN campaign_templates t ON t.id=v.template_id
		WHERE v.id=$1 AND v.template_id=$2`, versionID, templateID).Scan(&item.ID, &item.TemplateID, &item.WorkspaceID, &item.Version, &item.Status, &item.Definition, &item.ReviewRecipeVersionID, &item.CreatedBy, &item.CreatedAt, &item.PublishedAt)
	if err == nil {
		item.ETag = templateVersionETag(item)
	}
	return item, err
}

func normalizeTemplateDefinition(raw json.RawMessage) (templateDefinition, json.RawMessage, error) {
	var definition templateDefinition
	if len(raw) > 0 && string(raw) != "null" {
		if err := json.Unmarshal(raw, &definition); err != nil {
			return definition, nil, errors.New("invalid template definition")
		}
	}
	definition = normalizeDefinition(definition)
	if err := validateFormDefinitionDraftValue(definition.Form); err != nil {
		return definition, nil, err
	}
	encoded, err := json.Marshal(definition)
	return definition, encoded, err
}

func templateVersionResponse(ctx context.Context, q templateManagementQueryer, templateID, versionID string) (map[string]any, error) {
	template, err := loadCampaignTemplateItem(ctx, q, templateID)
	if err != nil {
		return nil, err
	}
	version, err := loadCampaignTemplateVersion(ctx, q, templateID, versionID)
	if err != nil {
		return nil, err
	}
	return map[string]any{"template": template, "version": version}, nil
}

func (app *application) campaignTemplateAccess(ctx context.Context, userID, templateID string, requireAdmin bool) (string, string, error) {
	var scope, workspaceID string
	if err := app.db.QueryRow(ctx, `SELECT scope,COALESCE(workspace_id,'') FROM campaign_templates WHERE id=$1`, templateID).Scan(&scope, &workspaceID); err != nil {
		return scope, workspaceID, err
	}
	if scope == "system" {
		if requireAdmin {
			return scope, workspaceID, errCampaignPermissionDenied
		}
		return scope, workspaceID, nil
	}
	var role string
	if err := app.db.QueryRow(ctx, `SELECT role FROM workspace_memberships WHERE workspace_id=$1 AND user_id=$2 AND status='active'`, workspaceID, userID).Scan(&role); err != nil {
		return scope, workspaceID, errCampaignPermissionDenied
	}
	if requireAdmin && roleRank[role] < roleRank[workspaceRoleAdmin] {
		return scope, workspaceID, errCampaignPermissionDenied
	}
	return scope, workspaceID, nil
}

func validateTemplateDefinition(definition templateDefinition, kind string) error {
	if err := validateFormDefinitionValue(definition.Form); err != nil {
		return err
	}
	if err := validateAvailabilityPolicyValue(definition.AvailabilityPolicy); err != nil {
		return err
	}
	if _, _, err := parseReviewRecipeDefinition(definition.ReviewWorkflow, true); err != nil {
		return err
	}
	return validateMaterializationPlanValue(definition.MaterializationPlan, kind)
}

func reusableReviewWorkflow(raw json.RawMessage) (json.RawMessage, error) {
	var value map[string]any
	if len(raw) == 0 || string(raw) == "null" || string(raw) == "{}" {
		raw = defaultAutoAcceptReviewRecipe()
	}
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, reviewRecipeError("invalid_review_recipe", "审核方案格式无效")
	}
	if rounds, ok := value["rounds"].([]any); ok {
		for _, rawRound := range rounds {
			round, ok := rawRound.(map[string]any)
			if !ok {
				continue
			}
			policy, _ := round["reviewer_policy"].(map[string]any)
			if policy == nil {
				continue
			}
			members, _ := policy["member_ids"].([]any)
			if len(members) > 0 {
				return nil, reviewRecipeError("recipe_members_not_reusable", "工作空间审核方案不能保存活动成员，请在 Campaign 中选择成员")
			}
			policy["source"] = "production_roles"
			policy["member_ids"] = []any{}
			if _, ok := policy["role_keys"]; !ok {
				policy["role_keys"] = []any{}
			}
		}
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	_, normalized, err := parseReviewRecipeDefinition(encoded, true)
	return normalized, err
}

// portableReviewWorkflow strips activity-specific reviewer member IDs when a
// Campaign snapshot is promoted to a reusable Workspace template. Role
// configuration is retained; an empty role list is a valid draft that must be
// completed before a reusable ReviewRecipe is published.
func portableReviewWorkflow(raw json.RawMessage) (json.RawMessage, error) {
	var value map[string]any
	if len(raw) == 0 || string(raw) == "null" || string(raw) == "{}" {
		raw = defaultAutoAcceptReviewRecipe()
	}
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, reviewRecipeError("invalid_review_recipe", "审核方案格式无效")
	}
	if rounds, ok := value["rounds"].([]any); ok {
		for _, rawRound := range rounds {
			round, ok := rawRound.(map[string]any)
			if !ok {
				continue
			}
			policy, _ := round["reviewer_policy"].(map[string]any)
			if policy == nil {
				continue
			}
			policy["source"] = "production_roles"
			policy["member_ids"] = []any{}
			if _, ok := policy["role_keys"]; !ok {
				policy["role_keys"] = []any{}
			}
		}
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	_, normalized, err := parseReviewRecipeDefinition(encoded, true)
	return normalized, err
}

// portableTemplateDefinition removes values that belong to one running
// activity while preserving reusable capacity, waitlist and result rules.
// A workspace template should be a starting point for a future campaign, not
// a second copy of the source campaign's calendar window.
func portableTemplateDefinition(def templateDefinition) templateDefinition {
	var policy map[string]any
	if json.Unmarshal(def.AvailabilityPolicy, &policy) == nil {
		delete(policy, "opens_at")
		delete(policy, "closes_at")
		if encoded, err := json.Marshal(policy); err == nil {
			def.AvailabilityPolicy = encoded
		}
	}
	return def
}

func templateDefinitionFromRevision(ctx context.Context, q templateManagementQueryer, revisionID, workspaceID string) (templateDefinition, string, string, error) {
	var def templateDefinition
	var kind, campaignID string
	var form formDefinition
	err := q.QueryRow(ctx, `SELECT c.kind,c.id,fv.schema_version,fv.blocks,fv.fields,fv.logic_rules,fv.presentation,fv.end_screen,
		cr.availability_policy,cr.review_workflow,cr.materialization_plan
		FROM campaign_revisions cr JOIN campaigns c ON c.workspace_id=cr.workspace_id AND c.id=cr.campaign_id
		JOIN form_versions fv ON fv.workspace_id=cr.workspace_id AND fv.id=cr.form_version_id
		WHERE cr.id=$1 AND cr.workspace_id=$2`, revisionID, workspaceID).Scan(&kind, &campaignID, &form.SchemaVersion, &form.Blocks, &form.Fields, &form.LogicRules, &form.Presentation, &form.EndScreen, &def.AvailabilityPolicy, &def.ReviewWorkflow, &def.MaterializationPlan)
	if err != nil {
		return def, "", "", err
	}
	def.Form = normalizeFormDefinition(form)
	return normalizeDefinition(def), kind, campaignID, nil
}

func (app *application) listCampaignTemplateVersions(w http.ResponseWriter, r *http.Request) {
	templateID := r.PathValue("templateId")
	scope, _, err := app.campaignTemplateAccess(r.Context(), claims(r).Subject, templateID, false)
	if err != nil {
		errorJSON(w, http.StatusNotFound, "campaign_template_not_found", "模板不存在或无权访问")
		return
	}
	query := `SELECT v.id,v.template_id,v.workspace_id,v.version,
		CASE WHEN v.published_at IS NULL THEN 'draft' WHEN t.published_version=v.version THEN 'published' ELSE 'superseded' END,
		v.definition,v.review_recipe_version_id,v.created_by,v.created_at,v.published_at
		FROM campaign_template_versions v JOIN campaign_templates t ON t.id=v.template_id
		WHERE v.template_id=$1`
	if scope == "workspace" {
		if _, _, adminErr := app.campaignTemplateAccess(r.Context(), claims(r).Subject, templateID, true); adminErr != nil {
			query += ` AND v.published_at IS NOT NULL`
		}
	}
	query += ` ORDER BY v.version DESC`
	rows, err := app.db.Query(r.Context(), query, templateID)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	items := make([]campaignTemplateVersionItem, 0)
	for rows.Next() {
		var item campaignTemplateVersionItem
		if err := rows.Scan(&item.ID, &item.TemplateID, &item.WorkspaceID, &item.Version, &item.Status, &item.Definition, &item.ReviewRecipeVersionID, &item.CreatedBy, &item.CreatedAt, &item.PublishedAt); err != nil {
			serverError(w, err)
			return
		}
		item.ETag = templateVersionETag(item)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "next_cursor": nil, "total": len(items)})
}

func (app *application) getCampaignTemplate(w http.ResponseWriter, r *http.Request) {
	templateID := r.PathValue("templateId")
	scope, _, err := app.campaignTemplateAccess(r.Context(), claims(r).Subject, templateID, false)
	if err != nil {
		errorJSON(w, http.StatusNotFound, "campaign_template_not_found", "模板不存在或无权访问")
		return
	}
	template, err := loadCampaignTemplateItem(r.Context(), app.db, templateID)
	if err != nil {
		errorJSON(w, http.StatusNotFound, "campaign_template_not_found", "模板不存在或无权访问")
		return
	}
	if scope == "workspace" {
		if _, _, adminErr := app.campaignTemplateAccess(r.Context(), claims(r).Subject, templateID, true); adminErr != nil {
			if template.Status != "published" {
				errorJSON(w, http.StatusNotFound, "campaign_template_not_found", "模板不存在或无权访问")
				return
			}
			template.DraftVersionID = nil
		}
	}
	w.Header().Set("ETag", templateItemETag(template))
	writeJSON(w, http.StatusOK, map[string]any{"template": template, "etag": templateItemETag(template)})
}

func (app *application) createWorkspaceCampaignTemplate(w http.ResponseWriter, r *http.Request) {
	access := currentWorkspaceAccess(r)
	var in struct {
		Name                     string          `json:"name"`
		Description              string          `json:"description"`
		Kind                     string          `json:"kind"`
		SourceTemplateVersionID  string          `json:"source_template_version_id"`
		SourceCampaignRevisionID string          `json:"source_campaign_revision_id"`
		Definition               json.RawMessage `json:"definition"`
	}
	raw, ok := decodeCampaignBody(w, r, &in)
	if !ok {
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if utf8.RuneCountInString(in.Name) < 1 || utf8.RuneCountInString(in.Name) > 120 || utf8.RuneCountInString(in.Description) > 500 {
		errorJSON(w, http.StatusUnprocessableEntity, "invalid_template_input", "模板名称或描述无效")
		return
	}
	if in.SourceTemplateVersionID != "" && in.SourceCampaignRevisionID != "" {
		errorJSON(w, http.StatusUnprocessableEntity, "invalid_template_source", "模板来源只能选择一种")
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if len(key) > 255 {
		errorJSON(w, 400, "invalid_idempotency_key", "幂等键不能超过 255 个字符")
		return
	}
	outcome, err := app.beginIdempotency(r.Context(), tx, access.WorkspaceID, access.UserID, http.MethodPost, r.URL.Path, key, raw)
	if err != nil {
		serverError(w, err)
		return
	}
	if outcome.conflict {
		errorJSON(w, 409, "idempotency_key_reused", "幂等键已用于不同请求")
		return
	}
	if outcome.pending {
		errorJSON(w, 409, "idempotency_in_progress", "相同请求正在处理中")
		return
	}
	if outcome.replay {
		_ = tx.Rollback(r.Context())
		w.Header().Set("Idempotent-Replayed", "true")
		writeJSONBytes(w, outcome.status, outcome.body)
		return
	}
	def := templateDefinition{}
	var kind string
	var sourceTemplateID, sourceCampaignID, sourceRevisionID *string
	var sourceRecipeVersionID *string
	var copyingCampaignRevision bool
	switch {
	case in.SourceTemplateVersionID != "":
		var templateID, sourceKind string
		var version int
		var recipeVersionID *string
		var definitionJSON []byte
		if err := tx.QueryRow(r.Context(), `SELECT v.template_id,v.version,t.kind,v.definition,v.review_recipe_version_id FROM campaign_template_versions v JOIN campaign_templates t ON t.id=v.template_id WHERE v.id=$1 AND v.published_at IS NOT NULL AND t.archived_at IS NULL AND (t.scope='system' OR t.workspace_id=$2)`, in.SourceTemplateVersionID, access.WorkspaceID).Scan(&templateID, &version, &sourceKind, &definitionJSON, &recipeVersionID); err != nil {
			errorJSON(w, 404, "campaign_template_version_not_found", "模板版本不存在或无权访问")
			return
		}
		if err := json.Unmarshal(definitionJSON, &def); err != nil {
			serverError(w, err)
			return
		}
		kind = sourceKind
		sourceTemplateID = &templateID
		sourceRecipeVersionID = recipeVersionID
	case in.SourceCampaignRevisionID != "":
		copyingCampaignRevision = true
		var campaignID string
		var err error
		def, kind, campaignID, err = templateDefinitionFromRevision(r.Context(), tx, in.SourceCampaignRevisionID, access.WorkspaceID)
		if err != nil {
			errorJSON(w, 404, "campaign_revision_not_found", "活动版本不存在或无权访问")
			return
		}
		sourceCampaignID, sourceRevisionID = &campaignID, &in.SourceCampaignRevisionID
		_ = tx.QueryRow(r.Context(), `SELECT review_recipe_version_id FROM campaign_revisions WHERE id=$1 AND workspace_id=$2`, in.SourceCampaignRevisionID, access.WorkspaceID).Scan(&sourceRecipeVersionID)
	default:
		kind = strings.TrimSpace(in.Kind)
		if !campaignKinds[kind] {
			errorJSON(w, 422, "invalid_campaign_kind", "表单类型无效")
			return
		}
		if len(in.Definition) > 0 && string(in.Definition) != "null" {
			if err := json.Unmarshal(in.Definition, &def); err != nil {
				errorJSON(w, 422, "invalid_template_definition", "模板定义格式无效")
				return
			}
		}
	}
	if in.Kind != "" && in.Kind != kind {
		errorJSON(w, 422, "campaign_kind_mismatch", "模板类型与来源不一致")
		return
	}
	def = normalizeDefinition(def)
	if copyingCampaignRevision {
		def = portableTemplateDefinition(def)
	}
	// Template reviewers are portable roles, not Production member IDs. A
	// Campaign copy additionally strips its concrete activity members.
	var normalizedReview json.RawMessage
	if copyingCampaignRevision {
		normalizedReview, err = portableReviewWorkflow(def.ReviewWorkflow)
	} else {
		normalizedReview, err = reusableReviewWorkflow(def.ReviewWorkflow)
	}
	if err != nil {
		writeReviewRecipeValidationError(w, err)
		return
	} else {
		def.ReviewWorkflow = normalizedReview
	}
	if err := validateFormDefinitionDraftValue(def.Form); err != nil {
		if !writeFormValidationError(w, err) {
			serverError(w, err)
		}
		return
	}
	templateID, versionID := newID(), newID()
	if _, err := tx.Exec(r.Context(), `INSERT INTO campaign_templates(id,workspace_id,scope,kind,name,description,status,latest_version,source_template_id,source_campaign_id,source_campaign_revision_id,created_by) VALUES($1,$2,'workspace',$3,$4,$5,'draft',1,$6,$7,$8,$9)`, templateID, access.WorkspaceID, kind, in.Name, strings.TrimSpace(in.Description), sourceTemplateID, sourceCampaignID, sourceRevisionID, access.UserID); err != nil {
		serverError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `INSERT INTO campaign_template_versions(id,template_id,workspace_id,version,definition,created_by,review_recipe_version_id) VALUES($1,$2,$3,1,$4,$5,$6)`, versionID, templateID, access.WorkspaceID, mustJSON(def), access.UserID, sourceRecipeVersionID); err != nil {
		serverError(w, err)
		return
	}
	template, err := loadCampaignTemplateItem(r.Context(), tx, templateID)
	if err != nil {
		serverError(w, err)
		return
	}
	version, err := loadCampaignTemplateVersion(r.Context(), tx, templateID, versionID)
	if err != nil {
		serverError(w, err)
		return
	}
	response, _ := json.Marshal(map[string]any{"template": template, "draft_version": version})
	if err := completeIdempotency(r.Context(), tx, access.WorkspaceID, access.UserID, http.MethodPost, r.URL.Path, key, http.StatusCreated, response); err != nil {
		serverError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	writeJSONBytes(w, http.StatusCreated, response)
}

func mustJSON(v any) []byte { b, _ := json.Marshal(v); return b }

func (app *application) updateCampaignTemplate(w http.ResponseWriter, r *http.Request) {
	templateID := r.PathValue("templateId")
	_, workspaceID, err := app.campaignTemplateAccess(r.Context(), claims(r).Subject, templateID, true)
	if err != nil {
		if errors.Is(err, errCampaignPermissionDenied) {
			errorJSON(w, 403, "forbidden", "没有管理模板的权限")
		} else {
			errorJSON(w, 404, "campaign_template_not_found", "模板不存在或无权访问")
		}
		return
	}
	var in struct {
		Name        *string `json:"name"`
		Description *string `json:"description"`
		Status      *string `json:"status"`
	}
	if _, ok := decodeCampaignBody(w, r, &in); !ok {
		return
	}
	current, err := loadCampaignTemplateItem(r.Context(), app.db, templateID)
	if err != nil {
		errorJSON(w, 404, "campaign_template_not_found", "模板不存在或无权访问")
		return
	}
	if !requireResourceETag(w, r, templateItemETag(current), "模板已被其他人修改，请重新加载") {
		return
	}
	if in.Name == nil && in.Description == nil && in.Status == nil {
		writeJSON(w, 200, map[string]any{"template": current, "etag": templateItemETag(current)})
		return
	}
	name, description, status := current.Name, current.Description, current.Status
	if in.Name != nil {
		name = strings.TrimSpace(*in.Name)
		if utf8.RuneCountInString(name) < 1 || utf8.RuneCountInString(name) > 120 {
			errorJSON(w, 422, "invalid_template_name", "模板名称无效")
			return
		}
	}
	if in.Description != nil {
		description = strings.TrimSpace(*in.Description)
		if utf8.RuneCountInString(description) > 500 {
			errorJSON(w, 422, "invalid_template_description", "模板描述无效")
			return
		}
	}
	if in.Status != nil && *in.Status != "draft" && *in.Status != "published" && *in.Status != "archived" {
		errorJSON(w, 422, "invalid_template_status", "模板状态无效")
		return
	}
	if in.Status != nil && *in.Status != status && *in.Status != "archived" {
		errorJSON(w, http.StatusConflict, "status_transition_not_allowed", "模板状态只能通过版本发布或归档操作改变")
		return
	}
	if status == "archived" && in.Status != nil && *in.Status != "archived" {
		errorJSON(w, 409, "template_archived", "归档模板不能恢复")
		return
	}
	if current.Status == "archived" && (in.Name != nil || in.Description != nil) {
		errorJSON(w, http.StatusConflict, "template_archived", "归档模板不能编辑")
		return
	}
	if in.Status != nil {
		status = *in.Status
	}
	var archived any
	if status == "archived" {
		archived = time.Now()
	} else {
		archived = nil
	}
	if _, err := app.db.Exec(r.Context(), `UPDATE campaign_templates SET name=$1,description=$2,status=$3,archived_at=$4,updated_at=NOW() WHERE id=$5 AND workspace_id=$6`, name, description, status, archived, templateID, workspaceID); err != nil {
		serverError(w, err)
		return
	}
	updated, _ := loadCampaignTemplateItem(r.Context(), app.db, templateID)
	w.Header().Set("ETag", templateItemETag(updated))
	writeJSON(w, 200, map[string]any{"template": updated, "etag": templateItemETag(updated)})
}

func requireResourceETag(w http.ResponseWriter, r *http.Request, current, message string) bool {
	w.Header().Set("ETag", current)
	provided := strings.TrimSpace(r.Header.Get("If-Match"))
	if provided == "" {
		errorJSONWithFields(w, 428, "precondition_required", "缺少 If-Match 版本标记", map[string]any{"current_etag": current})
		return false
	}
	if provided != current {
		errorJSONWithFields(w, 412, "resource_conflict", message, map[string]any{"current_etag": current})
		return false
	}
	return true
}

func (app *application) createCampaignTemplateVersion(w http.ResponseWriter, r *http.Request) {
	templateID := r.PathValue("templateId")
	_, workspaceID, err := app.campaignTemplateAccess(r.Context(), claims(r).Subject, templateID, true)
	if err != nil {
		errorJSON(w, 404, "campaign_template_not_found", "模板不存在或无权访问")
		return
	}
	var in struct {
		Definition            json.RawMessage `json:"definition"`
		ReviewRecipeVersionID *string         `json:"review_recipe_version_id"`
	}
	raw, ok := decodeCampaignBody(w, r, &in)
	if !ok {
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if len(key) > 255 {
		errorJSON(w, http.StatusBadRequest, "invalid_idempotency_key", "幂等键不能超过 255 个字符")
		return
	}
	outcome, err := app.beginIdempotency(r.Context(), tx, workspaceID, claims(r).Subject, http.MethodPost, r.URL.Path, key, raw)
	if err != nil {
		serverError(w, err)
		return
	}
	if outcome.conflict {
		errorJSON(w, http.StatusConflict, "idempotency_key_reused", "幂等键已用于不同请求")
		return
	}
	if outcome.pending {
		errorJSON(w, http.StatusConflict, "idempotency_in_progress", "相同请求正在处理中")
		return
	}
	if outcome.replay {
		_ = tx.Rollback(r.Context())
		w.Header().Set("Idempotent-Replayed", "true")
		writeJSONBytes(w, outcome.status, outcome.body)
		return
	}
	var latest int
	var publishedVersion *int
	var kind, status string
	if err := tx.QueryRow(r.Context(), `SELECT latest_version,published_version,kind,status FROM campaign_templates WHERE id=$1 AND workspace_id=$2 FOR UPDATE`, templateID, workspaceID).Scan(&latest, &publishedVersion, &kind, &status); err != nil {
		errorJSON(w, 404, "campaign_template_not_found", "模板不存在或无权访问")
		return
	}
	if status == "archived" {
		errorJSON(w, 409, "template_archived", "归档模板不能创建版本")
		return
	}
	var exists bool
	_ = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM campaign_template_versions WHERE template_id=$1 AND published_at IS NULL)`, templateID).Scan(&exists)
	if exists {
		errorJSON(w, 409, "draft_version_exists", "模板已有草稿版本")
		return
	}
	var def templateDefinition
	var recipeID *string
	if in.ReviewRecipeVersionID != nil {
		if strings.TrimSpace(*in.ReviewRecipeVersionID) != "" {
			recipeID = in.ReviewRecipeVersionID
		}
	}
	if in.ReviewRecipeVersionID == nil && publishedVersion != nil {
		if err := tx.QueryRow(r.Context(), `SELECT review_recipe_version_id FROM campaign_template_versions WHERE template_id=$1 AND version=$2`, templateID, *publishedVersion).Scan(&recipeID); err != nil {
			serverError(w, err)
			return
		}
	}
	if len(in.Definition) > 0 && string(in.Definition) != "null" {
		if err := json.Unmarshal(in.Definition, &def); err != nil {
			errorJSON(w, 422, "invalid_template_definition", "模板定义格式无效")
			return
		}
	} else if publishedVersion != nil {
		var encoded []byte
		var err error
		if in.ReviewRecipeVersionID == nil {
			err = tx.QueryRow(r.Context(), `SELECT definition,review_recipe_version_id FROM campaign_template_versions WHERE template_id=$1 AND version=$2`, templateID, *publishedVersion).Scan(&encoded, &recipeID)
		} else {
			err = tx.QueryRow(r.Context(), `SELECT definition FROM campaign_template_versions WHERE template_id=$1 AND version=$2`, templateID, *publishedVersion).Scan(&encoded)
		}
		if err != nil {
			serverError(w, err)
			return
		}
		if err := json.Unmarshal(encoded, &def); err != nil {
			serverError(w, err)
			return
		}
	} else {
		def = templateDefinition{}
	}
	def = normalizeDefinition(def)
	if normalized, err := reusableReviewWorkflow(def.ReviewWorkflow); err != nil {
		writeReviewRecipeValidationError(w, err)
		return
	} else {
		def.ReviewWorkflow = normalized
	}
	if err := validateFormDefinitionDraftValue(def.Form); err != nil {
		if !writeFormValidationError(w, err) {
			serverError(w, err)
		}
		return
	}
	if recipeID != nil {
		var exists bool
		if err := tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM review_recipe_versions rv JOIN review_recipe_templates rt ON rt.id=rv.template_id WHERE rv.id=$1 AND rv.published_at IS NOT NULL AND rt.archived_at IS NULL AND (rt.scope='system' OR rt.workspace_id=$2))`, *recipeID, workspaceID).Scan(&exists); err != nil || !exists {
			errorJSON(w, http.StatusUnprocessableEntity, "review_recipe_not_found", "审核方案版本不存在或无权使用")
			return
		}
	}
	version := latest + 1
	versionID := newID()
	if _, err := tx.Exec(r.Context(), `INSERT INTO campaign_template_versions(id,template_id,workspace_id,version,definition,created_by,review_recipe_version_id) VALUES($1,$2,$3,$4,$5,$6,$7)`, versionID, templateID, workspaceID, version, mustJSON(def), claims(r).Subject, recipeID); err != nil {
		serverError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `UPDATE campaign_templates SET latest_version=$1,updated_at=NOW() WHERE id=$2 AND workspace_id=$3`, version, templateID, workspaceID); err != nil {
		serverError(w, err)
		return
	}
	item, err := loadCampaignTemplateVersion(r.Context(), tx, templateID, versionID)
	if err != nil {
		serverError(w, err)
		return
	}
	response, _ := json.Marshal(item)
	if err := completeIdempotency(r.Context(), tx, workspaceID, claims(r).Subject, http.MethodPost, r.URL.Path, key, http.StatusCreated, response); err != nil {
		serverError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	w.Header().Set("ETag", item.ETag)
	writeJSONBytes(w, http.StatusCreated, response)
}

func (app *application) updateCampaignTemplateVersion(w http.ResponseWriter, r *http.Request) {
	templateID, versionID := r.PathValue("templateId"), r.PathValue("versionId")
	_, workspaceID, err := app.campaignTemplateAccess(r.Context(), claims(r).Subject, templateID, true)
	if err != nil {
		errorJSON(w, 404, "campaign_template_not_found", "模板不存在或无权访问")
		return
	}
	current, err := loadCampaignTemplateVersion(r.Context(), app.db, templateID, versionID)
	if err != nil || current.WorkspaceID == nil || *current.WorkspaceID != workspaceID {
		errorJSON(w, 404, "campaign_template_version_not_found", "模板版本不存在或无权访问")
		return
	}
	var templateStatus string
	if err := app.db.QueryRow(r.Context(), `SELECT status FROM campaign_templates WHERE id=$1 AND workspace_id=$2`, templateID, workspaceID).Scan(&templateStatus); err != nil {
		errorJSON(w, http.StatusNotFound, "campaign_template_not_found", "模板不存在或无权访问")
		return
	}
	if templateStatus == "archived" {
		errorJSON(w, http.StatusConflict, "template_archived", "归档模板不能编辑")
		return
	}
	if current.Status != "draft" {
		errorJSON(w, 409, "version_locked", "已发布模板版本不能编辑")
		return
	}
	if !requireResourceETag(w, r, current.ETag, "模板版本已被其他人修改，请重新加载") {
		return
	}
	var in struct {
		Definition            json.RawMessage `json:"definition"`
		ReviewRecipeVersionID *string         `json:"review_recipe_version_id"`
	}
	if _, ok := decodeCampaignBody(w, r, &in); !ok {
		return
	}
	if len(in.Definition) == 0 || string(in.Definition) == "null" {
		errorJSON(w, 400, "definition_required", "必须提供模板定义")
		return
	}
	def, normalized, err := normalizeTemplateDefinition(in.Definition)
	if err != nil {
		if !writeFormValidationError(w, err) {
			errorJSON(w, 422, "invalid_template_definition", "模板定义无效")
		}
		return
	}
	if normalizedReview, e := reusableReviewWorkflow(def.ReviewWorkflow); e != nil {
		writeReviewRecipeValidationError(w, e)
		return
	} else {
		def.ReviewWorkflow = normalizedReview
		normalized = mustJSON(def)
	}
	recipeID := current.ReviewRecipeVersionID
	if in.ReviewRecipeVersionID != nil {
		recipeID = nil
		if strings.TrimSpace(*in.ReviewRecipeVersionID) != "" {
			recipeID = in.ReviewRecipeVersionID
		}
	}
	if recipeID != nil {
		var exists bool
		if err := app.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM review_recipe_versions rv JOIN review_recipe_templates rt ON rt.id=rv.template_id WHERE rv.id=$1 AND rv.published_at IS NOT NULL AND rt.archived_at IS NULL AND (rt.scope='system' OR rt.workspace_id=$2))`, *recipeID, workspaceID).Scan(&exists); err != nil || !exists {
			errorJSON(w, http.StatusUnprocessableEntity, "review_recipe_not_found", "审核方案版本不存在或无权使用")
			return
		}
	}
	if _, err := app.db.Exec(r.Context(), `UPDATE campaign_template_versions SET definition=$1,review_recipe_version_id=$2 WHERE id=$3 AND template_id=$4 AND workspace_id=$5 AND published_at IS NULL`, normalized, recipeID, versionID, templateID, workspaceID); err != nil {
		serverError(w, err)
		return
	}
	updated, _ := loadCampaignTemplateVersion(r.Context(), app.db, templateID, versionID)
	w.Header().Set("ETag", updated.ETag)
	writeJSON(w, 200, map[string]any{"version": updated, "etag": updated.ETag})
}

func (app *application) publishCampaignTemplateVersion(w http.ResponseWriter, r *http.Request) {
	templateID, versionID := r.PathValue("templateId"), r.PathValue("versionId")
	_, workspaceID, err := app.campaignTemplateAccess(r.Context(), claims(r).Subject, templateID, true)
	if err != nil {
		errorJSON(w, 404, "campaign_template_not_found", "模板不存在或无权访问")
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var kind, templateStatus string
	var publishedAt *time.Time
	var definition []byte
	if err := tx.QueryRow(r.Context(), `SELECT v.published_at,v.definition,t.kind,t.status FROM campaign_template_versions v JOIN campaign_templates t ON t.id=v.template_id WHERE v.id=$1 AND v.template_id=$2 AND v.workspace_id=$3 FOR UPDATE`, versionID, templateID, workspaceID).Scan(&publishedAt, &definition, &kind, &templateStatus); err != nil {
		errorJSON(w, 404, "campaign_template_version_not_found", "模板版本不存在或无权访问")
		return
	}
	current, err := loadCampaignTemplateVersion(r.Context(), tx, templateID, versionID)
	if err != nil {
		serverError(w, err)
		return
	}
	if !requireResourceETag(w, r, current.ETag, "模板版本已被其他人修改，请重新加载") {
		return
	}
	if publishedAt != nil {
		errorJSON(w, 409, "version_locked", "已发布模板版本不能再次发布")
		return
	}
	if templateStatus == "archived" {
		errorJSON(w, 409, "template_archived", "归档模板不能发布")
		return
	}
	var def templateDefinition
	if err := json.Unmarshal(definition, &def); err != nil {
		errorJSON(w, 422, "invalid_template_definition", "模板定义格式无效")
		return
	}
	def = normalizeDefinition(def)
	if normalized, e := reusableReviewWorkflow(def.ReviewWorkflow); e != nil {
		writeReviewRecipeValidationError(w, e)
		return
	} else {
		def.ReviewWorkflow = normalized
	}
	if err := validateTemplateDefinition(def, kind); err != nil {
		if !writeFormValidationError(w, err) && !writeReviewRecipeValidationError(w, err) {
			serverError(w, err)
		}
		return
	}
	if _, err := tx.Exec(r.Context(), `UPDATE campaign_template_versions SET definition=$1,published_at=NOW() WHERE id=$2 AND template_id=$3 AND workspace_id=$4`, mustJSON(def), versionID, templateID, workspaceID); err != nil {
		serverError(w, err)
		return
	}
	var version int
	_ = tx.QueryRow(r.Context(), `SELECT version FROM campaign_template_versions WHERE id=$1`, versionID).Scan(&version)
	if _, err := tx.Exec(r.Context(), `UPDATE campaign_templates SET published_version=$1,status='published',archived_at=NULL,updated_at=NOW() WHERE id=$2 AND workspace_id=$3`, version, templateID, workspaceID); err != nil {
		serverError(w, err)
		return
	}
	updated, err := loadCampaignTemplateVersion(r.Context(), tx, templateID, versionID)
	if err != nil {
		serverError(w, err)
		return
	}
	template, _ := loadCampaignTemplateItem(r.Context(), tx, templateID)
	response, _ := json.Marshal(map[string]any{"template": template, "version": updated})
	if err := tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	w.Header().Set("ETag", updated.ETag)
	writeJSONBytes(w, 200, response)
}

func (app *application) saveCampaignAsTemplate(w http.ResponseWriter, r *http.Request) {
	campaignID := r.PathValue("campaignId")
	access, err := app.campaignAccessForID(r.Context(), claims(r).Subject, campaignID, productionView)
	if err != nil {
		errorJSON(w, 404, "campaign_not_found", "表单不存在或无权访问")
		return
	}
	if access.WorkspaceRole != workspaceRoleOwner && access.WorkspaceRole != workspaceRoleAdmin {
		errorJSON(w, 403, "forbidden", "只有工作空间管理员可以保存模板")
		return
	}
	var in struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		RevisionID  string `json:"revision_id"`
	}
	raw, ok := decodeCampaignBody(w, r, &in)
	if !ok {
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		errorJSON(w, 422, "invalid_template_name", "模板名称不能为空")
		return
	}
	revisionID := strings.TrimSpace(in.RevisionID)
	if revisionID == "" {
		var draft, published *string
		_ = app.db.QueryRow(r.Context(), `SELECT (SELECT id FROM campaign_revisions WHERE campaign_id=$1 AND status='draft'),(SELECT id FROM campaign_revisions WHERE campaign_id=$1 AND status='published')`, campaignID).Scan(&draft, &published)
		if draft != nil {
			revisionID = *draft
		} else if published != nil {
			revisionID = *published
		}
	}
	if revisionID == "" {
		errorJSON(w, 404, "campaign_revision_not_found", "没有可复制的表单版本")
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if len(key) > 255 {
		errorJSON(w, http.StatusBadRequest, "invalid_idempotency_key", "幂等键不能超过 255 个字符")
		return
	}
	outcome, err := app.beginIdempotency(r.Context(), tx, access.WorkspaceID, claims(r).Subject, http.MethodPost, r.URL.Path, key, raw)
	if err != nil {
		serverError(w, err)
		return
	}
	if outcome.conflict {
		errorJSON(w, 409, "idempotency_key_reused", "幂等键已用于不同请求")
		return
	}
	if outcome.replay {
		_ = tx.Rollback(r.Context())
		w.Header().Set("Idempotent-Replayed", "true")
		writeJSONBytes(w, outcome.status, outcome.body)
		return
	}
	def, kind, sourceCampaignID, err := templateDefinitionFromRevision(r.Context(), tx, revisionID, access.WorkspaceID)
	if err != nil {
		errorJSON(w, 404, "campaign_revision_not_found", "活动版本不存在或无权访问")
		return
	}
	if sourceCampaignID != campaignID {
		errorJSON(w, http.StatusNotFound, "campaign_revision_not_found", "活动版本不存在或无权访问")
		return
	}
	def = normalizeDefinition(def)
	def = portableTemplateDefinition(def)
	var sourceRecipeVersionID *string
	_ = tx.QueryRow(r.Context(), `SELECT review_recipe_version_id FROM campaign_revisions WHERE id=$1 AND workspace_id=$2`, revisionID, access.WorkspaceID).Scan(&sourceRecipeVersionID)
	if normalized, e := portableReviewWorkflow(def.ReviewWorkflow); e != nil {
		writeReviewRecipeValidationError(w, e)
		return
	} else {
		def.ReviewWorkflow = normalized
	}
	templateID, versionID := newID(), newID()
	if _, err := tx.Exec(r.Context(), `INSERT INTO campaign_templates(id,workspace_id,scope,kind,name,description,status,latest_version,source_campaign_id,source_campaign_revision_id,created_by) VALUES($1,$2,'workspace',$3,$4,$5,'draft',1,$6,$7,$8)`, templateID, access.WorkspaceID, kind, in.Name, strings.TrimSpace(in.Description), sourceCampaignID, revisionID, claims(r).Subject); err != nil {
		serverError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `INSERT INTO campaign_template_versions(id,template_id,workspace_id,version,definition,created_by,review_recipe_version_id) VALUES($1,$2,$3,1,$4,$5,$6)`, versionID, templateID, access.WorkspaceID, mustJSON(def), claims(r).Subject, sourceRecipeVersionID); err != nil {
		serverError(w, err)
		return
	}
	template, _ := loadCampaignTemplateItem(r.Context(), tx, templateID)
	version, _ := loadCampaignTemplateVersion(r.Context(), tx, templateID, versionID)
	response, _ := json.Marshal(map[string]any{"template": template, "draft_version": version})
	if err := completeIdempotency(r.Context(), tx, access.WorkspaceID, claims(r).Subject, http.MethodPost, r.URL.Path, key, 201, response); err != nil {
		serverError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	writeJSONBytes(w, 201, response)
}
