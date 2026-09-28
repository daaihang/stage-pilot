package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const defaultWorkspaceReviewRecipeKey = "single_manual"

type workspaceReviewCatalogItem struct {
	ID                 string          `json:"id"`
	Key                string          `json:"key"`
	Name               string          `json:"name"`
	Description        string          `json:"description"`
	Status             string          `json:"status"`
	Scope              string          `json:"scope"`
	PublishedVersion   int             `json:"published_version"`
	PublishedVersionID string          `json:"published_version_id"`
	Definition         json.RawMessage `json:"definition"`
}

type workspaceReviewCatalogResponse struct {
	EnabledKeys    []string                     `json:"enabled_keys"`
	DefaultKey     string                       `json:"default_key"`
	Items          []workspaceReviewCatalogItem `json:"items"`
	AvailableItems []workspaceReviewCatalogItem `json:"available_items"`
}

// reviewRecipeSourceInfo is provenance for a form-owned workflow snapshot.
// Definition is the immutable source baseline; consumers must execute the
// separately stored Campaign/Template snapshot instead.
type reviewRecipeSourceInfo struct {
	VersionID   string          `json:"version_id"`
	Key         string          `json:"key"`
	Name        string          `json:"name"`
	Version     int             `json:"version"`
	Definition  json.RawMessage `json:"definition"`
	PublishedAt *time.Time      `json:"published_at,omitempty"`
	IsCurrent   bool            `json:"is_current"`
	Enabled     *bool           `json:"enabled,omitempty"`
}

type workspaceReviewCatalogQueryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

func loadReviewRecipeSourceInfo(ctx context.Context, queryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, workspaceID string, versionID *string) (*reviewRecipeSourceInfo, error) {
	if versionID == nil || strings.TrimSpace(*versionID) == "" {
		return nil, nil
	}
	var source reviewRecipeSourceInfo
	var enabled pgtype.Bool
	err := queryer.QueryRow(ctx, `SELECT rv.id,rt.key,rt.name,rv.version,rv.definition,rv.published_at,
		(rv.published_at IS NOT NULL AND rt.status='published' AND rt.archived_at IS NULL AND rt.published_version=rv.version),
		CASE WHEN ws.workspace_id IS NULL THEN NULL ELSE rt.key=ANY(ws.enabled_review_recipe_keys) END
		FROM review_recipe_versions rv JOIN review_recipe_templates rt ON rt.id=rv.template_id
		LEFT JOIN workspace_settings ws ON ws.workspace_id=$2
		WHERE rv.id=$1 AND (rt.scope='system' OR rt.workspace_id=$2)`, *versionID, workspaceID).
		Scan(&source.VersionID, &source.Key, &source.Name, &source.Version, &source.Definition, &source.PublishedAt, &source.IsCurrent, &enabled)
	if err != nil {
		return nil, err
	}
	if enabled.Valid {
		value := enabled.Bool
		source.Enabled = &value
	}
	return &source, nil
}

func (app *application) getWorkspaceReviewCatalog(w http.ResponseWriter, r *http.Request) {
	access := currentWorkspaceAccess(r)
	catalog, err := loadWorkspaceReviewCatalog(r.Context(), app.db, access.WorkspaceID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			errorJSON(w, http.StatusServiceUnavailable, "review_catalog_unavailable", "工作空间审核目录尚未初始化，请联系管理员")
			return
		}
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, catalog)
}

func loadWorkspaceReviewCatalog(ctx context.Context, queryer workspaceReviewCatalogQueryer, workspaceID string) (workspaceReviewCatalogResponse, error) {
	var enabled []string
	var defaultKey string
	if err := queryer.QueryRow(ctx, `SELECT enabled_review_recipe_keys,default_review_recipe_key
		FROM workspace_settings WHERE workspace_id=$1`, workspaceID).Scan(&enabled, &defaultKey); err != nil {
		return workspaceReviewCatalogResponse{}, err
	}
	available, err := loadAvailableSystemReviewRecipes(ctx, queryer)
	if err != nil {
		return workspaceReviewCatalogResponse{}, err
	}
	enabledSet := make(map[string]bool, len(enabled))
	for _, key := range enabled {
		enabledSet[key] = true
	}
	items := make([]workspaceReviewCatalogItem, 0, len(enabled))
	defaultFound := false
	for _, item := range available {
		if !enabledSet[item.Key] {
			continue
		}
		items = append(items, item)
		if item.Key == defaultKey {
			defaultFound = true
		}
	}
	if len(items) == 0 || !defaultFound {
		return workspaceReviewCatalogResponse{}, errors.New("workspace review catalog has no available default recipe")
	}
	return workspaceReviewCatalogResponse{
		EnabledKeys: enabled, DefaultKey: defaultKey, Items: items, AvailableItems: available,
	}, nil
}

