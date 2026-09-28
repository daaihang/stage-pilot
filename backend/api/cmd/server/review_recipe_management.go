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
)

func reviewRecipeTemplateETag(item reviewRecipeTemplateItem) string {
	payload := map[string]any{
		"id": item.ID, "workspace_id": item.WorkspaceID, "name": item.Name,
		"description": item.Description, "status": item.Status,
		"latest_version": item.LatestVersion, "published_version": item.PublishedVersion,
	}
	b, _ := json.Marshal(payload)
	digest := sha256.Sum256(b)
	return `"` + hex.EncodeToString(digest[:]) + `"`
}

func reviewRecipeVersionETag(item reviewRecipeVersionItem) string {
	payload := map[string]any{
		"id": item.ID, "template_id": item.TemplateID, "version": item.Version,
		"schema_version": item.SchemaVersion, "definition": json.RawMessage(item.Definition),
		"published_at": item.PublishedAt,
	}
	b, _ := json.Marshal(payload)
	digest := sha256.Sum256(b)
	return `"` + hex.EncodeToString(digest[:]) + `"`
}

func loadReviewRecipeTemplateItem(ctx context.Context, q reviewRecipeQueryer, id string) (reviewRecipeTemplateItem, error) {
	var item reviewRecipeTemplateItem
	err := q.QueryRow(ctx, `SELECT rt.id,rt.scope,rt.workspace_id,rt.key,rt.name,rt.description,rt.status,
		rt.latest_version,rt.published_version,latest.id,draft.id,published.id,rt.source_template_id,
		rt.created_by,rt.created_at,rt.updated_at,rt.archived_at
		FROM review_recipe_templates rt
		LEFT JOIN review_recipe_versions latest ON latest.template_id=rt.id AND latest.version=rt.latest_version
		LEFT JOIN review_recipe_versions draft ON draft.template_id=rt.id AND draft.published_at IS NULL
		LEFT JOIN review_recipe_versions published ON published.template_id=rt.id AND published.version=rt.published_version
		WHERE rt.id=$1`, id).Scan(
		&item.ID, &item.Scope, &item.WorkspaceID, &item.Key, &item.Name, &item.Description,
		&item.Status, &item.LatestVersion, &item.PublishedVersion, &item.LatestVersionID,
		&item.DraftVersionID, &item.PublishedVersionID, &item.SourceTemplate, &item.CreatedBy,
		&item.CreatedAt, &item.UpdatedAt, &item.ArchivedAt)
	return item, err
}

func (app *application) reviewRecipeAdminAccess(ctx context.Context, userID, recipeID string) (string, error) {
	var scope, workspaceID string
	if err := app.db.QueryRow(ctx, `SELECT scope,COALESCE(workspace_id,'') FROM review_recipe_templates WHERE id=$1`, recipeID).Scan(&scope, &workspaceID); err != nil {
		return "", err
	}
	if scope != "workspace" || workspaceID == "" {
		return "", errCampaignPermissionDenied
	}
	var role string
	if err := app.db.QueryRow(ctx, `SELECT role FROM workspace_memberships WHERE workspace_id=$1 AND user_id=$2 AND status='active'`, workspaceID, userID).Scan(&role); err != nil {
		return "", errCampaignPermissionDenied
	}
	if roleRank[role] < roleRank[workspaceRoleAdmin] {
		return "", errCampaignPermissionDenied
	}
	return workspaceID, nil
}

func reusablePublishedReviewWorkflow(raw json.RawMessage) (json.RawMessage, error) {
	normalized, err := reusableReviewWorkflow(raw)
	if err != nil {
		return nil, err
	}
	if err := validateSingleRoundReviewWorkflow(normalized); err != nil {
		return nil, err
	}
	definition, normalized, err := parseReviewRecipeDefinition(normalized, true)
	if err != nil {
		return nil, err
	}
	for _, round := range definition.Rounds {
		if round.ReviewerPolicy.Source != "production_roles" || len(round.ReviewerPolicy.RoleKeys) == 0 {
			return nil, reviewRecipeError("recipe_roles_required", "工作空间审核方案必须使用至少一个 Production 角色")
		}
	}
	return normalized, nil
}

