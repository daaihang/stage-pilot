package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
)

// revisionETag is a strong validator for the complete revision snapshot. The
// JSON values are decoded before hashing so object key ordering does not cause
// spurious conflicts between clients.
func revisionETag(item campaignRevisionItem) string {
	canonical := func(raw json.RawMessage) any {
		var value any
		if len(raw) == 0 || json.Unmarshal(raw, &value) != nil {
			return nil
		}
		return value
	}
	payload := map[string]any{
		"id":                    item.ID,
		"campaign_id":           item.CampaignID,
		"workspace_id":          item.WorkspaceID,
		"revision_no":           item.RevisionNo,
		"status":                item.Status,
		"form_version_id":       item.FormVersionID,
		"review_recipe_version": item.ReviewRecipeVersionID,
		"availability_policy":   canonical(item.AvailabilityPolicy),
		"review_workflow":       canonical(item.ReviewWorkflow),
		"materialization_plan":  canonical(item.MaterializationPlan),
		"change_note":           item.ChangeNote,
	}
	if item.FormVersion != nil {
		payload["form_version"] = map[string]any{
			"id":             item.FormVersion.ID,
			"schema_version": item.FormVersion.SchemaVersion,
			"blocks":         canonical(item.FormVersion.Blocks),
			"fields":         canonical(item.FormVersion.Fields),
			"logic_rules":    canonical(item.FormVersion.LogicRules),
			"presentation":   canonical(item.FormVersion.Presentation),
			"end_screen":     canonical(item.FormVersion.EndScreen),
		}
	}
	encoded, _ := json.Marshal(payload)
	digest := sha256.Sum256(encoded)
	return `"` + hex.EncodeToString(digest[:]) + `"`
}

func requireRevisionMatch(w http.ResponseWriter, r *http.Request, currentETag string) bool {
	return requireRevisionMatchWithSummary(w, r, currentETag, nil)
}

func requireRevisionMatchWithSummary(w http.ResponseWriter, r *http.Request, currentETag string, current *campaignRevisionItem) bool {
	w.Header().Set("ETag", currentETag)
	fields := map[string]any{"current_etag": currentETag}
	if current != nil {
		fields["current_revision"] = map[string]any{"id": current.ID, "revision_no": current.RevisionNo, "status": current.Status, "form_version_id": current.FormVersionID}
	}
	provided := strings.TrimSpace(r.Header.Get("If-Match"))
	if provided == "" {
		errorJSONWithFields(w, http.StatusPreconditionRequired, "precondition_required", "缺少 If-Match 版本标记", fields)
		return false
	}
	if provided != currentETag {
		errorJSONWithFields(w, http.StatusPreconditionFailed, "revision_conflict", "表单版本已被其他人修改，请重新加载最新版本", fields)
		return false
	}
	return true
}

func (app *application) getCampaignRevision(w http.ResponseWriter, r *http.Request) {
	campaignID, revisionID := r.PathValue("campaignId"), r.PathValue("revisionId")
	access, err := app.campaignAccessForID(r.Context(), claims(r).Subject, campaignID, productionView)
	if err != nil {
		if errors.Is(err, errCampaignPermissionDenied) {
			errorJSON(w, http.StatusForbidden, "forbidden", "没有查看该表单的权限")
		} else {
			errorJSON(w, http.StatusNotFound, "campaign_not_found", "表单不存在或无权访问")
		}
		return
	}
	revision, err := app.loadRevision(r.Context(), app.db, revisionID, access.WorkspaceID)
	if err != nil || revision.CampaignID != campaignID {
		errorJSON(w, http.StatusNotFound, "campaign_revision_not_found", "表单版本不存在或无权访问")
		return
	}
	w.Header().Set("ETag", revision.ETag)
	writeJSON(w, http.StatusOK, revision)
}