func loadAvailableSystemReviewRecipes(ctx context.Context, queryer workspaceReviewCatalogQueryer) ([]workspaceReviewCatalogItem, error) {
	rows, err := queryer.Query(ctx, `SELECT rt.id,rt.key,rt.name,rt.description,rt.status,rt.scope,
		rv.version,rv.id,rv.definition
		FROM review_recipe_templates rt
		JOIN review_recipe_versions rv ON rv.template_id=rt.id AND rv.version=rt.published_version
		WHERE rt.scope='system' AND rt.workspace_id IS NULL AND rt.status='published'
		  AND rt.archived_at IS NULL AND rv.published_at IS NOT NULL
		ORDER BY rt.name,rt.key`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]workspaceReviewCatalogItem, 0)
	for rows.Next() {
		var item workspaceReviewCatalogItem
		if err := rows.Scan(&item.ID, &item.Key, &item.Name, &item.Description, &item.Status, &item.Scope,
			&item.PublishedVersion, &item.PublishedVersionID, &item.Definition); err != nil {
			return nil, err
		}
		if isExecutableSystemReviewRecipe(item.Definition) {
			items = append(items, item)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func isExecutableSystemReviewRecipe(raw json.RawMessage) bool {
	definition, _, err := parseReviewRecipeDefinition(raw, true)
	if err != nil || definition.Mode != "MANUAL_DECISION" || definition.FinalDecision != "manual" || definition.RequestChanges.Enabled || len(definition.Rounds) != 1 {
		return false
	}
	round := definition.Rounds[0]
	return round.Execution == "parallel" && round.Feedback.Kind == "binary" && (round.Scorecard == nil || len(round.Scorecard.Criteria) == 0)
}

func normalizeWorkspaceReviewKeys(keys []string, defaultKey string, available []workspaceReviewCatalogItem) ([]string, string, error) {
	availableSet := make(map[string]bool, len(available))
	for _, item := range available {
		availableSet[item.Key] = true
	}
	seen := make(map[string]bool, len(keys))
	normalized := make([]string, 0, len(keys))
	for _, key := range keys {
		key = strings.TrimSpace(key)
		if key == "" || seen[key] {
			return nil, "", reviewRecipeError("invalid_review_catalog", "审核目录不能包含空值或重复方案")
		}
		if !availableSet[key] {
			return nil, "", reviewRecipeError("review_recipe_unavailable", "审核目录只能包含已发布且可运行的系统方案")
		}
		seen[key] = true
		normalized = append(normalized, key)
	}
	if len(normalized) == 0 {
		return nil, "", reviewRecipeError("review_catalog_empty", "至少保留一种可用审核方式")
	}
	defaultKey = strings.TrimSpace(defaultKey)
	if defaultKey == "" || !seen[defaultKey] {
		return nil, "", reviewRecipeError("review_default_not_enabled", "默认审核方式必须属于当前可用目录")
	}
	sort.Strings(normalized)
	return normalized, defaultKey, nil
}

func validateWorkspaceReviewRecipeVersion(ctx context.Context, queryer workspaceReviewCatalogQueryer, workspaceID, versionID string) error {
	var scope, key, status string
	var archivedAt, publishedAt *time.Time
	var definition json.RawMessage
	err := queryer.QueryRow(ctx, `SELECT rt.scope,rt.key,rt.status,rt.archived_at,rv.published_at,rv.definition
		FROM review_recipe_versions rv JOIN review_recipe_templates rt ON rt.id=rv.template_id
		WHERE rv.id=$1 AND (rv.workspace_id IS NULL OR rv.workspace_id=$2)`, versionID, workspaceID).
		Scan(&scope, &key, &status, &archivedAt, &publishedAt, &definition)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return reviewRecipeError("review_recipe_not_found", "审核方案来源不存在、未发布或无权使用")
		}
		return err
	}
	if scope != "system" || status != "published" || archivedAt != nil || publishedAt == nil || !isExecutableSystemReviewRecipe(definition) {
		return reviewRecipeError("review_recipe_unavailable", "只能使用已发布且可运行的系统审核方案")
	}
	var enabled []string
	if err := queryer.QueryRow(ctx, `SELECT enabled_review_recipe_keys FROM workspace_settings WHERE workspace_id=$1 FOR SHARE`, workspaceID).Scan(&enabled); err != nil {
		return err
	}
	for _, enabledKey := range enabled {
		if enabledKey == key {
			return nil
		}
	}
	return reviewRecipeError("review_recipe_not_allowed", "此审核方式已被工作空间停用，请改用当前允许的方式后再发布")
}

func writeWorkspaceReviewCatalogError(w http.ResponseWriter, err error) bool {
	return writeReviewRecipeValidationError(w, err)
}
