package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

const (
	campaignKindRegistration = "REGISTRATION"
	campaignKindSubmission   = "SUBMISSION"
	campaignKindRecruitment  = "RECRUITMENT"
	campaignKindCollection   = "COLLECTION"
)

var campaignKinds = map[string]bool{
	campaignKindRegistration: true,
	campaignKindSubmission:   true,
	campaignKindRecruitment:  true,
	campaignKindCollection:   true,
}

var campaignStatuses = map[string]bool{
	"draft":     true,
	"published": true,
	"paused":    true,
	"closed":    true,
	"archived":  true,
}

var errCampaignPermissionDenied = errors.New("campaign permission denied")

type campaignTemplateItem struct {
	ID             string         `json:"id"`
	Scope          string         `json:"scope"`
	WorkspaceID    *string        `json:"workspace_id"`
	Kind           string         `json:"kind"`
	Name           string         `json:"name"`
	Description    string         `json:"description"`
	Status         string         `json:"status"`
	LatestVersion  int            `json:"latest_version"`
	SourceTemplate *string        `json:"source_template_id,omitempty"`
	Metadata       map[string]any `json:"metadata"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
}

type formVersionItem struct {
	ID            string          `json:"id"`
	SchemaVersion int             `json:"schema_version"`
	Blocks        json.RawMessage `json:"blocks"`
	Fields        json.RawMessage `json:"fields"`
	LogicRules    json.RawMessage `json:"logic_rules"`
	EndScreen     json.RawMessage `json:"end_screen"`
	CreatedAt     time.Time       `json:"created_at"`
}

type campaignRevisionItem struct {
	ID                    string           `json:"id"`
	CampaignID            string           `json:"campaign_id"`
	WorkspaceID           string           `json:"workspace_id"`
	RevisionNo            int              `json:"revision_no"`
	Status                string           `json:"status"`
	FormVersionID         string           `json:"form_version_id"`
	ReviewRecipeVersionID *string          `json:"review_recipe_version_id,omitempty"`
	AvailabilityPolicy    json.RawMessage  `json:"availability_policy"`
	ReviewWorkflow        json.RawMessage  `json:"review_workflow"`
	MaterializationPlan   json.RawMessage  `json:"materialization_plan"`
	ChangeNote            string           `json:"change_note"`
	CreatedBy             string           `json:"created_by"`
	CreatedAt             time.Time        `json:"created_at"`
	PublishedAt           *time.Time       `json:"published_at,omitempty"`
	ArchivedAt            *time.Time       `json:"archived_at,omitempty"`
	ETag                  string           `json:"etag,omitempty"`
	FormVersion           *formVersionItem `json:"form_version,omitempty"`
}

type campaignStats struct {
	TotalEntries      int64 `json:"total_entries"`
	SubmittedEntries  int64 `json:"submitted_entries"`
	AcceptedEntries   int64 `json:"accepted_entries"`
	WaitlistedEntries int64 `json:"waitlisted_entries"`
	ConvertedEntries  int64 `json:"converted_entries"`
}

type campaignItem struct {
	ID                    string         `json:"id"`
	WorkspaceID           string         `json:"workspace_id"`
	ProductionID          string         `json:"production_id"`
	Kind                  string         `json:"kind"`
	Name                  string         `json:"name"`
	Description           string         `json:"description"`
	Status                string         `json:"status"`
	PublicSlug            *string        `json:"public_slug,omitempty"`
	PublishedRevisionID   *string        `json:"published_revision_id,omitempty"`
	SourceTemplateID      *string        `json:"source_template_id,omitempty"`
	SourceTemplateVersion *int           `json:"source_template_version,omitempty"`
	CreatedBy             string         `json:"created_by"`
	CreatedAt             time.Time      `json:"created_at"`
	UpdatedAt             time.Time      `json:"updated_at"`
	ArchivedAt            *time.Time     `json:"archived_at,omitempty"`
	Stats                 *campaignStats `json:"stats,omitempty"`
}

type campaignDetailItem struct {
	Campaign           campaignItem          `json:"campaign"`
	DraftRevision      *campaignRevisionItem `json:"draft_revision,omitempty"`
	PublishedRevision  *campaignRevisionItem `json:"published_revision,omitempty"`
	AvailabilityPolicy json.RawMessage       `json:"availability_policy"`
	Stats              campaignStats         `json:"stats"`
}

type campaignCreateInput struct {
	Name                  string          `json:"name"`
	Description           string          `json:"description"`
	Kind                  string          `json:"kind"`
	TemplateID            string          `json:"template_id"`
	TemplateVersion       *int            `json:"template_version"`
	ReviewRecipeVersionID string          `json:"review_recipe_version_id"`
	ReviewWorkflow        json.RawMessage `json:"review_workflow"`
}

type campaignRevisionCreateInput struct {
	ChangeNote            string          `json:"change_note"`
	Form                  *formDefinition `json:"form"`
	AvailabilityPolicy    json.RawMessage `json:"availability_policy"`
	ReviewRecipeVersionID string          `json:"review_recipe_version_id"`
	ReviewWorkflow        json.RawMessage `json:"review_workflow"`
	MaterializationPlan   json.RawMessage `json:"materialization_plan"`
}

type formDefinition struct {
	SchemaVersion int             `json:"schema_version"`
	Blocks        json.RawMessage `json:"blocks"`
	Fields        json.RawMessage `json:"fields"`
	LogicRules    json.RawMessage `json:"logic_rules"`
	EndScreen     json.RawMessage `json:"end_screen"`
}

type templateDefinition struct {
	Form                formDefinition  `json:"form"`
	AvailabilityPolicy  json.RawMessage `json:"availability_policy"`
	ReviewWorkflow      json.RawMessage `json:"review_workflow"`
	MaterializationPlan json.RawMessage `json:"materialization_plan"`
}

func defaultJSON(raw json.RawMessage, fallback string) json.RawMessage {
	if len(raw) == 0 || string(raw) == "null" {
		return json.RawMessage(fallback)
	}
	return raw
}

func normalizeFormDefinition(form formDefinition) formDefinition {
	if form.SchemaVersion < 1 {
		form.SchemaVersion = 1
	}
	form.Blocks = defaultJSON(form.Blocks, "[]")
	form.Fields = defaultJSON(form.Fields, "[]")
	form.LogicRules = defaultJSON(form.LogicRules, "[]")
	form.EndScreen = defaultJSON(form.EndScreen, "{}")
	return form
}

func normalizeDefinition(def templateDefinition) templateDefinition {
	def.Form = normalizeFormDefinition(def.Form)
	def.AvailabilityPolicy = defaultJSON(def.AvailabilityPolicy, "{}")
	def.ReviewWorkflow = defaultJSON(def.ReviewWorkflow, "{}")
	def.MaterializationPlan = defaultJSON(def.MaterializationPlan, "{}")
	return def
}

func validJSONType(raw json.RawMessage, expected string) bool {
	var value any
	if len(raw) == 0 || json.Unmarshal(raw, &value) != nil {
		return false
	}
	switch expected {
	case "array":
		_, ok := value.([]any)
		return ok
	case "object":
		_, ok := value.(map[string]any)
		return ok
	default:
		return true
	}
}

func validateFormDefinition(w http.ResponseWriter, form formDefinition) bool {
	if form.SchemaVersion < 1 || !validJSONType(form.Blocks, "array") || !validJSONType(form.Fields, "array") || !validJSONType(form.LogicRules, "array") || !validJSONType(form.EndScreen, "object") {
		errorJSON(w, http.StatusUnprocessableEntity, "invalid_form_definition", "表单定义的内容块、字段、逻辑规则和结束页格式无效")
		return false
	}
	return true
}

func validatePolicyJSON(w http.ResponseWriter, name string, raw json.RawMessage) bool {
	if !validJSONType(raw, "object") {
		errorJSON(w, http.StatusUnprocessableEntity, "invalid_policy", name+"必须是 JSON 对象")
		return false
	}
	return true
}

func decodeCampaignBody(w http.ResponseWriter, r *http.Request, destination any) ([]byte, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		errorJSON(w, http.StatusBadRequest, "invalid_json", "请求格式无效")
		return nil, false
	}
	if len(strings.TrimSpace(string(raw))) == 0 {
		raw = []byte("{}")
	}
	if err := json.Unmarshal(raw, destination); err != nil {
		errorJSON(w, http.StatusBadRequest, "invalid_json", "请求格式无效")
		return nil, false
	}
	return raw, true
}

func requestFingerprint(raw []byte) string {
	var value any
	if json.Unmarshal(raw, &value) == nil {
		if normalized, err := json.Marshal(value); err == nil {
			raw = normalized
		}
	}
	hash := sha256.Sum256(raw)
	return hex.EncodeToString(hash[:])
}

type idempotencyOutcome struct {
	replay   bool
	conflict bool
	pending  bool
	status   int
	body     []byte
}

func (app *application) beginIdempotency(ctx context.Context, tx pgx.Tx, workspaceID, actorID, method, route, key string, requestBody []byte) (idempotencyOutcome, error) {
	if key == "" {
		return idempotencyOutcome{}, nil
	}
	fingerprint := requestFingerprint(requestBody)
	var id string
	err := tx.QueryRow(ctx, `INSERT INTO api_idempotency_keys
		(id,workspace_id,actor_user_id,method,route,idempotency_key,request_hash)
		VALUES($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (workspace_id,actor_user_id,method,route,idempotency_key) DO NOTHING
		RETURNING id`, newID(), workspaceID, actorID, method, route, key, fingerprint).Scan(&id)
	if err == nil {
		return idempotencyOutcome{}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return idempotencyOutcome{}, err
	}
	var savedHash, status string
	var responseStatus *int
	var responseBody []byte
	if err := tx.QueryRow(ctx, `SELECT request_hash,status,response_status,response_body
		FROM api_idempotency_keys
		WHERE workspace_id=$1 AND actor_user_id=$2 AND method=$3 AND route=$4 AND idempotency_key=$5
		FOR UPDATE`, workspaceID, actorID, method, route, key).Scan(&savedHash, &status, &responseStatus, &responseBody); err != nil {
		return idempotencyOutcome{}, err
	}
	if savedHash != fingerprint {
		return idempotencyOutcome{conflict: true}, nil
	}
	if status == "pending" {
		return idempotencyOutcome{pending: true}, nil
	}
	if responseStatus == nil || len(responseBody) == 0 {
		return idempotencyOutcome{pending: true}, nil
	}
	var decodedResponse any
	if json.Unmarshal(responseBody, &decodedResponse) == nil {
		if normalized, err := json.Marshal(decodedResponse); err == nil {
			responseBody = normalized
		}
	}
	return idempotencyOutcome{replay: true, status: *responseStatus, body: responseBody}, nil
}

func completeIdempotency(ctx context.Context, tx pgx.Tx, workspaceID, actorID, method, route, key string, status int, body []byte) error {
	if key == "" {
		return nil
	}
	_, err := tx.Exec(ctx, `UPDATE api_idempotency_keys
		SET status='succeeded',response_status=$6,response_body=$7,completed_at=NOW()
		WHERE workspace_id=$1 AND actor_user_id=$2 AND method=$3 AND route=$4 AND idempotency_key=$5`, workspaceID, actorID, method, route, key, status, body)
	return err
}

func writeJSONBytes(w http.ResponseWriter, status int, body []byte) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

func validateCampaignKind(w http.ResponseWriter, kind string) bool {
	if !campaignKinds[kind] {
		errorJSON(w, http.StatusUnprocessableEntity, "invalid_campaign_kind", "表单类型无效")
		return false
	}
	return true
}

func validateCampaignName(w http.ResponseWriter, name, description string) bool {
	if utf8.RuneCountInString(strings.TrimSpace(name)) < 1 || utf8.RuneCountInString(name) > 120 {
		errorJSON(w, http.StatusUnprocessableEntity, "invalid_campaign_name", "表单名称不能为空且不能超过 120 字")
		return false
	}
	if utf8.RuneCountInString(description) > 500 {
		errorJSON(w, http.StatusUnprocessableEntity, "invalid_campaign_description", "描述不能超过 500 字")
		return false
	}
	return true
}

func validateCampaignStatus(w http.ResponseWriter, status string) bool {
	if !campaignStatuses[status] {
		errorJSON(w, http.StatusUnprocessableEntity, "invalid_campaign_status", "表单状态无效")
		return false
	}
	return true
}

func (app *application) listCampaignTemplates(w http.ResponseWriter, r *http.Request) {
	if scope := r.URL.Query().Get("scope"); scope != "" && scope != "system" {
		errorJSON(w, http.StatusBadRequest, "invalid_scope", "全局模板接口只支持 system 作用域")
		return
	}
	if !validateTemplateFilters(w, r.URL.Query().Get("kind"), r.URL.Query().Get("status")) {
		return
	}
	items, total, err := app.queryCampaignTemplates(r.Context(), nil, r.URL.Query().Get("kind"), r.URL.Query().Get("status"))
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "next_cursor": nil, "total": total})
}

func (app *application) listWorkspaceCampaignTemplates(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.PathValue("id")
	if !validateTemplateFilters(w, r.URL.Query().Get("kind"), r.URL.Query().Get("status")) {
		return
	}
	items, total, err := app.queryCampaignTemplates(r.Context(), &workspaceID, r.URL.Query().Get("kind"), r.URL.Query().Get("status"))
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "next_cursor": nil, "total": total})
}

func validateTemplateFilters(w http.ResponseWriter, kind, status string) bool {
	if kind != "" && !campaignKinds[kind] {
		errorJSON(w, http.StatusBadRequest, "invalid_campaign_kind", "表单类型无效")
		return false
	}
	if status != "" && status != "all" && status != "draft" && status != "published" && status != "archived" {
		errorJSON(w, http.StatusBadRequest, "invalid_campaign_template_status", "模板状态无效")
		return false
	}
	return true
}

func (app *application) queryCampaignTemplates(ctx context.Context, workspaceID *string, kind, status string) ([]campaignTemplateItem, int64, error) {
	args := make([]any, 0, 3)
	where := []string{"t.archived_at IS NULL"}
	if workspaceID == nil {
		where = append(where, "t.scope='system'", "t.workspace_id IS NULL")
	} else {
		args = append(args, *workspaceID)
		where = append(where, "t.scope='workspace'", "t.workspace_id=$"+strconv.Itoa(len(args)))
	}
	if kind != "" {
		if !campaignKinds[kind] {
			return nil, 0, errors.New("invalid campaign kind filter")
		}
		args = append(args, kind)
		where = append(where, "t.kind=$"+strconv.Itoa(len(args)))
	}
	if status != "" && status != "all" {
		if status != "draft" && status != "published" && status != "archived" {
			return nil, 0, errors.New("invalid campaign template status filter")
		}
		args = append(args, status)
		where = append(where, "t.status=$"+strconv.Itoa(len(args)))
	}
	query := `SELECT t.id,t.scope,t.workspace_id,t.kind,t.name,t.description,t.status,t.latest_version,
		t.source_template_id,t.created_at,t.updated_at,
		COALESCE(v.definition->'metadata','{}'::jsonb),COUNT(*) OVER()
		FROM campaign_templates t
		LEFT JOIN campaign_template_versions v ON v.template_id=t.id AND v.version=t.latest_version
		WHERE ` + strings.Join(where, " AND ") + `
		ORDER BY t.updated_at DESC,t.id LIMIT 100`
	rows, err := app.db.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	items := make([]campaignTemplateItem, 0)
	var total int64
	for rows.Next() {
		var item campaignTemplateItem
		var metadata []byte
		if err := rows.Scan(&item.ID, &item.Scope, &item.WorkspaceID, &item.Kind, &item.Name, &item.Description, &item.Status,
			&item.LatestVersion, &item.SourceTemplate, &item.CreatedAt, &item.UpdatedAt, &metadata, &total); err != nil {
			return nil, 0, err
		}
		item.Metadata = map[string]any{}
		_ = json.Unmarshal(metadata, &item.Metadata)
		items = append(items, item)
	}
	return items, total, rows.Err()
}

func (app *application) listCampaigns(w http.ResponseWriter, r *http.Request) {
	access := currentProductionAccess(r)
	kind, status := r.URL.Query().Get("kind"), r.URL.Query().Get("status")
	args := []any{access.WorkspaceID, access.ProductionID}
	where := []string{"c.workspace_id=$1", "c.production_id=$2", "c.deleted_at IS NULL"}
	if kind != "" {
		if !campaignKinds[kind] {
			errorJSON(w, http.StatusBadRequest, "invalid_campaign_kind", "表单类型无效")
			return
		}
		args = append(args, kind)
		where = append(where, "c.kind=$"+strconv.Itoa(len(args)))
	}
	if status != "" && status != "all" {
		if !campaignStatuses[status] {
			errorJSON(w, http.StatusBadRequest, "invalid_campaign_status", "表单状态无效")
			return
		}
		args = append(args, status)
		where = append(where, "c.status=$"+strconv.Itoa(len(args)))
	}
	query := `SELECT c.id,c.workspace_id,c.production_id,c.kind,c.name,c.description,c.status,c.public_slug,
		c.published_revision_id,c.source_template_id,c.source_template_version,c.created_by,c.created_at,c.updated_at,c.archived_at,
		s.total_entries,s.submitted_entries,s.accepted_entries,s.waitlisted_entries,s.converted_entries,COUNT(*) OVER()
		FROM campaigns c
		LEFT JOIN LATERAL (SELECT COUNT(*) FILTER (WHERE deleted_at IS NULL) AS total_entries,
			COUNT(*) FILTER (WHERE deleted_at IS NULL AND status='submitted') AS submitted_entries,
			COUNT(*) FILTER (WHERE deleted_at IS NULL AND status='accepted') AS accepted_entries,
			COUNT(*) FILTER (WHERE deleted_at IS NULL AND status='waitlisted') AS waitlisted_entries,
			COUNT(*) FILTER (WHERE deleted_at IS NULL AND status='converted') AS converted_entries
			FROM entries WHERE workspace_id=c.workspace_id AND campaign_id=c.id) s ON TRUE
		WHERE ` + strings.Join(where, " AND ") + ` ORDER BY c.updated_at DESC,c.id LIMIT 100`
	rows, err := app.db.Query(r.Context(), query, args...)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	items := make([]campaignItem, 0)
	var total int64
	for rows.Next() {
		var item campaignItem
		var stats campaignStats
		if err := rows.Scan(&item.ID, &item.WorkspaceID, &item.ProductionID, &item.Kind, &item.Name, &item.Description, &item.Status,
			&item.PublicSlug, &item.PublishedRevisionID, &item.SourceTemplateID, &item.SourceTemplateVersion, &item.CreatedBy,
			&item.CreatedAt, &item.UpdatedAt, &item.ArchivedAt, &stats.TotalEntries, &stats.SubmittedEntries, &stats.AcceptedEntries,
			&stats.WaitlistedEntries, &stats.ConvertedEntries, &total); err != nil {
			serverError(w, err)
			return
		}
		item.Stats = &stats
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "next_cursor": nil, "total": total})
}

func (app *application) createCampaign(w http.ResponseWriter, r *http.Request) {
	access := currentProductionAccess(r)
	var input campaignCreateInput
	raw, ok := decodeCampaignBody(w, r, &input)
	if !ok {
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if !validateCampaignName(w, input.Name, input.Description) {
		return
	}
	if input.TemplateID == "" && !validateCampaignKind(w, input.Kind) {
		return
	}
	if len(r.Header.Get("Idempotency-Key")) > 255 {
		errorJSON(w, http.StatusBadRequest, "invalid_idempotency_key", "幂等键不能超过 255 个字符")
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	outcome, err := app.beginIdempotency(r.Context(), tx, access.WorkspaceID, claims(r).Subject, http.MethodPost, r.URL.Path, key, raw)
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

	var templateDefinitionValue templateDefinition
	var sourceTemplateID *string
	var sourceTemplateVersion *int
	var templateRecipeVersionID *string
	kind := input.Kind
	if input.TemplateID != "" {
		var templateKind, templateStatus string
		var latestVersion int
		var version int
		if err := tx.QueryRow(r.Context(), `SELECT kind,status,latest_version FROM campaign_templates
			WHERE id=$1 AND archived_at IS NULL AND (scope='system' OR workspace_id=$2)`, input.TemplateID, access.WorkspaceID).
			Scan(&templateKind, &templateStatus, &latestVersion); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				errorJSON(w, http.StatusNotFound, "campaign_template_not_found", "模板不存在或无权使用")
				return
			}
			serverError(w, err)
			return
		}
		if templateStatus == "archived" {
			errorJSON(w, http.StatusUnprocessableEntity, "template_archived", "归档模板不能用于创建表单")
			return
		}
		kind = templateKind
		if input.Kind != "" && input.Kind != templateKind {
			errorJSON(w, http.StatusUnprocessableEntity, "campaign_kind_mismatch", "表单类型与模板类型不一致")
			return
		}
		version = latestVersion
		if input.TemplateVersion != nil {
			version = *input.TemplateVersion
		}
		if version < 1 {
			errorJSON(w, http.StatusUnprocessableEntity, "invalid_template_version", "模板版本无效")
			return
		}
		var definitionJSON []byte
		if err := tx.QueryRow(r.Context(), `SELECT version,review_recipe_version_id,definition FROM campaign_template_versions WHERE template_id=$1 AND version=$2`, input.TemplateID, version).
			Scan(&version, &templateRecipeVersionID, &definitionJSON); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				errorJSON(w, http.StatusNotFound, "campaign_template_version_not_found", "模板版本不存在")
				return
			}
			serverError(w, err)
			return
		}
		if err := json.Unmarshal(definitionJSON, &templateDefinitionValue); err != nil {
			serverError(w, err)
			return
		}
		templateDefinitionValue = normalizeDefinition(templateDefinitionValue)
		sourceTemplateID = &input.TemplateID
		sourceTemplateVersion = &version
	} else {
		templateDefinitionValue = normalizeDefinition(templateDefinition{})
	}

	reviewWorkflow := templateDefinitionValue.ReviewWorkflow
	reviewRecipeVersionID := strings.TrimSpace(input.ReviewRecipeVersionID)
	if reviewRecipeVersionID == "" && templateRecipeVersionID != nil {
		reviewRecipeVersionID = strings.TrimSpace(*templateRecipeVersionID)
	}
	if len(input.ReviewWorkflow) > 0 && string(input.ReviewWorkflow) != "null" {
		reviewWorkflow = input.ReviewWorkflow
	}
	var recipeID *string
	var recipeDefinition json.RawMessage
	if reviewRecipeVersionID != "" || len(input.ReviewWorkflow) == 0 || string(input.ReviewWorkflow) == "null" {
		recipeID, recipeDefinition, err = resolveReviewRecipeSnapshot(r.Context(), tx, reviewRecipeVersionID, access.WorkspaceID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				errorJSON(w, http.StatusNotFound, "review_recipe_not_found", "审核方案不存在或无权使用")
			} else {
				serverError(w, err)
			}
			return
		}
	}
	if len(input.ReviewWorkflow) == 0 || string(input.ReviewWorkflow) == "null" {
		if recipeID != nil {
			// A linked/default recipe is the canonical source unless the caller
			// explicitly supplied a campaign-level override. This also upgrades
			// legacy templates that predate ReviewRecipe V1 to auto-accept drafts.
			reviewWorkflow = recipeDefinition
		}
	}
	parsedReviewDefinition, normalizedReviewWorkflow, err := parseReviewRecipeDefinition(reviewWorkflow, true)
	if err != nil {
		writeReviewRecipeValidationError(w, err)
		return
	}
	if err := validateReviewRecipeReferences(r.Context(), tx, parsedReviewDefinition, access.WorkspaceID, access.ProductionID, false); err != nil {
		if !writeReviewRecipeValidationError(w, err) {
			serverError(w, err)
		}
		return
	}
	definition := normalizeDefinition(templateDefinitionValue)
	definition.ReviewWorkflow = normalizedReviewWorkflow

	campaignID, formVersionID, revisionID := newID(), newID(), newID()
	if _, err := tx.Exec(r.Context(), `INSERT INTO campaigns
		(id,workspace_id,production_id,kind,name,description,status,source_template_id,source_template_version,created_by)
		VALUES($1,$2,$3,$4,$5,$6,'draft',$7,$8,$9)`, campaignID, access.WorkspaceID, access.ProductionID, kind,
		input.Name, input.Description, sourceTemplateID, sourceTemplateVersion, claims(r).Subject); err != nil {
		serverError(w, err)
		return
	}
	form := templateDefinitionValue.Form
	if _, err := tx.Exec(r.Context(), `INSERT INTO form_versions
		(id,workspace_id,schema_version,blocks,fields,logic_rules,end_screen,created_by)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, formVersionID, access.WorkspaceID, form.SchemaVersion, form.Blocks, form.Fields, form.LogicRules, form.EndScreen, claims(r).Subject); err != nil {
		serverError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `INSERT INTO campaign_revisions
		(id,workspace_id,campaign_id,revision_no,status,form_version_id,review_recipe_version_id,availability_policy,review_workflow,materialization_plan,created_by)
		VALUES($1,$2,$3,1,'draft',$4,$5,$6,$7,$8,$9)`, revisionID, access.WorkspaceID, campaignID, formVersionID, recipeID,
		definition.AvailabilityPolicy, definition.ReviewWorkflow, definition.MaterializationPlan, claims(r).Subject); err != nil {
		serverError(w, err)
		return
	}
	detail, err := app.loadCampaignDetail(r.Context(), tx, campaignID, access.WorkspaceID)
	if err != nil {
		serverError(w, err)
		return
	}
	response, err := json.Marshal(map[string]any{"campaign": detail.Campaign, "draft_revision": detail.DraftRevision})
	if err != nil {
		serverError(w, err)
		return
	}
	if err := completeIdempotency(r.Context(), tx, access.WorkspaceID, claims(r).Subject, http.MethodPost, r.URL.Path, key, http.StatusCreated, response); err != nil {
		serverError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	writeJSONBytes(w, http.StatusCreated, response)
}

func (app *application) campaignAccessForID(ctx context.Context, userID, campaignID, permission string) (productionAccess, error) {
	var workspaceID, productionID string
	if err := app.db.QueryRow(ctx, `SELECT workspace_id,production_id FROM campaigns WHERE id=$1 AND deleted_at IS NULL`, campaignID).Scan(&workspaceID, &productionID); err != nil {
		return productionAccess{}, err
	}
	access, err := app.productionAccessFor(ctx, userID, productionID)
	if err != nil || access.WorkspaceID != workspaceID {
		return productionAccess{}, pgx.ErrNoRows
	}
	if permission != "" && !access.Permissions[permission] {
		return access, errCampaignPermissionDenied
	}
	return access, nil
}

func (app *application) getCampaign(w http.ResponseWriter, r *http.Request) {
	access, err := app.campaignAccessForID(r.Context(), claims(r).Subject, r.PathValue("campaignId"), productionView)
	if err != nil {
		if errors.Is(err, errCampaignPermissionDenied) {
			errorJSON(w, http.StatusForbidden, "forbidden", "没有查看该表单的权限")
		} else {
			errorJSON(w, http.StatusNotFound, "campaign_not_found", "表单不存在或无权访问")
		}
		return
	}
	detail, err := app.loadCampaignDetail(r.Context(), app.db, r.PathValue("campaignId"), access.WorkspaceID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			errorJSON(w, http.StatusNotFound, "campaign_not_found", "表单不存在")
			return
		}
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

func (app *application) updateCampaign(w http.ResponseWriter, r *http.Request) {
	campaignID := r.PathValue("campaignId")
	access, err := app.campaignAccessForID(r.Context(), claims(r).Subject, campaignID, productionEdit)
	if err != nil {
		if errors.Is(err, errCampaignPermissionDenied) {
			errorJSON(w, http.StatusForbidden, "forbidden", "没有编辑该表单的权限")
		} else {
			errorJSON(w, http.StatusNotFound, "campaign_not_found", "表单不存在或无权访问")
		}
		return
	}
	var patch map[string]json.RawMessage
	if _, ok := decodeCampaignBody(w, r, &patch); !ok {
		return
	}
	var currentName, currentDescription, currentStatus string
	if err := app.db.QueryRow(r.Context(), `SELECT name,description,status FROM campaigns WHERE id=$1 AND workspace_id=$2 AND production_id=$3 AND deleted_at IS NULL`, campaignID, access.WorkspaceID, access.ProductionID).Scan(&currentName, &currentDescription, &currentStatus); err != nil {
		errorJSON(w, http.StatusNotFound, "campaign_not_found", "表单不存在")
		return
	}
	if currentStatus == "archived" {
		errorJSON(w, http.StatusConflict, "campaign_archived", "归档表单不能继续编辑")
		return
	}
	name, description, status := currentName, currentDescription, currentStatus
	if value, exists := patch["name"]; exists {
		if err := json.Unmarshal(value, &name); err != nil {
			errorJSON(w, http.StatusBadRequest, "invalid_input", "名称格式无效")
			return
		}
		name = strings.TrimSpace(name)
	}
	if value, exists := patch["description"]; exists {
		if err := json.Unmarshal(value, &description); err != nil {
			errorJSON(w, http.StatusBadRequest, "invalid_input", "描述格式无效")
			return
		}
	}
	if value, exists := patch["status"]; exists {
		if err := json.Unmarshal(value, &status); err != nil {
			errorJSON(w, http.StatusBadRequest, "invalid_input", "状态格式无效")
			return
		}
		if !validateCampaignStatus(w, status) {
			return
		}
	}
	if !validateCampaignName(w, name, description) {
		return
	}
	if _, err := app.db.Exec(r.Context(), `UPDATE campaigns SET name=$1,description=$2,status=$3,
		archived_at=CASE WHEN $3='archived' THEN COALESCE(archived_at,NOW()) ELSE archived_at END,updated_at=NOW()
		WHERE id=$4 AND workspace_id=$5 AND production_id=$6 AND deleted_at IS NULL`, name, description, status, campaignID, access.WorkspaceID, access.ProductionID); err != nil {
		serverError(w, err)
		return
	}
	detail, err := app.loadCampaignDetail(r.Context(), app.db, campaignID, access.WorkspaceID)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

func (app *application) listCampaignRevisions(w http.ResponseWriter, r *http.Request) {
	campaignID := r.PathValue("campaignId")
	access, err := app.campaignAccessForID(r.Context(), claims(r).Subject, campaignID, productionView)
	if err != nil {
		errorJSON(w, http.StatusNotFound, "campaign_not_found", "表单不存在或无权访问")
		return
	}
	items, err := app.queryCampaignRevisions(r.Context(), app.db, campaignID, access.WorkspaceID)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "next_cursor": nil, "total": len(items)})
}

func (app *application) createCampaignRevision(w http.ResponseWriter, r *http.Request) {
	campaignID := r.PathValue("campaignId")
	access, err := app.campaignAccessForID(r.Context(), claims(r).Subject, campaignID, productionEdit)
	if err != nil {
		if errors.Is(err, errCampaignPermissionDenied) {
			errorJSON(w, http.StatusForbidden, "forbidden", "没有编辑该表单的权限")
		} else {
			errorJSON(w, http.StatusNotFound, "campaign_not_found", "表单不存在或无权访问")
		}
		return
	}
	var input campaignRevisionCreateInput
	raw, ok := decodeCampaignBody(w, r, &input)
	if !ok {
		return
	}
	if len(r.Header.Get("Idempotency-Key")) > 255 {
		errorJSON(w, http.StatusBadRequest, "invalid_idempotency_key", "幂等键不能超过 255 个字符")
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	outcome, err := app.beginIdempotency(r.Context(), tx, access.WorkspaceID, claims(r).Subject, http.MethodPost, r.URL.Path, key, raw)
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
	var currentStatus string
	if err := tx.QueryRow(r.Context(), `SELECT status FROM campaigns WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL FOR UPDATE`, campaignID, access.WorkspaceID).Scan(&currentStatus); err != nil {
		errorJSON(w, http.StatusNotFound, "campaign_not_found", "表单不存在")
		return
	}
	if currentStatus == "archived" {
		errorJSON(w, http.StatusConflict, "campaign_archived", "归档表单不能创建草稿")
		return
	}
	var existingDraft string
	if err := tx.QueryRow(r.Context(), `SELECT id FROM campaign_revisions WHERE workspace_id=$1 AND campaign_id=$2 AND status='draft'`, access.WorkspaceID, campaignID).Scan(&existingDraft); err == nil {
		errorJSONWithFields(w, http.StatusConflict, "draft_revision_exists", "该表单已有草稿版本", map[string]any{"revision_id": existingDraft})
		return
	} else if !errors.Is(err, pgx.ErrNoRows) {
		serverError(w, err)
		return
	}

	form := normalizeFormDefinition(formDefinition{})
	availability, review, materialization := defaultJSON(input.AvailabilityPolicy, "{}"), defaultJSON(input.ReviewWorkflow, "{}"), defaultJSON(input.MaterializationPlan, "{}")
	var sourceRecipeVersionID *string
	if input.Form == nil {
		var source formDefinition
		var sourceAvailability, sourceReview, sourceMaterialization []byte
		var sourceRecipeID *string
		err := tx.QueryRow(r.Context(), `SELECT fv.schema_version,fv.blocks,fv.fields,fv.logic_rules,fv.end_screen,
			cr.review_recipe_version_id,cr.availability_policy,cr.review_workflow,cr.materialization_plan
			FROM campaign_revisions cr JOIN form_versions fv ON fv.workspace_id=cr.workspace_id AND fv.id=cr.form_version_id
			WHERE cr.workspace_id=$1 AND cr.campaign_id=$2 AND cr.status='published'`, access.WorkspaceID, campaignID).
			Scan(&source.SchemaVersion, &source.Blocks, &source.Fields, &source.LogicRules, &source.EndScreen, &sourceRecipeID, &sourceAvailability, &sourceReview, &sourceMaterialization)
		if err == nil {
			form = normalizeFormDefinition(source)
			sourceRecipeVersionID = sourceRecipeID
			availability, materialization = sourceAvailability, sourceMaterialization
			if len(input.ReviewWorkflow) == 0 || string(input.ReviewWorkflow) == "null" {
				review = sourceReview
			}
		} else if !errors.Is(err, pgx.ErrNoRows) {
			serverError(w, err)
			return
		}
	} else {
		form = normalizeFormDefinition(*input.Form)
	}
	reviewRecipeVersionID := strings.TrimSpace(input.ReviewRecipeVersionID)
	explicitReviewRecipe := reviewRecipeVersionID != ""
	if reviewRecipeVersionID == "" && sourceRecipeVersionID != nil {
		reviewRecipeVersionID = strings.TrimSpace(*sourceRecipeVersionID)
	}
	inlineReviewProvided := len(input.ReviewWorkflow) > 0 && string(input.ReviewWorkflow) != "null"
	var recipeID *string
	var recipeDefinition json.RawMessage
	if reviewRecipeVersionID != "" || !inlineReviewProvided && (len(review) == 0 || string(review) == "{}") {
		recipeID, recipeDefinition, err = resolveReviewRecipeSnapshot(r.Context(), tx, reviewRecipeVersionID, access.WorkspaceID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				errorJSON(w, http.StatusNotFound, "review_recipe_not_found", "审核方案不存在或无权使用")
			} else {
				serverError(w, err)
			}
			return
		}
		if !inlineReviewProvided && (explicitReviewRecipe || sourceRecipeVersionID == nil || len(review) == 0 || string(review) == "{}") {
			review = recipeDefinition
		}
	}
	parsedReviewDefinition, normalizedReview, reviewErr := parseReviewRecipeDefinition(review, true)
	if reviewErr != nil {
		writeReviewRecipeValidationError(w, reviewErr)
		return
	}
	if err := validateReviewRecipeReferences(r.Context(), tx, parsedReviewDefinition, access.WorkspaceID, access.ProductionID, false); err != nil {
		if !writeReviewRecipeValidationError(w, err) {
			serverError(w, err)
		}
		return
	}
	if !validateFormDefinition(w, form) || !validatePolicyJSON(w, "availability_policy", availability) || !validatePolicyJSON(w, "materialization_plan", materialization) {
		return
	}
	var revisionNo int
	if err := tx.QueryRow(r.Context(), `SELECT COALESCE(MAX(revision_no),0)+1 FROM campaign_revisions WHERE workspace_id=$1 AND campaign_id=$2`, access.WorkspaceID, campaignID).Scan(&revisionNo); err != nil {
		serverError(w, err)
		return
	}
	formVersionID, revisionID := newID(), newID()
	if _, err := tx.Exec(r.Context(), `INSERT INTO form_versions(id,workspace_id,schema_version,blocks,fields,logic_rules,end_screen,created_by)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, formVersionID, access.WorkspaceID, form.SchemaVersion, form.Blocks, form.Fields, form.LogicRules, form.EndScreen, claims(r).Subject); err != nil {
		serverError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `INSERT INTO campaign_revisions(id,workspace_id,campaign_id,revision_no,status,form_version_id,review_recipe_version_id,availability_policy,review_workflow,materialization_plan,change_note,created_by)
		VALUES($1,$2,$3,$4,'draft',$5,$6,$7,$8,$9,$10,$11)`, revisionID, access.WorkspaceID, campaignID, revisionNo, formVersionID, recipeID,
		availability, normalizedReview, materialization, input.ChangeNote, claims(r).Subject); err != nil {
		serverError(w, err)
		return
	}
	created, err := app.loadRevision(r.Context(), tx, revisionID, access.WorkspaceID)
	if err != nil {
		serverError(w, err)
		return
	}
	response, err := json.Marshal(created)
	if err != nil {
		serverError(w, err)
		return
	}
	if err := completeIdempotency(r.Context(), tx, access.WorkspaceID, claims(r).Subject, http.MethodPost, r.URL.Path, key, http.StatusCreated, response); err != nil {
		serverError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	writeJSONBytes(w, http.StatusCreated, response)
}

func (app *application) publishCampaignRevision(w http.ResponseWriter, r *http.Request) {
	campaignID, revisionID := r.PathValue("campaignId"), r.PathValue("revisionId")
	access, err := app.campaignAccessForID(r.Context(), claims(r).Subject, campaignID, productionEdit)
	if err != nil {
		if errors.Is(err, errCampaignPermissionDenied) {
			errorJSON(w, http.StatusForbidden, "forbidden", "没有发布该表单的权限")
		} else {
			errorJSON(w, http.StatusNotFound, "campaign_not_found", "表单不存在或无权访问")
		}
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var campaignStatus, campaignKind string
	if err := tx.QueryRow(r.Context(), `SELECT status,kind FROM campaigns WHERE id=$1 AND workspace_id=$2 AND production_id=$3 AND deleted_at IS NULL FOR UPDATE`, campaignID, access.WorkspaceID, access.ProductionID).Scan(&campaignStatus, &campaignKind); err != nil {
		errorJSON(w, http.StatusNotFound, "campaign_not_found", "表单不存在")
		return
	}
	if campaignStatus == "archived" {
		errorJSON(w, http.StatusConflict, "campaign_archived", "归档表单不能发布")
		return
	}
	var revisionStatus, formVersionID string
	var recipeVersionID *string
	var availability, review, materialization []byte
	var form formDefinition
	if err := tx.QueryRow(r.Context(), `SELECT cr.status,cr.form_version_id,cr.review_recipe_version_id,cr.availability_policy,cr.review_workflow,cr.materialization_plan,
		fv.schema_version,fv.blocks,fv.fields,fv.logic_rules,fv.end_screen
		FROM campaign_revisions cr JOIN form_versions fv ON fv.workspace_id=cr.workspace_id AND fv.id=cr.form_version_id
		WHERE cr.id=$1 AND cr.campaign_id=$2 AND cr.workspace_id=$3 FOR UPDATE`, revisionID, campaignID, access.WorkspaceID).Scan(
		&revisionStatus, &formVersionID, &recipeVersionID, &availability, &review, &materialization,
		&form.SchemaVersion, &form.Blocks, &form.Fields, &form.LogicRules, &form.EndScreen); err != nil {
		errorJSON(w, http.StatusNotFound, "campaign_revision_not_found", "表单版本不存在或无权访问")
		return
	}
	if revisionStatus != "draft" {
		errorJSON(w, http.StatusConflict, "revision_not_draft", "只有草稿版本可以发布")
		return
	}
	currentRevision, err := app.loadRevision(r.Context(), tx, revisionID, access.WorkspaceID)
	if err != nil {
		serverError(w, err)
		return
	}
	if !requireRevisionMatchWithSummary(w, r, currentRevision.ETag, &currentRevision) {
		return
	}
	// Older revisions may contain a legacy stage-based JSON snapshot with no
	// recipe source. They remain readable but cannot be published. A new draft
	// may instead provide a complete V1 review_workflow inline without a source
	// recipe, so only an empty/legacy snapshot is rejected here.
	if (recipeVersionID == nil || strings.TrimSpace(*recipeVersionID) == "") &&
		(len(review) == 0 || string(review) == "null" || string(review) == "{}") {
		errorJSON(w, http.StatusUnprocessableEntity, "legacy_review_recipe_unavailable", "该版本没有审核方案来源，请创建新草稿并选择 V1 审核方案")
		return
	}
	if err := validateFormDefinitionValue(form); err != nil {
		if !writeFormValidationError(w, err) {
			serverError(w, err)
		}
		return
	}
	parsedReview, normalizedReview, err := parseReviewRecipeDefinition(review, false)
	if err != nil {
		writeReviewRecipeValidationError(w, err)
		return
	}
	if err := validateReviewRecipeReferences(r.Context(), tx, parsedReview, access.WorkspaceID, access.ProductionID, true); err != nil {
		if !writeReviewRecipeValidationError(w, err) {
			serverError(w, err)
		}
		return
	}
	if err := validateAvailabilityPolicyValue(availability); err != nil {
		if !writeFormValidationError(w, err) {
			serverError(w, err)
		}
		return
	}
	if err := validateMaterializationPlanValue(materialization, campaignKind); err != nil {
		if !writeFormValidationError(w, err) {
			serverError(w, err)
		}
		return
	}
	if recipeVersionID != nil && strings.TrimSpace(*recipeVersionID) != "" {
		if _, err := loadReviewRecipeVersion(r.Context(), tx, *recipeVersionID, access.WorkspaceID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				errorJSON(w, http.StatusUnprocessableEntity, "review_recipe_not_found", "审核方案版本不存在、未发布或无权使用")
			} else {
				serverError(w, err)
			}
			return
		}
	}
	if _, err := tx.Exec(r.Context(), `UPDATE campaign_revisions SET status='superseded',archived_at=NOW() WHERE workspace_id=$1 AND campaign_id=$2 AND status='published'`, access.WorkspaceID, campaignID); err != nil {
		serverError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `UPDATE campaign_revisions SET status='published',review_workflow=$1,published_at=NOW() WHERE id=$2 AND workspace_id=$3 AND campaign_id=$4`, normalizedReview, revisionID, access.WorkspaceID, campaignID); err != nil {
		serverError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `UPDATE campaigns SET status='published',published_revision_id=$1,updated_at=NOW() WHERE id=$2 AND workspace_id=$3 AND production_id=$4`, revisionID, campaignID, access.WorkspaceID, access.ProductionID); err != nil {
		serverError(w, err)
		return
	}
	revision, err := app.loadRevision(r.Context(), tx, revisionID, access.WorkspaceID)
	if err != nil {
		serverError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	revision.ETag = revisionETag(revision)
	w.Header().Set("ETag", revision.ETag)
	writeJSON(w, http.StatusOK, map[string]any{"campaign_id": campaignID, "revision": revision, "form_version_id": formVersionID})
}

func (app *application) loadCampaignDetail(ctx context.Context, queryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
	Query(context.Context, string, ...any) (pgx.Rows, error)
}, campaignID, workspaceID string) (campaignDetailItem, error) {
	var item campaignItem
	var stats campaignStats
	if err := queryer.QueryRow(ctx, `SELECT c.id,c.workspace_id,c.production_id,c.kind,c.name,c.description,c.status,c.public_slug,
		c.published_revision_id,c.source_template_id,c.source_template_version,c.created_by,c.created_at,c.updated_at,c.archived_at,
		s.total_entries,s.submitted_entries,s.accepted_entries,s.waitlisted_entries,s.converted_entries
		FROM campaigns c LEFT JOIN LATERAL (SELECT COUNT(*) FILTER (WHERE deleted_at IS NULL) AS total_entries,
		COUNT(*) FILTER (WHERE deleted_at IS NULL AND status='submitted') AS submitted_entries,
		COUNT(*) FILTER (WHERE deleted_at IS NULL AND status='accepted') AS accepted_entries,
		COUNT(*) FILTER (WHERE deleted_at IS NULL AND status='waitlisted') AS waitlisted_entries,
		COUNT(*) FILTER (WHERE deleted_at IS NULL AND status='converted') AS converted_entries
		FROM entries WHERE workspace_id=c.workspace_id AND campaign_id=c.id) s ON TRUE
		WHERE c.id=$1 AND c.workspace_id=$2 AND c.deleted_at IS NULL`, campaignID, workspaceID).Scan(
		&item.ID, &item.WorkspaceID, &item.ProductionID, &item.Kind, &item.Name, &item.Description, &item.Status, &item.PublicSlug,
		&item.PublishedRevisionID, &item.SourceTemplateID, &item.SourceTemplateVersion, &item.CreatedBy, &item.CreatedAt, &item.UpdatedAt, &item.ArchivedAt,
		&stats.TotalEntries, &stats.SubmittedEntries, &stats.AcceptedEntries, &stats.WaitlistedEntries, &stats.ConvertedEntries); err != nil {
		return campaignDetailItem{}, err
	}
	item.Stats = &stats
	revisions, err := app.queryCampaignRevisions(ctx, queryer, campaignID, workspaceID)
	if err != nil {
		return campaignDetailItem{}, err
	}
	var detail campaignDetailItem
	detail.Campaign, detail.Stats = item, stats
	for i := range revisions {
		revision := revisions[i]
		if revision.Status == "draft" {
			detail.DraftRevision = &revision
		}
		if revision.Status == "published" {
			detail.PublishedRevision = &revision
		}
	}
	if detail.DraftRevision != nil {
		detail.AvailabilityPolicy = detail.DraftRevision.AvailabilityPolicy
	} else if detail.PublishedRevision != nil {
		detail.AvailabilityPolicy = detail.PublishedRevision.AvailabilityPolicy
	} else {
		detail.AvailabilityPolicy = json.RawMessage(`{}`)
	}
	return detail, nil
}

func (app *application) queryCampaignRevisions(ctx context.Context, queryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
	Query(context.Context, string, ...any) (pgx.Rows, error)
}, campaignID, workspaceID string) ([]campaignRevisionItem, error) {
	rows, err := queryer.Query(ctx, `SELECT cr.id,cr.campaign_id,cr.workspace_id,cr.revision_no,cr.status,cr.form_version_id,
		cr.review_recipe_version_id,cr.availability_policy,cr.review_workflow,cr.materialization_plan,cr.change_note,cr.created_by,cr.created_at,cr.published_at,cr.archived_at,
		fv.id,fv.schema_version,fv.blocks,fv.fields,fv.logic_rules,fv.end_screen,fv.created_at
		FROM campaign_revisions cr JOIN form_versions fv ON fv.workspace_id=cr.workspace_id AND fv.id=cr.form_version_id
		WHERE cr.campaign_id=$1 AND cr.workspace_id=$2 ORDER BY cr.revision_no DESC`, campaignID, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]campaignRevisionItem, 0)
	for rows.Next() {
		var item campaignRevisionItem
		var form formVersionItem
		if err := rows.Scan(&item.ID, &item.CampaignID, &item.WorkspaceID, &item.RevisionNo, &item.Status, &item.FormVersionID,
			&item.ReviewRecipeVersionID, &item.AvailabilityPolicy, &item.ReviewWorkflow, &item.MaterializationPlan, &item.ChangeNote, &item.CreatedBy, &item.CreatedAt, &item.PublishedAt, &item.ArchivedAt,
			&form.ID, &form.SchemaVersion, &form.Blocks, &form.Fields, &form.LogicRules, &form.EndScreen, &form.CreatedAt); err != nil {
			return nil, err
		}
		item.FormVersion = &form
		item.ETag = revisionETag(item)
		items = append(items, item)
	}
	return items, rows.Err()
}

func (app *application) loadRevision(ctx context.Context, queryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
	Query(context.Context, string, ...any) (pgx.Rows, error)
}, revisionID, workspaceID string) (campaignRevisionItem, error) {
	var item campaignRevisionItem
	var form formVersionItem
	err := queryer.QueryRow(ctx, `SELECT cr.id,cr.campaign_id,cr.workspace_id,cr.revision_no,cr.status,cr.form_version_id,
		cr.review_recipe_version_id,cr.availability_policy,cr.review_workflow,cr.materialization_plan,cr.change_note,cr.created_by,cr.created_at,cr.published_at,cr.archived_at,
		fv.id,fv.schema_version,fv.blocks,fv.fields,fv.logic_rules,fv.end_screen,fv.created_at
		FROM campaign_revisions cr JOIN form_versions fv ON fv.workspace_id=cr.workspace_id AND fv.id=cr.form_version_id
		WHERE cr.id=$1 AND cr.workspace_id=$2`, revisionID, workspaceID).Scan(
		&item.ID, &item.CampaignID, &item.WorkspaceID, &item.RevisionNo, &item.Status, &item.FormVersionID,
		&item.ReviewRecipeVersionID, &item.AvailabilityPolicy, &item.ReviewWorkflow, &item.MaterializationPlan, &item.ChangeNote, &item.CreatedBy, &item.CreatedAt, &item.PublishedAt, &item.ArchivedAt,
		&form.ID, &form.SchemaVersion, &form.Blocks, &form.Fields, &form.LogicRules, &form.EndScreen, &form.CreatedAt)
	if err != nil {
		return campaignRevisionItem{}, err
	}
	item.FormVersion = &form
	item.ETag = revisionETag(item)
	return item, nil
}