func (app *application) updateCampaignRevision(w http.ResponseWriter, r *http.Request) {
	campaignID, revisionID := r.PathValue("campaignId"), r.PathValue("revisionId")
	access, err := app.campaignAccessForID(r.Context(), claims(r).Subject, campaignID, productionEdit)
	if err != nil {
		if errors.Is(err, errCampaignPermissionDenied) {
			errorJSON(w, http.StatusForbidden, "forbidden", "没有编辑该表单版本的权限")
		} else {
			errorJSON(w, http.StatusNotFound, "campaign_not_found", "表单不存在或无权访问")
		}
		return
	}
	var patch map[string]json.RawMessage
	if _, ok := decodeCampaignBody(w, r, &patch); !ok {
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var campaignStatus string
	if err := tx.QueryRow(r.Context(), `SELECT status FROM campaigns WHERE id=$1 AND workspace_id=$2 AND production_id=$3 AND deleted_at IS NULL FOR UPDATE`, campaignID, access.WorkspaceID, access.ProductionID).Scan(&campaignStatus); err != nil {
		errorJSON(w, http.StatusNotFound, "campaign_not_found", "表单不存在")
		return
	}
	if campaignStatus == "archived" {
		errorJSON(w, http.StatusConflict, "campaign_archived", "归档表单不能继续编辑")
		return
	}
	var revisionStatus, formVersionID string
	if err := tx.QueryRow(r.Context(), `SELECT status,form_version_id FROM campaign_revisions WHERE id=$1 AND campaign_id=$2 AND workspace_id=$3 FOR UPDATE`, revisionID, campaignID, access.WorkspaceID).Scan(&revisionStatus, &formVersionID); err != nil {
		errorJSON(w, http.StatusNotFound, "campaign_revision_not_found", "表单版本不存在或无权访问")
		return
	}
	if revisionStatus != "draft" {
		errorJSON(w, http.StatusConflict, "revision_locked", "已发布或归档的表单版本不能编辑")
		return
	}
	current, err := app.loadRevision(r.Context(), tx, revisionID, access.WorkspaceID)
	if err != nil {
		serverError(w, err)
		return
	}
	if !requireRevisionMatchWithSummary(w, r, current.ETag, &current) {
		return
	}

	form := formDefinition{SchemaVersion: current.FormVersion.SchemaVersion, Blocks: current.FormVersion.Blocks, Fields: current.FormVersion.Fields, LogicRules: current.FormVersion.LogicRules, Presentation: current.FormVersion.Presentation, EndScreen: current.FormVersion.EndScreen}
	if value, exists := patch["form"]; exists {
		if err := json.Unmarshal(value, &form); err != nil {
			errorJSON(w, http.StatusBadRequest, "invalid_form_definition", "表单定义格式无效")
			return
		}
		form = normalizeFormDefinition(form)
		if err := validateFormDefinitionDraftValue(form); err != nil {
			if !writeFormValidationError(w, err) {
				serverError(w, err)
			}
			return
		}
	}
	availability, review, materialization := current.AvailabilityPolicy, current.ReviewWorkflow, current.MaterializationPlan
	if value, exists := patch["availability_policy"]; exists {
		if !validJSONType(value, "object") {
			errorJSON(w, http.StatusUnprocessableEntity, "invalid_policy", "availability_policy 必须是 JSON 对象")
			return
		}
		availability = value
	}
	if value, exists := patch["materialization_plan"]; exists {
		if !validJSONType(value, "object") {
			errorJSON(w, http.StatusUnprocessableEntity, "invalid_policy", "materialization_plan 必须是 JSON 对象")
			return
		}
		materialization = value
	}
	recipeID := current.ReviewRecipeVersionID
	recipeChanged := false
	if value, exists := patch["review_recipe_version_id"]; exists {
		recipeChanged = true
		var requested *string
		if string(value) != "null" {
			var id string
			if err := json.Unmarshal(value, &id); err != nil || strings.TrimSpace(id) == "" {
				errorJSON(w, http.StatusUnprocessableEntity, "invalid_review_recipe", "审核方案版本标识无效")
				return
			}
			id = strings.TrimSpace(id)
			requested = &id
		}
		recipeID = requested
		if requested != nil {
			_, snapshot, err := resolveReviewRecipeSnapshot(r.Context(), tx, *requested, access.WorkspaceID)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					errorJSON(w, http.StatusUnprocessableEntity, "review_recipe_not_found", "审核方案版本不存在、未发布或无权使用")
				} else {
					serverError(w, err)
				}
				return
			}
			if _, exists := patch["review_workflow"]; !exists {
				review = snapshot
			}
		}
	}
	if value, exists := patch["review_workflow"]; exists {
		if !validJSONType(value, "object") {
			errorJSON(w, http.StatusUnprocessableEntity, "invalid_review_recipe", "review_workflow 必须是 JSON 对象")
			return
		}
		review = value
	}
	if _, exists := patch["review_workflow"]; exists || recipeChanged {
		_, normalized, err := parseReviewRecipeDefinition(review, true)
		if err != nil {
			writeReviewRecipeValidationError(w, err)
			return
		}
		review = normalized
	}
	changeNote := current.ChangeNote
	if value, exists := patch["change_note"]; exists {
		if err := json.Unmarshal(value, &changeNote); err != nil {
			errorJSON(w, http.StatusBadRequest, "invalid_input", "change_note 格式无效")
			return
		}
	}
	if _, err := tx.Exec(r.Context(), `UPDATE form_versions SET schema_version=$1,blocks=$2,fields=$3,logic_rules=$4,presentation=$5,end_screen=$6 WHERE id=$7 AND workspace_id=$8`, form.SchemaVersion, form.Blocks, form.Fields, form.LogicRules, form.Presentation, form.EndScreen, formVersionID, access.WorkspaceID); err != nil {
		serverError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `UPDATE campaign_revisions SET review_recipe_version_id=$1,availability_policy=$2,review_workflow=$3,materialization_plan=$4,change_note=$5 WHERE id=$6 AND workspace_id=$7 AND campaign_id=$8`, recipeID, availability, review, materialization, changeNote, revisionID, access.WorkspaceID, campaignID); err != nil {
		serverError(w, err)
		return
	}
	// Keep the campaign summary's recency in sync with edits to its draft
	// revision. The list endpoint intentionally returns campaign summaries, so
	// this timestamp is the lightweight signal used to order recently edited
	// forms without loading every FormVersion into the list response.
	if _, err := tx.Exec(r.Context(), `UPDATE campaigns SET updated_at=NOW() WHERE id=$1 AND workspace_id=$2`, campaignID, access.WorkspaceID); err != nil {
		serverError(w, err)
		return
	}
	updated, err := app.loadRevision(r.Context(), tx, revisionID, access.WorkspaceID)
	if err != nil {
		serverError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	w.Header().Set("ETag", updated.ETag)
	writeJSON(w, http.StatusOK, updated)
}