func (app *application) getReviewRecipe(w http.ResponseWriter, r *http.Request) {
	recipeID := r.PathValue("recipeId")
	workspaceID, err := app.reviewRecipeAccess(r.Context(), claims(r).Subject, recipeID)
	if err != nil {
		errorJSON(w, http.StatusNotFound, "review_recipe_not_found", "审核方案不存在或无权访问")
		return
	}
	item, err := loadReviewRecipeTemplateItem(r.Context(), app.db, recipeID)
	if err != nil {
		errorJSON(w, http.StatusNotFound, "review_recipe_not_found", "审核方案不存在或无权访问")
		return
	}
	if workspaceID != "" {
		if _, adminErr := app.reviewRecipeAdminAccess(r.Context(), claims(r).Subject, recipeID); adminErr != nil {
			if item.Status != "published" {
				errorJSON(w, http.StatusNotFound, "review_recipe_not_found", "审核方案不存在或无权访问")
				return
			}
			item.DraftVersionID = nil
		}
	}
	etag := reviewRecipeTemplateETag(item)
	w.Header().Set("ETag", etag)
	writeJSON(w, http.StatusOK, map[string]any{"recipe": item, "etag": etag})
}

func (app *application) getReviewRecipeVersion(w http.ResponseWriter, r *http.Request) {
	recipeID, versionID := r.PathValue("recipeId"), r.PathValue("versionId")
	workspaceID, err := app.reviewRecipeAccess(r.Context(), claims(r).Subject, recipeID)
	if err != nil {
		errorJSON(w, http.StatusNotFound, "review_recipe_not_found", "审核方案不存在或无权访问")
		return
	}
	if workspaceID != "" {
		if _, adminErr := app.reviewRecipeAdminAccess(r.Context(), claims(r).Subject, recipeID); adminErr != nil {
			var publishedAt *time.Time
			if err := app.db.QueryRow(r.Context(), `SELECT rv.published_at FROM review_recipe_versions rv WHERE rv.id=$1 AND rv.template_id=$2`, versionID, recipeID).Scan(&publishedAt); err != nil || publishedAt == nil {
				errorJSON(w, http.StatusNotFound, "review_recipe_version_not_found", "审核方案版本不存在或无权访问")
				return
			}
		}
	}
	var item reviewRecipeVersionItem
	err = app.db.QueryRow(r.Context(), `SELECT rv.id,rv.template_id,rv.workspace_id,rv.version,rv.schema_version,rv.definition,
		rv.created_by,rv.created_at,rv.published_at FROM review_recipe_versions rv
		WHERE rv.id=$1 AND rv.template_id=$2`, versionID, recipeID).Scan(&item.ID, &item.TemplateID, &item.WorkspaceID,
		&item.Version, &item.SchemaVersion, &item.Definition, &item.CreatedBy, &item.CreatedAt, &item.PublishedAt)
	if err != nil {
		errorJSON(w, http.StatusNotFound, "review_recipe_version_not_found", "审核方案版本不存在或无权访问")
		return
	}
	etag := reviewRecipeVersionETag(item)
	item.ETag = etag
	w.Header().Set("ETag", etag)
	writeJSON(w, http.StatusOK, map[string]any{"version": item, "etag": etag})
}

