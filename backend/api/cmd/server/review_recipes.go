package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const defaultReviewRecipeVersionID = "review_recipe_auto_accept_v1"

type reviewRecipeTemplateItem struct {
	ID                 string     `json:"id"`
	Scope              string     `json:"scope"`
	WorkspaceID        *string    `json:"workspace_id"`
	Key                string     `json:"key"`
	Name               string     `json:"name"`
	Description        string     `json:"description"`
	Status             string     `json:"status"`
	LatestVersion      int        `json:"latest_version"`
	PublishedVersion   *int       `json:"published_version,omitempty"`
	LatestVersionID    *string    `json:"latest_version_id,omitempty"`
	DraftVersionID     *string    `json:"draft_version_id,omitempty"`
	PublishedVersionID *string    `json:"published_version_id,omitempty"`
	SourceTemplate     *string    `json:"source_template_id,omitempty"`
	CreatedBy          *string    `json:"created_by,omitempty"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
	ArchivedAt         *time.Time `json:"archived_at,omitempty"`
}

type reviewRecipeVersionItem struct {
	ID            string          `json:"id"`
	TemplateID    string          `json:"template_id"`
	WorkspaceID   *string         `json:"workspace_id"`
	Version       int             `json:"version"`
	SchemaVersion int             `json:"schema_version"`
	Definition    json.RawMessage `json:"definition"`
	CreatedBy     *string         `json:"created_by,omitempty"`
	CreatedAt     time.Time       `json:"created_at"`
	PublishedAt   *time.Time      `json:"published_at,omitempty"`
	ETag          string          `json:"etag,omitempty"`
}

type reviewRecipeDefinition struct {
	SchemaVersion  int                        `json:"schema_version"`
	Mode           string                     `json:"mode"`
	Rounds         []reviewRecipeRound        `json:"rounds"`
	RequestChanges reviewRecipeRequestChanges `json:"request_changes"`
	FinalDecision  string                     `json:"final_decision"`
}

type reviewRecipeRound struct {
	Key            string                     `json:"key"`
	Name           string                     `json:"name"`
	Execution      string                     `json:"execution"`
	ReviewerPolicy reviewRecipeReviewerPolicy `json:"reviewer_policy"`
	Completion     reviewRecipeCompletion     `json:"completion"`
	Feedback       reviewRecipeFeedback       `json:"feedback"`
	Scorecard      *reviewRecipeScorecard     `json:"scorecard,omitempty"`
}

type reviewRecipeReviewerPolicy struct {
	Source    string   `json:"source"`
	MemberIDs []string `json:"member_ids"`
	RoleKeys  []string `json:"role_keys"`
}

type reviewRecipeCompletion struct {
	Mode string `json:"mode"`
	N    *int   `json:"n,omitempty"`
}

type reviewRecipeFeedback struct {
	Kind string `json:"kind"`
}

type reviewRecipeScorecard struct {
	Criteria []reviewRecipeCriterion `json:"criteria"`
}

type reviewRecipeCriterion struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Description string `json:"description"`
	ScaleMin    int    `json:"scale_min"`
	ScaleMax    int    `json:"scale_max"`
	Weight      int    `json:"weight"`
}

type reviewRecipeRequestChanges struct {
	Enabled bool   `json:"enabled"`
	Target  string `json:"target"`
}

type reviewRecipeValidationError struct {
	Code    string
	Message string
}

func (e *reviewRecipeValidationError) Error() string { return e.Message }

var validReviewRecipeModes = map[string]bool{
	"AUTO_ACCEPT":        true,
	"MANUAL_DECISION":    true,
	"SCORED_REVIEW":      true,
	"MULTI_STAGE_REVIEW": true,
}

func reviewRecipeError(code, message string) error {
	return &reviewRecipeValidationError{Code: code, Message: message}
}

func parseReviewRecipeDefinition(raw json.RawMessage, allowUnboundReviewers bool) (reviewRecipeDefinition, json.RawMessage, error) {
	if len(raw) == 0 || string(raw) == "null" {
		raw = json.RawMessage(`{"schema_version":1,"mode":"AUTO_ACCEPT","rounds":[],"request_changes":{"enabled":false,"target":"same_round"},"final_decision":"auto_accept"}`)
	}
	var definition reviewRecipeDefinition
	if err := json.Unmarshal(raw, &definition); err != nil {
		return definition, nil, reviewRecipeError("invalid_review_recipe", "审核方案格式无效")
	}
	if definition.SchemaVersion != 1 {
		return definition, nil, reviewRecipeError("unsupported_review_recipe_schema", "不支持的审核方案版本")
	}
	if !validReviewRecipeModes[definition.Mode] {
		return definition, nil, reviewRecipeError("invalid_review_recipe_mode", "审核方案模式无效")
	}
	if definition.RequestChanges.Target == "" {
		definition.RequestChanges.Target = "same_round"
	}
	if definition.RequestChanges.Target != "same_round" {
		return definition, nil, reviewRecipeError("invalid_review_recipe_request_changes", "补件只能返回原审核轮次")
	}
	if definition.FinalDecision == "" {
		if definition.Mode == "AUTO_ACCEPT" {
			definition.FinalDecision = "auto_accept"
		} else {
			definition.FinalDecision = "manual"
		}
	}
	if definition.Mode == "AUTO_ACCEPT" {
		if len(definition.Rounds) != 0 || definition.FinalDecision != "auto_accept" {
			return definition, nil, reviewRecipeError("invalid_auto_accept_recipe", "自动确认方案不能包含审核轮次")
		}
		definition.RequestChanges.Enabled = false
	} else {
		if len(definition.Rounds) == 0 {
			return definition, nil, reviewRecipeError("review_round_required", "人工审核方案至少需要一个审核轮次")
		}
		if definition.FinalDecision != "manual" {
			return definition, nil, reviewRecipeError("invalid_review_recipe_decision", "人工审核方案必须由人工完成最终决定")
		}
		if definition.Mode == "MULTI_STAGE_REVIEW" && len(definition.Rounds) < 2 {
			return definition, nil, reviewRecipeError("multi_stage_round_required", "多轮审核至少需要两个审核轮次")
		}
	}
	if definition.Mode == "SCORED_REVIEW" {
		foundScore := false
		for _, round := range definition.Rounds {
			if round.Feedback.Kind == "score" {
				foundScore = true
			}
		}
		if !foundScore {
			return definition, nil, reviewRecipeError("score_round_required", "评分审核至少需要一个评分轮次")
		}
	}
	seenRoundKeys := map[string]bool{}
	for index := range definition.Rounds {
		round := &definition.Rounds[index]
		round.Key = strings.TrimSpace(round.Key)
		round.Name = strings.TrimSpace(round.Name)
		if round.Key == "" || round.Name == "" || seenRoundKeys[round.Key] {
			return definition, nil, reviewRecipeError("invalid_review_round", "审核轮次名称和唯一标识无效")
		}
		seenRoundKeys[round.Key] = true
		if round.Execution != "parallel" {
			return definition, nil, reviewRecipeError("invalid_review_execution", "V1 审核轮次只能使用平行执行")
		}
		policy := &round.ReviewerPolicy
		for index := range policy.MemberIDs {
			policy.MemberIDs[index] = strings.TrimSpace(policy.MemberIDs[index])
		}
		for index := range policy.RoleKeys {
			policy.RoleKeys[index] = strings.TrimSpace(policy.RoleKeys[index])
		}
		if policy.Source != "explicit_members" && policy.Source != "production_roles" {
			return definition, nil, reviewRecipeError("invalid_reviewer_source", "审核人来源无效")
		}
		if hasDuplicateStrings(policy.MemberIDs) || hasDuplicateStrings(policy.RoleKeys) {
			return definition, nil, reviewRecipeError("duplicate_reviewers", "审核人不能重复")
		}
		if policy.Source == "explicit_members" && len(policy.RoleKeys) > 0 {
			return definition, nil, reviewRecipeError("mixed_reviewer_source", "指定成员时不能同时指定角色")
		}
		if policy.Source == "production_roles" && len(policy.MemberIDs) > 0 {
			return definition, nil, reviewRecipeError("mixed_reviewer_source", "按角色审核时不能同时指定成员")
		}
		if !allowUnboundReviewers && len(policy.MemberIDs) == 0 && len(policy.RoleKeys) == 0 {
			return definition, nil, reviewRecipeError("reviewer_required", "审核轮次必须配置成员或角色")
		}
		for _, roleKey := range policy.RoleKeys {
			if !validProductionRole(roleKey) {
				return definition, nil, reviewRecipeError("invalid_reviewer_role", "审核角色无效")
			}
		}
		completion := &round.Completion
		if completion.Mode != "all" && completion.Mode != "any" && completion.Mode != "at_least_n" {
			return definition, nil, reviewRecipeError("invalid_completion_mode", "审核完成条件无效")
		}
		if completion.Mode == "at_least_n" {
			if completion.N == nil || *completion.N < 1 {
				return definition, nil, reviewRecipeError("invalid_completion_count", "至少 N 人完成时 N 必须大于 0")
			}
		} else if completion.N != nil {
			return definition, nil, reviewRecipeError("invalid_completion_count", "全部或任一完成条件不能设置 N")
		}
		if round.Feedback.Kind != "binary" && round.Feedback.Kind != "score" {
			return definition, nil, reviewRecipeError("invalid_feedback_kind", "审核反馈类型无效")
		}
		if round.Feedback.Kind == "score" {
			if round.Scorecard == nil || len(round.Scorecard.Criteria) == 0 {
				return definition, nil, reviewRecipeError("scorecard_required", "评分轮次必须配置评分标准")
			}
			seenCriteria := map[string]bool{}
			weightTotal := 0
			for index := range round.Scorecard.Criteria {
				criterion := &round.Scorecard.Criteria[index]
				criterion.Key = strings.TrimSpace(criterion.Key)
				criterion.Label = strings.TrimSpace(criterion.Label)
				if criterion.Key == "" || criterion.Label == "" || seenCriteria[criterion.Key] || criterion.ScaleMin >= criterion.ScaleMax || criterion.Weight <= 0 {
					return definition, nil, reviewRecipeError("invalid_scorecard", "评分标准、量表范围或权重无效")
				}
				seenCriteria[criterion.Key] = true
				weightTotal += criterion.Weight
			}
			if weightTotal != 100 {
				return definition, nil, reviewRecipeError("invalid_score_weights", "评分权重总和必须为 100")
			}
		} else if round.Scorecard != nil && len(round.Scorecard.Criteria) > 0 {
			return definition, nil, reviewRecipeError("unexpected_scorecard", "非评分轮次不能配置评分标准")
		}
	}
	normalized, err := json.Marshal(definition)
	if err != nil {
		return definition, nil, err
	}
	return definition, normalized, nil
}

func hasDuplicateStrings(values []string) bool {
	seen := make(map[string]bool, len(values))
	for _, value := range values {
		if value == "" || seen[value] {
			return true
		}
		seen[value] = true
	}
	return false
}

type reviewRecipeQueryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func validateReviewRecipeReferences(ctx context.Context, queryer reviewRecipeQueryer, definition reviewRecipeDefinition, workspaceID, productionID string, requireReviewers bool) error {
	for _, round := range definition.Rounds {
		if round.ReviewerPolicy.Source == "production_roles" {
			if requireReviewers && len(round.ReviewerPolicy.RoleKeys) == 0 {
				return reviewRecipeError("reviewer_role_required", "审核轮次必须配置 Production 角色")
			}
			if requireReviewers && len(round.ReviewerPolicy.RoleKeys) > 0 {
				for _, roleKey := range round.ReviewerPolicy.RoleKeys {
					var exists bool
					if err := queryer.QueryRow(ctx, `SELECT EXISTS(
						SELECT 1 FROM production_memberships pm
						WHERE pm.production_id=$1 AND pm.status='active'
						  AND (pm.starts_at IS NULL OR pm.starts_at<=NOW())
						  AND (pm.expires_at IS NULL OR pm.expires_at>NOW())
						  AND pm.role_key=$2
					)`, productionID, roleKey).Scan(&exists); err != nil {
						return err
					}
					if !exists {
						return reviewRecipeError("reviewer_role_unavailable", "当前活动没有可用的指定审核角色成员")
					}
				}
			}
			continue
		}
		if round.ReviewerPolicy.Source != "explicit_members" {
			continue
		}
		if requireReviewers && len(round.ReviewerPolicy.MemberIDs) == 0 {
			return reviewRecipeError("reviewer_required", "审核轮次必须配置成员")
		}
		for _, memberID := range round.ReviewerPolicy.MemberIDs {
			var exists bool
			err := queryer.QueryRow(ctx, `SELECT EXISTS(
				SELECT 1 FROM production_memberships pm
				WHERE pm.production_id=$1 AND pm.status='active'
				  AND (pm.starts_at IS NULL OR pm.starts_at<=NOW())
				  AND (pm.expires_at IS NULL OR pm.expires_at>NOW())
				  AND (pm.id=$2 OR pm.user_id=$2)
			)`, productionID, memberID).Scan(&exists)
			if err != nil {
				return err
			}
			if !exists {
				return reviewRecipeError("reviewer_not_in_production", "指定审核人不属于当前活动")
			}
		}
	}
	return nil
}

type reviewRecipeVersionSource struct {
	ID          string
	TemplateID  string
	WorkspaceID *string
	Version     int
	Definition  json.RawMessage
}

func loadReviewRecipeVersion(ctx context.Context, queryer reviewRecipeQueryer, versionID, workspaceID string) (reviewRecipeVersionSource, error) {
	var source reviewRecipeVersionSource
	err := queryer.QueryRow(ctx, `SELECT rv.id,rv.template_id,rv.workspace_id,rv.version,rv.definition
		FROM review_recipe_versions rv
		JOIN review_recipe_templates rt ON rt.id=rv.template_id
		WHERE rv.id=$1 AND (rv.workspace_id IS NULL OR rv.workspace_id=$2)
		  AND rt.status='published' AND rt.archived_at IS NULL AND rv.published_at IS NOT NULL`, versionID, workspaceID).
		Scan(&source.ID, &source.TemplateID, &source.WorkspaceID, &source.Version, &source.Definition)
	return source, err
}

func defaultAutoAcceptReviewRecipe() json.RawMessage {
	return json.RawMessage(`{"schema_version":1,"mode":"AUTO_ACCEPT","rounds":[],"request_changes":{"enabled":false,"target":"same_round"},"final_decision":"auto_accept"}`)
}

func resolveReviewRecipeSnapshot(ctx context.Context, queryer reviewRecipeQueryer, versionID, workspaceID string) (*string, json.RawMessage, error) {
	if strings.TrimSpace(versionID) == "" {
		versionID = defaultReviewRecipeVersionID
	}
	source, err := loadReviewRecipeVersion(ctx, queryer, versionID, workspaceID)
	if err != nil {
		return nil, nil, err
	}
	return &source.ID, source.Definition, nil
}

func writeReviewRecipeValidationError(w http.ResponseWriter, err error) bool {
	var validationErr *reviewRecipeValidationError
	if errors.As(err, &validationErr) {
		errorJSON(w, http.StatusUnprocessableEntity, validationErr.Code, validationErr.Message)
		return true
	}
	return false
}

func validateReviewRecipeFilter(w http.ResponseWriter, status string) bool {
	if status != "" && status != "all" && status != "draft" && status != "published" && status != "archived" {
		errorJSON(w, http.StatusBadRequest, "invalid_review_recipe_status", "审核方案状态无效")
		return false
	}
	return true
}

func (app *application) listReviewRecipes(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	if !validateReviewRecipeFilter(w, status) {
		return
	}
	where := []string{"rt.scope='system'", "rt.workspace_id IS NULL"}
	args := []any{}
	if status != "archived" && status != "all" {
		where = append(where, "rt.archived_at IS NULL")
	}
	if status != "" && status != "all" {
		args = append(args, status)
		where = append(where, "rt.status=$1")
	}
	app.writeReviewRecipeList(w, r, strings.Join(where, " AND "), args...)
}

func (app *application) listWorkspaceReviewRecipes(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	if !validateReviewRecipeFilter(w, status) {
		return
	}
	where := []string{"rt.scope='workspace'", "rt.workspace_id=$1"}
	args := []any{r.PathValue("id")}
	access := currentWorkspaceAccess(r)
	if roleRank[access.Role] < roleRank[workspaceRoleAdmin] {
		status = "published"
	}
	if status != "archived" && status != "all" {
		where = append(where, "rt.archived_at IS NULL")
	}
	if status != "" && status != "all" {
		args = append(args, status)
		where = append(where, "rt.status=$"+strconv.Itoa(len(args)))
	}
	app.writeReviewRecipeList(w, r, strings.Join(where, " AND "), args...)
}

func (app *application) writeReviewRecipeList(w http.ResponseWriter, r *http.Request, where string, args ...any) {
	query := `SELECT rt.id,rt.scope,rt.workspace_id,rt.key,rt.name,rt.description,rt.status,rt.latest_version,rt.published_version,
		latest.id,draft.id,published.id,rt.source_template_id,rt.created_by,rt.created_at,rt.updated_at,rt.archived_at,COUNT(*) OVER()
		FROM review_recipe_templates rt
		LEFT JOIN review_recipe_versions latest ON latest.template_id=rt.id AND latest.version=rt.latest_version
		LEFT JOIN review_recipe_versions draft ON draft.template_id=rt.id AND draft.published_at IS NULL
		LEFT JOIN review_recipe_versions published ON published.template_id=rt.id AND published.version=rt.published_version
		WHERE ` + where + ` ORDER BY rt.updated_at DESC,rt.id LIMIT 100`
	rows, err := app.db.Query(r.Context(), query, args...)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	items := make([]reviewRecipeTemplateItem, 0)
	var total int64
	for rows.Next() {
		var item reviewRecipeTemplateItem
		if err := rows.Scan(&item.ID, &item.Scope, &item.WorkspaceID, &item.Key, &item.Name, &item.Description, &item.Status,
			&item.LatestVersion, &item.PublishedVersion, &item.LatestVersionID, &item.DraftVersionID, &item.PublishedVersionID, &item.SourceTemplate, &item.CreatedBy, &item.CreatedAt, &item.UpdatedAt, &item.ArchivedAt, &total); err != nil {
			serverError(w, err)
			return
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "next_cursor": nil, "total": total})
}

func (app *application) reviewRecipeAccess(ctx context.Context, userID, recipeID string) (string, error) {
	var scope, workspaceID string
	if err := app.db.QueryRow(ctx, `SELECT scope,COALESCE(workspace_id,'') FROM review_recipe_templates WHERE id=$1`, recipeID).Scan(&scope, &workspaceID); err != nil {
		return "", err
	}
	if scope == "system" {
		return "", nil
	}
	var exists bool
	if err := app.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM workspace_memberships WHERE workspace_id=$1 AND user_id=$2 AND status='active')`, workspaceID, userID).Scan(&exists); err != nil {
		return "", err
	}
	if !exists {
		return "", errors.New("review recipe forbidden")
	}
	return workspaceID, nil
}