type revisionValidationIssue struct {
	Severity string `json:"severity"`
	Code     string `json:"code"`
	Path     string `json:"path,omitempty"`
	Message  string `json:"message"`
}

func issueFromValidationError(err error, path string) revisionValidationIssue {
	issue := revisionValidationIssue{Severity: "error", Path: path, Message: err.Error()}
	var formErr *formValidationError
	if errors.As(err, &formErr) {
		issue.Code = formErr.Code
		return issue
	}
	var recipeErr *reviewRecipeValidationError
	if errors.As(err, &recipeErr) {
		issue.Code = recipeErr.Code
		return issue
	}
	issue.Code = "invalid_revision"
	return issue
}

func (app *application) validateCampaignRevision(w http.ResponseWriter, r *http.Request) {
	campaignID, revisionID := r.PathValue("campaignId"), r.PathValue("revisionId")
	access, err := app.campaignAccessForID(r.Context(), claims(r).Subject, campaignID, productionEdit)
	if err != nil {
		if errors.Is(err, errCampaignPermissionDenied) {
			errorJSON(w, http.StatusForbidden, "forbidden", "没有校验该表单版本的权限")
		} else {
			errorJSON(w, http.StatusNotFound, "campaign_not_found", "表单不存在或无权访问")
		}
		return
	}
	revision, err := app.loadRevision(r.Context(), app.db, revisionID, access.WorkspaceID)
	if err != nil || revision.CampaignID != campaignID {
		errorJSON(w, http.StatusNotFound, "campaign_revision_not_found", "表单版本不存在或无权访问")
		return
	}
	// Validation is read-only by default, but an explicitly supplied ETag is
	// honored so an editor can detect a concurrent save before presenting
	// publish errors.
	if provided := strings.TrimSpace(r.Header.Get("If-Match")); provided != "" && provided != revision.ETag {
		errorJSONWithFields(w, http.StatusPreconditionFailed, "revision_conflict", "表单版本已被其他人修改，请重新加载最新版本", map[string]any{
			"current_etag":     revision.ETag,
			"current_revision": map[string]any{"id": revision.ID, "revision_no": revision.RevisionNo, "status": revision.Status, "form_version_id": revision.FormVersionID},
		})
		w.Header().Set("ETag", revision.ETag)
		return
	}
	issues := make([]revisionValidationIssue, 0, 8)
	if revision.ReviewRecipeVersionID == nil || strings.TrimSpace(*revision.ReviewRecipeVersionID) == "" {
		issues = append(issues, revisionValidationIssue{Severity: "error", Code: "review_recipe_source_required", Path: "/review_recipe_version_id", Message: "请选择已发布的单轮审核方案来源"})
	} else if _, err := loadReviewRecipeVersion(r.Context(), app.db, *revision.ReviewRecipeVersionID, access.WorkspaceID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			issues = append(issues, revisionValidationIssue{Severity: "error", Code: "review_recipe_not_found", Path: "/review_recipe_version_id", Message: "审核方案版本不存在、未发布或无权使用"})
		} else {
			serverError(w, err)
			return
		}
	}
	if revision.FormVersion == nil {
		issues = append(issues, revisionValidationIssue{Severity: "error", Code: "form_version_missing", Path: "/form", Message: "表单定义不存在"})
	} else {
		form := formDefinition{SchemaVersion: revision.FormVersion.SchemaVersion, Blocks: revision.FormVersion.Blocks, Fields: revision.FormVersion.Fields, LogicRules: revision.FormVersion.LogicRules, Presentation: revision.FormVersion.Presentation, EndScreen: revision.FormVersion.EndScreen}
		if err := validateFormDefinitionValue(form); err != nil {
			issues = append(issues, issueFromValidationError(err, "/form"))
		}
	}
	if err := validateAvailabilityPolicyValue(revision.AvailabilityPolicy); err != nil {
		issues = append(issues, issueFromValidationError(err, "/availability_policy"))
	}
	if revision.FormVersion != nil {
		if err := validatePublicSubmissionCompatibility(revision.AvailabilityPolicy, revision.FormVersion.Fields, revision.ReviewWorkflow); err != nil {
			path := "/review_workflow"
			var formErr *formValidationError
			if errors.As(err, &formErr) && formErr.Code == "contact_email_required_for_actor_limit" {
				path = "/availability_policy/per_actor_limit"
			}
			issues = append(issues, issueFromValidationError(err, path))
		}
	}
	var campaignKind string
	if err := app.db.QueryRow(r.Context(), `SELECT kind FROM campaigns WHERE id=$1 AND workspace_id=$2`, campaignID, access.WorkspaceID).Scan(&campaignKind); err == nil {
		if err := validateMaterializationPlanValue(revision.MaterializationPlan, campaignKind); err != nil {
			issues = append(issues, issueFromValidationError(err, "/materialization_plan"))
		}
	}
	parsed, _, recipeErr := parseReviewRecipeDefinition(revision.ReviewWorkflow, false)
	if recipeErr != nil {
		issues = append(issues, issueFromValidationError(recipeErr, "/review_workflow"))
	} else if err := validateReviewRecipeReferences(r.Context(), app.db, parsed, access.WorkspaceID, access.ProductionID, true); err != nil {
		issues = append(issues, issueFromValidationError(err, "/review_workflow"))
	} else if err := validateP1ReviewerThreshold(r.Context(), app.db, access.WorkspaceID, access.ProductionID, parsed); err != nil {
		issues = append(issues, issueFromValidationError(err, "/review_workflow"))
	}
	warnings := 0
	if revision.FormVersion != nil {
		var fields []map[string]any
		if json.Unmarshal(revision.FormVersion.Fields, &fields) == nil && len(fields) == 0 {
			warnings++
			issues = append(issues, revisionValidationIssue{Severity: "warning", Code: "no_fields", Path: "/form/fields", Message: "表单尚未添加字段"})
		}
	}
	errorsCount := 0
	for _, issue := range issues {
		if issue.Severity == "error" {
			errorsCount++
		}
	}
	w.Header().Set("ETag", revision.ETag)
	writeJSON(w, http.StatusOK, map[string]any{
		"valid":   errorsCount == 0,
		"etag":    revision.ETag,
		"summary": map[string]int{"errors": errorsCount, "warnings": warnings},
		"issues":  issues,
	})
}