func (app *application) createWorkspaceReviewRecipe(w http.ResponseWriter, r *http.Request) {
	access := currentWorkspaceAccess(r)
	var in struct {
		Key                   string          `json:"key"`
		Name                  string          `json:"name"`
		Description           string          `json:"description"`
		SourceRecipeVersionID string          `json:"source_recipe_version_id"`
		Definition            json.RawMessage `json:"definition"`
	}
	raw, ok := decodeCampaignBody(w, r, &in)
	if !ok {
		return
	}
	in.Key = strings.TrimSpace(in.Key)
	in.Name = strings.TrimSpace(in.Name)
	if in.Key == "" {
		in.Key = "recipe_" + newID()
	}
	if utf8.RuneCountInString(in.Key) > 100 || utf8.RuneCountInString(in.Name) < 1 || utf8.RuneCountInString(in.Name) > 120 || utf8.RuneCountInString(in.Description) > 500 {
		errorJSON(w, http.StatusUnprocessableEntity, "invalid_review_recipe_input", "审核方案名称、标识或描述无效")
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
	outcome, err := app.beginIdempotency(r.Context(), tx, access.WorkspaceID, access.UserID, http.MethodPost, r.URL.Path, key, raw)
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
	definitionRaw := in.Definition
	var sourceTemplateID *string
	if in.SourceRecipeVersionID != "" {
		var sourceID string
		if err := tx.QueryRow(r.Context(), `SELECT rv.template_id,rv.definition FROM review_recipe_versions rv JOIN review_recipe_templates rt ON rt.id=rv.template_id
			WHERE rv.id=$1 AND rv.published_at IS NOT NULL AND rt.archived_at IS NULL AND (rt.scope='system' OR rt.workspace_id=$2)`, in.SourceRecipeVersionID, access.WorkspaceID).Scan(&sourceID, &definitionRaw); err != nil {
			errorJSON(w, http.StatusNotFound, "review_recipe_version_not_found", "审核方案版本不存在或无权访问")
			return
		}
		sourceTemplateID = &sourceID
	}
	if len(definitionRaw) == 0 || string(definitionRaw) == "null" {
		definitionRaw = defaultSingleRoundReviewRecipe()
	}
	// A newly copied/created workspace recipe is a draft. It may intentionally
	// have no roles yet; the stricter executable-role check happens at publish.
	normalized, err := reusableReviewWorkflow(definitionRaw)
	if err != nil {
		if !writeReviewRecipeValidationError(w, err) {
			serverError(w, err)
		}
		return
	}
	templateID, versionID := newID(), newID()
	if _, err := tx.Exec(r.Context(), `INSERT INTO review_recipe_templates(id,workspace_id,scope,key,name,description,status,latest_version,source_template_id,created_by)
		VALUES($1,$2,'workspace',$3,$4,$5,'draft',1,$6,$7)`, templateID, access.WorkspaceID, in.Key, in.Name, strings.TrimSpace(in.Description), sourceTemplateID, access.UserID); err != nil {
		if isUniqueViolation(err, "review_recipe_templates_scope_key_unique") {
			errorJSON(w, http.StatusConflict, "review_recipe_key_exists", "该工作空间已存在相同标识的审核方案")
		} else {
			serverError(w, err)
		}
		return
	}
	if _, err := tx.Exec(r.Context(), `INSERT INTO review_recipe_versions(id,template_id,workspace_id,version,schema_version,definition,created_by)
		VALUES($1,$2,$3,1,1,$4,$5)`, versionID, templateID, access.WorkspaceID, normalized, access.UserID); err != nil {
		serverError(w, err)
		return
	}
	template, err := loadReviewRecipeTemplateItem(r.Context(), tx, templateID)
	if err != nil {
		serverError(w, err)
		return
	}
	version, err := loadReviewRecipeVersionForManagement(r.Context(), tx, templateID, versionID)
	if err != nil {
		serverError(w, err)
		return
	}
	response, _ := json.Marshal(map[string]any{"recipe": template, "draft_version": version})
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

func loadReviewRecipeVersionForManagement(ctx context.Context, q reviewRecipeQueryer, templateID, versionID string) (reviewRecipeVersionItem, error) {
	var item reviewRecipeVersionItem
	err := q.QueryRow(ctx, `SELECT id,template_id,workspace_id,version,schema_version,definition,created_by,created_at,published_at
		FROM review_recipe_versions WHERE id=$1 AND template_id=$2`, versionID, templateID).Scan(&item.ID, &item.TemplateID, &item.WorkspaceID, &item.Version,
		&item.SchemaVersion, &item.Definition, &item.CreatedBy, &item.CreatedAt, &item.PublishedAt)
	if err == nil {
		item.ETag = reviewRecipeVersionETag(item)
	}
	return item, err
}

func (app *application) updateReviewRecipe(w http.ResponseWriter, r *http.Request) {
	recipeID := r.PathValue("recipeId")
	workspaceID, err := app.reviewRecipeAdminAccess(r.Context(), claims(r).Subject, recipeID)
	if err != nil {
		if errors.Is(err, errCampaignPermissionDenied) {
			errorJSON(w, http.StatusForbidden, "forbidden", "没有管理审核方案的权限")
		} else {
			errorJSON(w, http.StatusNotFound, "review_recipe_not_found", "审核方案不存在或无权访问")
		}
		return
	}
	current, err := loadReviewRecipeTemplateItem(r.Context(), app.db, recipeID)
	if err != nil {
		errorJSON(w, http.StatusNotFound, "review_recipe_not_found", "审核方案不存在或无权访问")
		return
	}
	if !requireResourceETag(w, r, reviewRecipeTemplateETag(current), "审核方案已被其他人修改，请重新加载") {
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
	name, description, status := current.Name, current.Description, current.Status
	if in.Name != nil {
		name = strings.TrimSpace(*in.Name)
	}
	if in.Description != nil {
		description = strings.TrimSpace(*in.Description)
	}
	if utf8.RuneCountInString(name) < 1 || utf8.RuneCountInString(name) > 120 || utf8.RuneCountInString(description) > 500 {
		errorJSON(w, http.StatusUnprocessableEntity, "invalid_review_recipe_input", "审核方案名称或描述无效")
		return
	}
	if in.Status != nil && *in.Status != "draft" && *in.Status != "published" && *in.Status != "archived" {
		errorJSON(w, http.StatusUnprocessableEntity, "invalid_review_recipe_status", "审核方案状态无效")
		return
	}
	if in.Status != nil && *in.Status != status && *in.Status != "archived" {
		errorJSON(w, http.StatusConflict, "status_transition_not_allowed", "审核方案状态只能通过版本发布或归档操作改变")
		return
	}
	if in.Status != nil {
		status = *in.Status
	}
	if current.Status == "archived" && (in.Name != nil || in.Description != nil) {
		errorJSON(w, http.StatusConflict, "recipe_archived", "归档审核方案不能编辑")
		return
	}
	var archived any
	if status == "archived" {
		archived = time.Now()
	}
	if _, err := app.db.Exec(r.Context(), `UPDATE review_recipe_templates SET name=$1,description=$2,status=$3,archived_at=$4,updated_at=NOW() WHERE id=$5 AND workspace_id=$6`, name, description, status, archived, recipeID, workspaceID); err != nil {
		serverError(w, err)
		return
	}
	updated, _ := loadReviewRecipeTemplateItem(r.Context(), app.db, recipeID)
	etag := reviewRecipeTemplateETag(updated)
	w.Header().Set("ETag", etag)
	writeJSON(w, http.StatusOK, map[string]any{"recipe": updated, "etag": etag})
}

func (app *application) createReviewRecipeVersion(w http.ResponseWriter, r *http.Request) {
	recipeID := r.PathValue("recipeId")
	workspaceID, err := app.reviewRecipeAdminAccess(r.Context(), claims(r).Subject, recipeID)
	if err != nil {
		errorJSON(w, http.StatusNotFound, "review_recipe_not_found", "审核方案不存在或无权访问")
		return
	}
	var in struct {
		Definition json.RawMessage `json:"definition"`
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
	var status string
	if err := tx.QueryRow(r.Context(), `SELECT latest_version,published_version,status FROM review_recipe_templates WHERE id=$1 AND workspace_id=$2 FOR UPDATE`, recipeID, workspaceID).Scan(&latest, &publishedVersion, &status); err != nil {
		errorJSON(w, http.StatusNotFound, "review_recipe_not_found", "审核方案不存在或无权访问")
		return
	}
	if status == "archived" {
		errorJSON(w, http.StatusConflict, "recipe_archived", "归档审核方案不能创建版本")
		return
	}
	var exists bool
	_ = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM review_recipe_versions WHERE template_id=$1 AND published_at IS NULL)`, recipeID).Scan(&exists)
	if exists {
		errorJSON(w, http.StatusConflict, "draft_version_exists", "审核方案已有草稿版本")
		return
	}
	if len(in.Definition) == 0 || string(in.Definition) == "null" {
		if publishedVersion != nil {
			if err := tx.QueryRow(r.Context(), `SELECT definition FROM review_recipe_versions WHERE template_id=$1 AND version=$2`, recipeID, *publishedVersion).Scan(&in.Definition); err != nil {
				serverError(w, err)
				return
			}
		} else {
			in.Definition = defaultSingleRoundReviewRecipe()
		}
	}
	normalized, err := reusableReviewWorkflow(in.Definition)
	if err != nil {
		writeReviewRecipeValidationError(w, err)
		return
	}
	versionID := newID()
	if _, err := tx.Exec(r.Context(), `INSERT INTO review_recipe_versions(id,template_id,workspace_id,version,schema_version,definition,created_by) VALUES($1,$2,$3,$4,1,$5,$6)`, versionID, recipeID, workspaceID, latest+1, normalized, claims(r).Subject); err != nil {
		serverError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `UPDATE review_recipe_templates SET latest_version=$1,updated_at=NOW() WHERE id=$2 AND workspace_id=$3`, latest+1, recipeID, workspaceID); err != nil {
		serverError(w, err)
		return
	}
	item, err := loadReviewRecipeVersionForManagement(r.Context(), tx, recipeID, versionID)
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
	etag := reviewRecipeVersionETag(item)
	w.Header().Set("ETag", etag)
	writeJSONBytes(w, http.StatusCreated, response)
}

func (app *application) updateReviewRecipeVersion(w http.ResponseWriter, r *http.Request) {
	recipeID, versionID := r.PathValue("recipeId"), r.PathValue("versionId")
	workspaceID, err := app.reviewRecipeAdminAccess(r.Context(), claims(r).Subject, recipeID)
	if err != nil {
		errorJSON(w, http.StatusNotFound, "review_recipe_not_found", "审核方案不存在或无权访问")
		return
	}
	current, err := loadReviewRecipeVersionForManagement(r.Context(), app.db, recipeID, versionID)
	if err != nil || current.WorkspaceID == nil || *current.WorkspaceID != workspaceID {
		errorJSON(w, http.StatusNotFound, "review_recipe_version_not_found", "审核方案版本不存在或无权访问")
		return
	}
	var recipeStatus string
	if err := app.db.QueryRow(r.Context(), `SELECT status FROM review_recipe_templates WHERE id=$1 AND workspace_id=$2`, recipeID, workspaceID).Scan(&recipeStatus); err != nil {
		errorJSON(w, http.StatusNotFound, "review_recipe_not_found", "审核方案不存在或无权访问")
		return
	}
	if recipeStatus == "archived" {
		errorJSON(w, http.StatusConflict, "recipe_archived", "归档审核方案不能编辑")
		return
	}
	if current.PublishedAt != nil {
		errorJSON(w, http.StatusConflict, "version_locked", "已发布审核方案版本不能编辑")
		return
	}
	if !requireResourceETag(w, r, reviewRecipeVersionETag(current), "审核方案版本已被其他人修改，请重新加载") {
		return
	}
	var in struct {
		Definition json.RawMessage `json:"definition"`
	}
	if _, ok := decodeCampaignBody(w, r, &in); !ok {
		return
	}
	if len(in.Definition) == 0 || string(in.Definition) == "null" {
		errorJSON(w, http.StatusBadRequest, "definition_required", "必须提供审核方案定义")
		return
	}
	normalized, err := reusableReviewWorkflow(in.Definition)
	if err != nil {
		writeReviewRecipeValidationError(w, err)
		return
	}
	if _, err := app.db.Exec(r.Context(), `UPDATE review_recipe_versions SET definition=$1 WHERE id=$2 AND template_id=$3 AND workspace_id=$4 AND published_at IS NULL`, normalized, versionID, recipeID, workspaceID); err != nil {
		serverError(w, err)
		return
	}
	updated, _ := loadReviewRecipeVersionForManagement(r.Context(), app.db, recipeID, versionID)
	etag := reviewRecipeVersionETag(updated)
	w.Header().Set("ETag", etag)
	writeJSON(w, http.StatusOK, map[string]any{"version": updated, "etag": etag})
}

func (app *application) publishReviewRecipeVersion(w http.ResponseWriter, r *http.Request) {
	recipeID, versionID := r.PathValue("recipeId"), r.PathValue("versionId")
	workspaceID, err := app.reviewRecipeAdminAccess(r.Context(), claims(r).Subject, recipeID)
	if err != nil {
		errorJSON(w, http.StatusNotFound, "review_recipe_not_found", "审核方案不存在或无权访问")
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	item, err := loadReviewRecipeVersionForManagement(r.Context(), tx, recipeID, versionID)
	if err != nil || item.WorkspaceID == nil || *item.WorkspaceID != workspaceID {
		errorJSON(w, http.StatusNotFound, "review_recipe_version_not_found", "审核方案版本不存在或无权访问")
		return
	}
	if !requireResourceETag(w, r, reviewRecipeVersionETag(item), "审核方案版本已被其他人修改，请重新加载") {
		return
	}
	if item.PublishedAt != nil {
		errorJSON(w, http.StatusConflict, "version_locked", "已发布审核方案版本不能再次发布")
		return
	}
	var status string
	if err := tx.QueryRow(r.Context(), `SELECT status FROM review_recipe_templates WHERE id=$1 AND workspace_id=$2 FOR UPDATE`, recipeID, workspaceID).Scan(&status); err != nil {
		errorJSON(w, http.StatusNotFound, "review_recipe_not_found", "审核方案不存在或无权访问")
		return
	}
	if status == "archived" {
		errorJSON(w, http.StatusConflict, "recipe_archived", "归档审核方案不能发布")
		return
	}
	normalized, err := reusablePublishedReviewWorkflow(item.Definition)
	if err != nil {
		writeReviewRecipeValidationError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `UPDATE review_recipe_versions SET definition=$1,published_at=NOW() WHERE id=$2 AND template_id=$3 AND workspace_id=$4`, normalized, versionID, recipeID, workspaceID); err != nil {
		serverError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `UPDATE review_recipe_templates SET published_version=$1,status='published',archived_at=NULL,updated_at=NOW() WHERE id=$2 AND workspace_id=$3`, item.Version, recipeID, workspaceID); err != nil {
		serverError(w, err)
		return
	}
	updated, _ := loadReviewRecipeVersionForManagement(r.Context(), tx, recipeID, versionID)
	template, _ := loadReviewRecipeTemplateItem(r.Context(), tx, recipeID)
	response, _ := json.Marshal(map[string]any{"recipe": template, "version": updated})
	if err := tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	w.Header().Set("ETag", reviewRecipeVersionETag(updated))
	writeJSONBytes(w, http.StatusOK, response)
}