func (app *application) listReviewRecipeVersions(w http.ResponseWriter, r *http.Request) {
	recipeID := r.PathValue("recipeId")
	workspaceID, err := app.reviewRecipeAccess(r.Context(), claims(r).Subject, recipeID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			errorJSON(w, http.StatusNotFound, "review_recipe_not_found", "审核方案不存在或无权访问")
		} else {
			errorJSON(w, http.StatusForbidden, "forbidden", "没有访问该审核方案的权限")
		}
		return
	}
	query := `SELECT rv.id,rv.template_id,rv.workspace_id,rv.version,rv.schema_version,rv.definition,rv.created_by,rv.created_at,rv.published_at
		FROM review_recipe_versions rv WHERE rv.template_id=$1`
	if workspaceID != "" {
		if _, adminErr := app.reviewRecipeAdminAccess(r.Context(), claims(r).Subject, recipeID); adminErr != nil {
			query += ` AND rv.published_at IS NOT NULL`
		}
	}
	query += ` ORDER BY rv.version DESC`
	rows, err := app.db.Query(r.Context(), query, recipeID)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	items := make([]reviewRecipeVersionItem, 0)
	for rows.Next() {
		var item reviewRecipeVersionItem
		if err := rows.Scan(&item.ID, &item.TemplateID, &item.WorkspaceID, &item.Version, &item.SchemaVersion, &item.Definition, &item.CreatedBy, &item.CreatedAt, &item.PublishedAt); err != nil {
			serverError(w, err)
			return
		}
		item.ETag = reviewRecipeVersionETag(item)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "next_cursor": nil, "total": len(items)})
}
