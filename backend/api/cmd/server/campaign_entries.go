package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

var entryStatuses = map[string]bool{
	"draft": true, "submitted": true, "in_review": true, "needs_changes": true,
	"accepted": true, "waitlisted": true, "rejected": true, "withdrawn": true,
	"converted": true, "conversion_failed": true,
}

type entryInboxCursor struct {
	SortAt      time.Time `json:"sort_at"`
	ID          string    `json:"id"`
	Fingerprint string    `json:"fingerprint"`
}

func entryInboxFilterFingerprint(r *http.Request) string {
	q := r.URL.Query()
	parts := []string{strings.Join(q["status"], ","), q.Get("q"), q.Get("is_starred"), q.Get("is_unread"), q.Get("submitted_from"), q.Get("submitted_to")}
	hash := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return fmt.Sprintf("%x", hash[:])
}

func encodeEntryInboxCursor(cursor entryInboxCursor) string {
	raw, _ := json.Marshal(cursor)
	return base64.RawURLEncoding.EncodeToString(raw)
}

func decodeEntryInboxCursor(raw, fingerprint string) (entryInboxCursor, error) {
	var cursor entryInboxCursor
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil || json.Unmarshal(decoded, &cursor) != nil || cursor.ID == "" || cursor.Fingerprint != fingerprint || cursor.SortAt.IsZero() {
		return cursor, errors.New("invalid cursor")
	}
	return cursor, nil
}

type entryAccess struct {
	Access             productionAccess
	WorkspaceID        string
	ProductionID       string
	CampaignID         string
	CampaignRevisionID string
}

func (app *application) entryAccessForID(ctx context.Context, userID, entryID, permission string) (entryAccess, error) {
	var result entryAccess
	err := app.db.QueryRow(ctx, `
		SELECT e.workspace_id,e.production_id,e.campaign_id,e.campaign_revision_id
		FROM entries e
		JOIN campaigns c ON c.workspace_id=e.workspace_id AND c.id=e.campaign_id AND c.production_id=e.production_id
		WHERE e.id=$1`, entryID).Scan(&result.WorkspaceID, &result.ProductionID, &result.CampaignID, &result.CampaignRevisionID)
	if err != nil {
		return result, err
	}
	access, err := app.productionAccessFor(ctx, userID, result.ProductionID)
	if err != nil || access.WorkspaceID != result.WorkspaceID {
		return result, pgx.ErrNoRows
	}
	if permission != "" && !access.Permissions[permission] {
		return result, errCampaignPermissionDenied
	}
	result.Access = access
	return result, nil
}

type entryInboxItem struct {
	ID                 string     `json:"id"`
	Status             string     `json:"status"`
	CampaignRevisionID string     `json:"campaign_revision_id"`
	ProcessingMode     string     `json:"processing_mode"`
	SubmittedAt        *time.Time `json:"submitted_at,omitempty"`
	LastActivityAt     time.Time  `json:"last_activity_at"`
	ContactEmail       string     `json:"contact_email,omitempty"`
	CurrentRevisionNo  int        `json:"current_revision_no"`
	InboxState         inboxState `json:"inbox_state"`
	Flags              entryFlags `json:"flags"`
}

type inboxState struct {
	IsRead    bool `json:"is_read"`
	IsStarred bool `json:"is_starred"`
}

type entryFlags struct {
	Anonymized       bool `json:"anonymized"`
	NeedsChanges     bool `json:"needs_changes"`
	ConversionFailed bool `json:"conversion_failed"`
}

type entryRevisionResponse struct {
	ID            string          `json:"id"`
	RevisionNo    int             `json:"revision_no"`
	SchemaVersion int             `json:"schema_version"`
	Answers       json.RawMessage `json:"answers"`
	Source        string          `json:"source"`
	CreatedAt     time.Time       `json:"created_at"`
}

type entryDecisionResponse struct {
	ID        string          `json:"id"`
	Type      string          `json:"type"`
	Reason    string          `json:"reason"`
	DecidedBy string          `json:"decided_by"`
	DecidedAt time.Time       `json:"decided_at"`
	Metadata  json.RawMessage `json:"metadata"`
}

var entryDecisionStatuses = map[string]string{
	"accept":   "accepted",
	"waitlist": "waitlisted",
	"reject":   "rejected",
}

var entryDecisionMutableStatuses = map[string]bool{
	"submitted":  true,
	"in_review":  true,
	"accepted":   true,
	"waitlisted": true,
	"rejected":   true,
}

var (
	errInvalidEntryDecisionType    = errors.New("invalid entry decision type")
	errEntryDecisionReasonRequired = errors.New("entry decision reason required")
)

func entryStatusForDecision(decisionType string) (string, bool) {
	status, ok := entryDecisionStatuses[strings.ToLower(strings.TrimSpace(decisionType))]
	return status, ok
}

func canChangeEntryDecision(status string) bool {
	return entryDecisionMutableStatuses[status]
}

func normalizeEntryDecision(input createEntryDecisionInput) (decisionType, status, reason string, err error) {
	decisionType = strings.ToLower(strings.TrimSpace(input.Type))
	status, ok := entryStatusForDecision(decisionType)
	if !ok {
		return "", "", "", errInvalidEntryDecisionType
	}
	reason = strings.TrimSpace(input.Reason)
	if decisionType == "reject" && reason == "" {
		return "", "", "", errEntryDecisionReasonRequired
	}
	return decisionType, status, reason, nil
}

type entryMaterializationResponse struct {
	ID             string     `json:"id"`
	DecisionID     string     `json:"decision_id"`
	TargetKind     string     `json:"target_kind"`
	Operation      string     `json:"operation"`
	Status         string     `json:"status"`
	IdempotencyKey string     `json:"idempotency_key"`
	TargetID       *string    `json:"target_id,omitempty"`
	ErrorCode      *string    `json:"error_code,omitempty"`
	ErrorMessage   *string    `json:"error_message,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	StartedAt      *time.Time `json:"started_at,omitempty"`
	CompletedAt    *time.Time `json:"completed_at,omitempty"`
}

type entryResponse struct {
	ID                 string     `json:"id"`
	WorkspaceID        string     `json:"workspace_id"`
	ProductionID       string     `json:"production_id"`
	CampaignID         string     `json:"campaign_id"`
	CampaignRevisionID string     `json:"campaign_revision_id"`
	ProcessingMode     string     `json:"processing_mode"`
	Status             string     `json:"status"`
	ContactEmail       string     `json:"contact_email,omitempty"`
	SubmittedAt        *time.Time `json:"submitted_at,omitempty"`
	LastActivityAt     time.Time  `json:"last_activity_at"`
	CurrentRevisionNo  int        `json:"current_revision_no"`
	Anonymized         bool       `json:"anonymized"`
	AnonymizedAt       *time.Time `json:"anonymized_at,omitempty"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
}

type entryDetailResponse struct {
	Entry            entryResponse                  `json:"entry"`
	FormVersion      *formVersionItem               `json:"form_version,omitempty"`
	CurrentRevision  *entryRevisionResponse         `json:"current_revision,omitempty"`
	Decision         *entryDecisionResponse         `json:"decision"`
	DecisionHistory  []entryDecisionResponse        `json:"decision_history"`
	Materializations []entryMaterializationResponse `json:"materializations"`
	InboxState       inboxState                     `json:"inbox_state"`
	CanDecide        bool                           `json:"can_decide"`
	CanManageReview  bool                           `json:"can_manage_review"`
	Review           any                            `json:"review"`
}

func parseEntryStatuses(r *http.Request) ([]string, error) {
	values := r.URL.Query()["status"]
	statuses := make([]string, 0)
	for _, value := range values {
		for _, status := range strings.Split(value, ",") {
			status = strings.TrimSpace(status)
			if status == "" {
				continue
			}
			if !entryStatuses[status] {
				return nil, fmt.Errorf("invalid status")
			}
			statuses = append(statuses, status)
		}
	}
	return statuses, nil
}

func parseOptionalBool(raw string) (*bool, error) {
	if raw == "" {
		return nil, nil
	}
	value, err := strconv.ParseBool(raw)
	return &value, err
}

func (app *application) listCampaignEntries(w http.ResponseWriter, r *http.Request) {
	campaignID := r.PathValue("campaignId")
	access, err := app.campaignAccessForID(r.Context(), claims(r).Subject, campaignID, campaignView)
	if err != nil {
		if errors.Is(err, errCampaignPermissionDenied) {
			errorJSON(w, http.StatusForbidden, "forbidden", "没有查看提交记录的权限")
		} else {
			errorJSON(w, http.StatusNotFound, "campaign_not_found", "表单不存在或无权访问")
		}
		return
	}
	statuses, err := parseEntryStatuses(r)
	if err != nil {
		errorJSON(w, http.StatusBadRequest, "invalid_status", "状态筛选无效")
		return
	}
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		limit, err = strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > 100 {
			errorJSON(w, http.StatusBadRequest, "invalid_limit", "limit 必须在 1 到 100 之间")
			return
		}
	}
	starred, err := parseOptionalBool(r.URL.Query().Get("is_starred"))
	if err != nil {
		errorJSON(w, http.StatusBadRequest, "invalid_filter", "is_starred 必须是布尔值")
		return
	}
	unread, err := parseOptionalBool(r.URL.Query().Get("is_unread"))
	if err != nil {
		errorJSON(w, http.StatusBadRequest, "invalid_filter", "is_unread 必须是布尔值")
		return
	}
	var from, to *time.Time
	for key, destination := range map[string]**time.Time{"submitted_from": &from, "submitted_to": &to} {
		if raw := r.URL.Query().Get(key); raw != "" {
			parsed, parseErr := time.Parse(time.RFC3339, raw)
			if parseErr != nil {
				errorJSON(w, http.StatusBadRequest, "invalid_filter", key+" 必须是 RFC3339 时间")
				return
			}
			*destination = &parsed
		}
	}
	fingerprint := entryInboxFilterFingerprint(r)
	var cursor *entryInboxCursor
	if raw := r.URL.Query().Get("cursor"); raw != "" {
		decoded, decodeErr := decodeEntryInboxCursor(raw, fingerprint)
		if decodeErr != nil {
			errorJSON(w, http.StatusBadRequest, "invalid_cursor", "分页游标无效或筛选条件已改变")
			return
		}
		cursor = &decoded
	}

	where := []string{"e.workspace_id=$1", "e.campaign_id=$2", "e.deleted_at IS NULL"}
	args := []any{access.WorkspaceID, campaignID}
	arg := 3
	if len(statuses) > 0 {
		placeholders := make([]string, len(statuses))
		for i, status := range statuses {
			placeholders[i] = "$" + strconv.Itoa(arg+i)
			args = append(args, status)
		}
		where = append(where, "e.status IN ("+strings.Join(placeholders, ",")+")")
		arg += len(statuses)
	}
	if q := strings.TrimSpace(r.URL.Query().Get("q")); q != "" {
		where = append(where, fmt.Sprintf("(e.id ILIKE $%d OR (CASE WHEN e.anonymized_at IS NULL THEN e.contact_email ELSE '' END) ILIKE $%d OR (CASE WHEN e.anonymized_at IS NULL THEN COALESCE(latest.answers::text,'') ELSE '' END) ILIKE $%d)", arg, arg, arg))
		args = append(args, "%"+q+"%")
		arg++
	}
	if starred != nil {
		if *starred {
			where = append(where, "state.starred_at IS NOT NULL")
		} else {
			where = append(where, "state.starred_at IS NULL")
		}
	}
	if unread != nil {
		if *unread {
			where = append(where, "state.read_at IS NULL")
		} else {
			where = append(where, "state.read_at IS NOT NULL")
		}
	}
	if from != nil {
		where = append(where, fmt.Sprintf("e.submitted_at >= $%d", arg))
		args = append(args, *from)
		arg++
	}
	if to != nil {
		where = append(where, fmt.Sprintf("e.submitted_at <= $%d", arg))
		args = append(args, *to)
		arg++
	}
	if cursor != nil {
		where = append(where, fmt.Sprintf("(COALESCE(e.submitted_at,e.created_at),e.id) < ($%d,$%d)", arg, arg+1))
		args = append(args, cursor.SortAt, cursor.ID)
		arg += 2
	}
	whereSQL := strings.Join(where, " AND ")
	query := `SELECT e.id,e.status,e.campaign_revision_id,COALESCE(cr.processing_mode,'MANUAL_DECISION'),e.submitted_at,e.last_activity_at,e.contact_email,
		(e.anonymized_at IS NOT NULL), (e.status='needs_changes'), (e.status='conversion_failed'),
		COALESCE(latest.revision_no,0), state.read_at IS NOT NULL, state.starred_at IS NOT NULL,
		COALESCE(e.submitted_at,e.created_at) AS sort_at
		FROM entries e
		LEFT JOIN campaign_revisions cr ON cr.workspace_id=e.workspace_id AND cr.id=e.campaign_revision_id
		LEFT JOIN entry_inbox_user_states state ON state.workspace_id=e.workspace_id AND state.entry_id=e.id AND state.user_id=$` + strconv.Itoa(arg) + `
		LEFT JOIN LATERAL (SELECT er.revision_no,er.answers FROM entry_revisions er WHERE er.workspace_id=e.workspace_id AND er.entry_id=e.id ORDER BY er.revision_no DESC LIMIT 1) latest ON TRUE
		WHERE ` + whereSQL + ` ORDER BY sort_at DESC,e.id DESC LIMIT $` + strconv.Itoa(arg+1)
	// State user and limit are appended after all filter arguments; the state join
	// intentionally does not affect tenant access because workspace_id is joined too.
	args = append(args, claims(r).Subject, limit+1)
	rows, err := app.db.Query(r.Context(), query, args...)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	items := make([]entryInboxItem, 0, limit)
	var lastCursor *entryInboxCursor
	for rows.Next() {
		var item entryInboxItem
		var anonymized, needsChanges, conversionFailed, isRead, isStarred bool
		var sortAt time.Time
		if err := rows.Scan(&item.ID, &item.Status, &item.CampaignRevisionID, &item.ProcessingMode, &item.SubmittedAt, &item.LastActivityAt, &item.ContactEmail, &anonymized, &needsChanges, &conversionFailed, &item.CurrentRevisionNo, &isRead, &isStarred, &sortAt); err != nil {
			serverError(w, err)
			return
		}
		item.InboxState = inboxState{IsRead: isRead, IsStarred: isStarred}
		item.Flags = entryFlags{Anonymized: anonymized, NeedsChanges: needsChanges, ConversionFailed: conversionFailed}
		if anonymized {
			item.ContactEmail = ""
		}
		if len(items) == limit {
			lastCursor = &entryInboxCursor{SortAt: sortAt, ID: item.ID, Fingerprint: fingerprint}
			break
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		serverError(w, err)
		return
	}
	var total int64
	// Build a count query without the cursor clause to avoid counting the page only.
	baseWhere := []string{"e.workspace_id=$1", "e.campaign_id=$2", "e.deleted_at IS NULL"}
	baseArgs := []any{access.WorkspaceID, campaignID}
	baseArg := 3
	if len(statuses) > 0 {
		p := make([]string, len(statuses))
		for i, s := range statuses {
			p[i] = "$" + strconv.Itoa(baseArg+i)
			baseArgs = append(baseArgs, s)
		}
		baseWhere = append(baseWhere, "e.status IN ("+strings.Join(p, ",")+")")
		baseArg += len(statuses)
	}
	if q := strings.TrimSpace(r.URL.Query().Get("q")); q != "" {
		baseWhere = append(baseWhere, fmt.Sprintf("(e.id ILIKE $%d OR (CASE WHEN e.anonymized_at IS NULL THEN e.contact_email ELSE '' END) ILIKE $%d OR (CASE WHEN e.anonymized_at IS NULL THEN COALESCE(latest.answers::text,'') ELSE '' END) ILIKE $%d)", baseArg, baseArg, baseArg))
		baseArgs = append(baseArgs, "%"+q+"%")
		baseArg++
	}
	if starred != nil {
		if *starred {
			baseWhere = append(baseWhere, "state.starred_at IS NOT NULL")
		} else {
			baseWhere = append(baseWhere, "state.starred_at IS NULL")
		}
	}
	if unread != nil {
		if *unread {
			baseWhere = append(baseWhere, "state.read_at IS NULL")
		} else {
			baseWhere = append(baseWhere, "state.read_at IS NOT NULL")
		}
	}
	if from != nil {
		baseWhere = append(baseWhere, fmt.Sprintf("e.submitted_at >= $%d", baseArg))
		baseArgs = append(baseArgs, *from)
		baseArg++
	}
	if to != nil {
		baseWhere = append(baseWhere, fmt.Sprintf("e.submitted_at <= $%d", baseArg))
		baseArgs = append(baseArgs, *to)
		baseArg++
	}
	countQuery := `SELECT count(*) FROM entries e LEFT JOIN entry_inbox_user_states state ON state.workspace_id=e.workspace_id AND state.entry_id=e.id AND state.user_id=$` + strconv.Itoa(baseArg) + ` LEFT JOIN LATERAL (SELECT er.answers FROM entry_revisions er WHERE er.workspace_id=e.workspace_id AND er.entry_id=e.id ORDER BY er.revision_no DESC LIMIT 1) latest ON TRUE WHERE ` + strings.Join(baseWhere, " AND ")
	baseArgs = append(baseArgs, claims(r).Subject)
	if err := app.db.QueryRow(r.Context(), countQuery, baseArgs...).Scan(&total); err != nil {
		serverError(w, err)
		return
	}
	summary := map[string]int64{"all": 0, "submitted": 0, "in_review": 0, "needs_changes": 0, "accepted": 0, "waitlisted": 0, "rejected": 0, "converted": 0, "conversion_failed": 0}
	summaryRows, err := app.db.Query(r.Context(), `SELECT status,count(*) FROM entries WHERE workspace_id=$1 AND campaign_id=$2 AND deleted_at IS NULL GROUP BY status`, access.WorkspaceID, campaignID)
	if err == nil {
		defer summaryRows.Close()
		for summaryRows.Next() {
			var status string
			var count int64
			if summaryRows.Scan(&status, &count) == nil {
				summary[status] = count
				summary["all"] += count
			}
		}
	}
	response := map[string]any{"items": items, "next_cursor": nil, "total": total, "summary": summary}
	if lastCursor != nil {
		response["next_cursor"] = encodeEntryInboxCursor(*lastCursor)
	}
	writeJSON(w, http.StatusOK, response)
}

func (app *application) getEntry(w http.ResponseWriter, r *http.Request) {
	entryID := r.PathValue("entryId")
	access, err := app.entryAccessForID(r.Context(), claims(r).Subject, entryID, campaignView)
	if err != nil {
		if errors.Is(err, errCampaignPermissionDenied) {
			errorJSON(w, http.StatusForbidden, "forbidden", "没有查看提交记录的权限")
		} else {
			errorJSON(w, http.StatusNotFound, "entry_not_found", "提交记录不存在或无权访问")
		}
		return
	}
	response, err := app.loadEntryResponseByID(r.Context(), access, entryID, claims(r).Subject)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			errorJSON(w, http.StatusNotFound, "entry_not_found", "提交记录不存在")
		} else {
			serverError(w, err)
		}
		return
	}
	// Opening a detail marks it read for this user, without changing Entry.
	read := true
	if _, err := app.upsertEntryInboxState(r.Context(), access.WorkspaceID, entryID, claims(r).Subject, &read, nil); err != nil {
		serverError(w, err)
		return
	}
	response.InboxState.IsRead = true
	writeJSON(w, http.StatusOK, response)
}

func (app *application) loadEntryResponseByID(ctx context.Context, access entryAccess, entryID, userID string) (entryDetailResponse, error) {
	var response entryDetailResponse
	var entry entryResponse
	var deletedAt *time.Time
	err := app.db.QueryRow(ctx, `SELECT e.id,e.workspace_id,e.production_id,e.campaign_id,e.campaign_revision_id,e.status,e.contact_email,e.submitted_at,e.last_activity_at,e.anonymized_at,e.created_at,e.updated_at,COALESCE(latest.revision_no,0),e.deleted_at FROM entries e LEFT JOIN LATERAL (SELECT er.revision_no FROM entry_revisions er WHERE er.workspace_id=e.workspace_id AND er.entry_id=e.id ORDER BY er.revision_no DESC LIMIT 1) latest ON TRUE WHERE e.id=$1 AND e.workspace_id=$2`, entryID, access.WorkspaceID).Scan(&entry.ID, &entry.WorkspaceID, &entry.ProductionID, &entry.CampaignID, &entry.CampaignRevisionID, &entry.Status, &entry.ContactEmail, &entry.SubmittedAt, &entry.LastActivityAt, &entry.AnonymizedAt, &entry.CreatedAt, &entry.UpdatedAt, &entry.CurrentRevisionNo, &deletedAt)
	if err != nil {
		return response, err
	}
	entry.Anonymized = entry.AnonymizedAt != nil
	if entry.Anonymized {
		entry.ContactEmail = ""
	}
	response.Entry = entry
	var readAt, starredAt *time.Time
	err = app.db.QueryRow(ctx, `SELECT read_at,starred_at FROM entry_inbox_user_states WHERE workspace_id=$1 AND entry_id=$2 AND user_id=$3`, access.WorkspaceID, entryID, userID).Scan(&readAt, &starredAt)
	if err == nil {
		response.InboxState = inboxState{IsRead: readAt != nil, IsStarred: starredAt != nil}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return response, err
	}
	revision, err := app.loadRevision(ctx, app.db, entry.CampaignRevisionID, access.WorkspaceID)
	if err != nil {
		return response, err
	}
	entry.ProcessingMode = revision.ProcessingMode
	response.CanDecide = access.Access.Permissions[campaignDecide] && entry.ProcessingMode != intakeCollectOnly
	response.CanManageReview = access.Access.Permissions[campaignManage] && entry.ProcessingMode != intakeCollectOnly
	response.Entry = entry
	response.FormVersion = revision.FormVersion
	var current entryRevisionResponse
	err = app.db.QueryRow(ctx, `SELECT id,revision_no,schema_version,answers,source,created_at FROM entry_revisions WHERE workspace_id=$1 AND entry_id=$2 ORDER BY revision_no DESC LIMIT 1`, access.WorkspaceID, entryID).Scan(&current.ID, &current.RevisionNo, &current.SchemaVersion, &current.Answers, &current.Source, &current.CreatedAt)
	if err == nil {
		if entry.Anonymized {
			current.Answers = json.RawMessage(`{}`)
		}
		response.CurrentRevision = &current
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return response, err
	}
	var decision entryDecisionResponse
	err = app.db.QueryRow(ctx, `SELECT id,type,reason,decided_by,decided_at,metadata FROM decisions WHERE workspace_id=$1 AND entry_id=$2 AND is_current=true`, access.WorkspaceID, entryID).Scan(&decision.ID, &decision.Type, &decision.Reason, &decision.DecidedBy, &decision.DecidedAt, &decision.Metadata)
	if err == nil {
		response.Decision = &decision
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return response, err
	}
	decisionRows, err := app.db.Query(ctx, `SELECT id,type,reason,decided_by,decided_at,metadata FROM decisions WHERE workspace_id=$1 AND entry_id=$2 ORDER BY decided_at DESC,id DESC`, access.WorkspaceID, entryID)
	if err != nil {
		return response, err
	}
	defer decisionRows.Close()
	response.DecisionHistory = []entryDecisionResponse{}
	for decisionRows.Next() {
		var item entryDecisionResponse
		if err := decisionRows.Scan(&item.ID, &item.Type, &item.Reason, &item.DecidedBy, &item.DecidedAt, &item.Metadata); err != nil {
			return response, err
		}
		response.DecisionHistory = append(response.DecisionHistory, item)
	}
	if err := decisionRows.Err(); err != nil {
		return response, err
	}
	rows, err := app.db.Query(ctx, `SELECT id,decision_id,target_kind,operation,status,idempotency_key,target_id,error_code,error_message,created_at,started_at,completed_at FROM entry_materializations WHERE workspace_id=$1 AND entry_id=$2 ORDER BY created_at DESC,id DESC`, access.WorkspaceID, entryID)
	if err != nil {
		return response, err
	}
	defer rows.Close()
	response.Materializations = []entryMaterializationResponse{}
	for rows.Next() {
		var item entryMaterializationResponse
		if err := rows.Scan(&item.ID, &item.DecisionID, &item.TargetKind, &item.Operation, &item.Status, &item.IdempotencyKey, &item.TargetID, &item.ErrorCode, &item.ErrorMessage, &item.CreatedAt, &item.StartedAt, &item.CompletedAt); err != nil {
			return response, err
		}
		response.Materializations = append(response.Materializations, item)
	}
	response.Review, err = loadReviewRunAdminResponse(ctx, app.db, access.WorkspaceID, entryID)
	if err != nil {
		return response, err
	}
	return response, rows.Err()
}

func (app *application) listEntryRevisions(w http.ResponseWriter, r *http.Request) {
	entryID := r.PathValue("entryId")
	access, err := app.entryAccessForID(r.Context(), claims(r).Subject, entryID, campaignView)
	if err != nil {
		errorJSON(w, http.StatusNotFound, "entry_not_found", "提交记录不存在或无权访问")
		return
	}
	var anonymized bool
	if err := app.db.QueryRow(r.Context(), `SELECT anonymized_at IS NOT NULL FROM entries WHERE id=$1 AND workspace_id=$2`, entryID, access.WorkspaceID).Scan(&anonymized); err != nil {
		serverError(w, err)
		return
	}
	rows, err := app.db.Query(r.Context(), `SELECT id,revision_no,schema_version,answers,source,created_at FROM entry_revisions WHERE workspace_id=$1 AND entry_id=$2 ORDER BY revision_no ASC`, access.WorkspaceID, entryID)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	items := make([]entryRevisionResponse, 0)
	for rows.Next() {
		var item entryRevisionResponse
		if err := rows.Scan(&item.ID, &item.RevisionNo, &item.SchemaVersion, &item.Answers, &item.Source, &item.CreatedAt); err != nil {
			serverError(w, err)
			return
		}
		if anonymized {
			item.Answers = json.RawMessage(`{}`)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "next_cursor": nil, "total": len(items)})
}

type createEntryDecisionInput struct {
	Type           string `json:"type"`
	Reason         string `json:"reason"`
	LegacyOverride bool   `json:"legacy_override"`
}

func (app *application) createEntryDecision(w http.ResponseWriter, r *http.Request) {
	entryID := r.PathValue("entryId")
	access, err := app.entryAccessForID(r.Context(), claims(r).Subject, entryID, campaignDecide)
	if err != nil {
		if errors.Is(err, errCampaignPermissionDenied) {
			errorJSON(w, http.StatusForbidden, "forbidden", "没有决定提交结果的权限")
		} else {
			errorJSON(w, http.StatusNotFound, "entry_not_found", "提交记录不存在或无权访问")
		}
		return
	}
	var input createEntryDecisionInput
	if !decodeJSON(w, r, &input) {
		return
	}
	decisionType, status, reason, err := normalizeEntryDecision(input)
	if errors.Is(err, errInvalidEntryDecisionType) {
		errorJSON(w, http.StatusBadRequest, "invalid_decision_type", "决定类型必须是接受、候补或拒绝")
		return
	}
	if errors.Is(err, errEntryDecisionReasonRequired) {
		errorJSON(w, http.StatusUnprocessableEntity, "decision_reason_required", "拒绝提交时必须填写原因")
		return
	}
	if input.LegacyOverride && reason == "" {
		errorJSON(w, http.StatusUnprocessableEntity, "legacy_decision_reason_required", "遗留流程覆盖必须填写处理原因")
		return
	}

	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var availabilityRaw json.RawMessage
	if err := tx.QueryRow(r.Context(), `SELECT COALESCE(cr.availability_policy,'{}'::jsonb) FROM campaigns c LEFT JOIN campaign_revisions cr ON cr.workspace_id=c.workspace_id AND cr.id=c.published_revision_id WHERE c.id=$1 AND c.workspace_id=$2 FOR UPDATE OF c`, access.CampaignID, access.WorkspaceID).Scan(&availabilityRaw); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			errorJSON(w, http.StatusNotFound, "campaign_not_found", "活动不存在")
		} else {
			serverError(w, err)
		}
		return
	}
	var availability map[string]any
	if err := json.Unmarshal(availabilityRaw, &availability); err != nil {
		serverError(w, err)
		return
	}
	var currentStatus string
	var deletedAt *time.Time
	var currentDecisionID *string
	var processingMode string
	if err := tx.QueryRow(r.Context(), `SELECT e.status,e.deleted_at,e.current_decision_id,cr.processing_mode FROM entries e JOIN campaign_revisions cr ON cr.workspace_id=e.workspace_id AND cr.id=e.campaign_revision_id WHERE e.id=$1 AND e.workspace_id=$2 FOR UPDATE OF e`, entryID, access.WorkspaceID).Scan(&currentStatus, &deletedAt, &currentDecisionID, &processingMode); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			errorJSON(w, http.StatusNotFound, "entry_not_found", "提交记录不存在")
		} else {
			serverError(w, err)
		}
		return
	}
	if processingMode == intakeCollectOnly {
		errorJSON(w, http.StatusConflict, "decision_not_applicable", "该提交采用仅收集方式，不支持人工决定或遗留覆盖")
		return
	}
	if deletedAt != nil || (!canChangeEntryDecision(currentStatus) && !(currentStatus == "needs_changes" && input.LegacyOverride)) {
		errorJSON(w, http.StatusConflict, "entry_decision_not_allowed", "当前提交状态不能作出或修正决定")
		return
	}
	var runID, runStatus string
	runErr := tx.QueryRow(r.Context(), `SELECT id,status FROM entry_review_runs WHERE workspace_id=$1 AND entry_id=$2 FOR UPDATE`, access.WorkspaceID, entryID).Scan(&runID, &runStatus)
	legacyOverride := false
	if errors.Is(runErr, pgx.ErrNoRows) {
		if !input.LegacyOverride {
			errorJSON(w, http.StatusConflict, "review_run_required", "该提交没有可完成的审核运行；如需处理存量流程，请使用遗留流程覆盖并填写原因")
			return
		}
		legacyOverride = true
	} else if runErr != nil {
		serverError(w, runErr)
		return
	} else {
		switch runStatus {
		case "blocked_unsupported":
			if !input.LegacyOverride {
				errorJSON(w, http.StatusConflict, "legacy_override_required", "此存量审核配置不兼容；需使用遗留流程覆盖并填写原因")
				return
			}
			legacyOverride = true
		case "ready_for_decision", "decided", "legacy_override_decided":
			if input.LegacyOverride {
				errorJSON(w, http.StatusConflict, "legacy_override_not_applicable", "此审核运行不需要遗留流程覆盖")
				return
			}
			// A later Decision may supersede a prior one without rerunning review.
		default:
			if input.LegacyOverride {
				errorJSON(w, http.StatusConflict, "legacy_override_not_applicable", "当前审核配置可正常运行，不能使用遗留流程覆盖")
				return
			}
			if currentDecisionID == nil {
				errorJSON(w, http.StatusConflict, "review_quorum_not_met", "审核任务尚未达到最终决定门槛")
				return
			}
		}
	}
	if decisionType == "accept" {
		if limit := policyLimit(availability, "capacity"); limit > 0 {
			var count int64
			if err := tx.QueryRow(r.Context(), `SELECT COUNT(*) FROM entries WHERE workspace_id=$1 AND campaign_id=$2 AND id<>$3 AND deleted_at IS NULL AND status IN ('accepted','converted')`, access.WorkspaceID, access.CampaignID, entryID).Scan(&count); err != nil {
				serverError(w, err)
				return
			}
			if count >= limit {
				errorJSON(w, http.StatusConflict, "campaign_capacity_reached", "最终名额已满；如仍需保留此提交，请明确选择候补")
				return
			}
		}
	}
	if decisionType == "waitlist" {
		waitlistEnabled, _ := availability["waitlist_enabled"].(bool)
		if !waitlistEnabled {
			errorJSON(w, http.StatusConflict, "waitlist_disabled", "当前活动未启用候补")
			return
		}
		if limit := policyLimit(availability, "waitlist_limit"); limit > 0 {
			var count int64
			if err := tx.QueryRow(r.Context(), `SELECT COUNT(*) FROM entries WHERE workspace_id=$1 AND campaign_id=$2 AND id<>$3 AND deleted_at IS NULL AND status='waitlisted'`, access.WorkspaceID, access.CampaignID, entryID).Scan(&count); err != nil {
				serverError(w, err)
				return
			}
			if count >= limit {
				errorJSON(w, http.StatusConflict, "waitlist_limit_reached", "候补名额已满")
				return
			}
		}
	}

	var previousDecisionID *string
	var previousID string
	err = tx.QueryRow(r.Context(), `SELECT id FROM decisions WHERE workspace_id=$1 AND entry_id=$2 AND is_current=true FOR UPDATE`, access.WorkspaceID, entryID).Scan(&previousID)
	if err == nil {
		previousDecisionID = &previousID
		if _, err = tx.Exec(r.Context(), `UPDATE decisions SET is_current=false WHERE workspace_id=$1 AND id=$2 AND is_current=true`, access.WorkspaceID, previousID); err != nil {
			serverError(w, err)
			return
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		serverError(w, err)
		return
	}

	decision := entryDecisionResponse{ID: newID(), Type: decisionType, Reason: reason, DecidedBy: claims(r).Subject}
	metadata := json.RawMessage(`{}`)
	if legacyOverride {
		metadata = json.RawMessage(`{"legacy_override":true}`)
	}
	if err = tx.QueryRow(r.Context(), `INSERT INTO decisions(id,workspace_id,entry_id,campaign_id,type,reason,supersedes_id,decided_by,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING decided_at,metadata`, decision.ID, access.WorkspaceID, entryID, access.CampaignID, decision.Type, decision.Reason, previousDecisionID, decision.DecidedBy, metadata).Scan(&decision.DecidedAt, &decision.Metadata); err != nil {
		serverError(w, err)
		return
	}
	if _, err = tx.Exec(r.Context(), `UPDATE entries SET status=$1,current_decision_id=$2,last_activity_at=NOW(),updated_at=NOW() WHERE id=$3 AND workspace_id=$4 AND deleted_at IS NULL`, status, decision.ID, entryID, access.WorkspaceID); err != nil {
		serverError(w, err)
		return
	}
	if runID != "" {
		nextRunStatus := "decided"
		if legacyOverride {
			nextRunStatus = "legacy_override_decided"
		}
		if _, err = tx.Exec(r.Context(), `UPDATE entry_review_runs SET status=$1,decided_at=NOW(),updated_at=NOW() WHERE id=$2`, nextRunStatus, runID); err != nil {
			serverError(w, err)
			return
		}
		if _, err = tx.Exec(r.Context(), `UPDATE entry_review_tasks SET status='closed_by_decision',closed_at=NOW(),updated_at=NOW() WHERE workspace_id=$1 AND run_id=$2 AND status='pending'`, access.WorkspaceID, runID); err != nil {
			serverError(w, err)
			return
		}
	}
	if err = tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	updated, err := app.loadEntryResponseByID(r.Context(), access, entryID, claims(r).Subject)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entry": updated.Entry, "decision": decision})
}

type updateEntryInboxStateInput struct {
	IsRead    *bool `json:"is_read"`
	IsStarred *bool `json:"is_starred"`
}

func (app *application) upsertEntryInboxState(ctx context.Context, workspaceID, entryID, userID string, read *bool, starred *bool) (inboxState, error) {
	tx, err := app.db.Begin(ctx)
	if err != nil {
		return inboxState{}, err
	}
	defer tx.Rollback(ctx)
	var readAt, starredAt *time.Time
	err = tx.QueryRow(ctx, `
		INSERT INTO entry_inbox_user_states(id,workspace_id,entry_id,user_id,read_at,starred_at)
		VALUES($1,$2,$3,$4,CASE WHEN $5::boolean IS NULL THEN NULL WHEN $5 THEN NOW() ELSE NULL END,CASE WHEN $6::boolean IS NULL THEN NULL WHEN $6 THEN NOW() ELSE NULL END)
		ON CONFLICT(workspace_id,entry_id,user_id) DO UPDATE SET
			read_at=CASE WHEN $5::boolean IS NULL THEN entry_inbox_user_states.read_at WHEN $5 THEN NOW() ELSE NULL END,
			starred_at=CASE WHEN $6::boolean IS NULL THEN entry_inbox_user_states.starred_at WHEN $6 THEN NOW() ELSE NULL END,
			updated_at=NOW()
		RETURNING read_at,starred_at`, newID(), workspaceID, entryID, userID, read, starred).Scan(&readAt, &starredAt)
	if err != nil {
		return inboxState{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return inboxState{}, err
	}
	return inboxState{IsRead: readAt != nil, IsStarred: starredAt != nil}, nil
}

func (app *application) updateEntryInboxState(w http.ResponseWriter, r *http.Request) {
	entryID := r.PathValue("entryId")
	access, err := app.entryAccessForID(r.Context(), claims(r).Subject, entryID, campaignView)
	if err != nil {
		if errors.Is(err, errCampaignPermissionDenied) {
			errorJSON(w, http.StatusForbidden, "forbidden", "没有查看提交记录的权限")
		} else {
			errorJSON(w, http.StatusNotFound, "entry_not_found", "提交记录不存在或无权访问")
		}
		return
	}
	var input updateEntryInboxStateInput
	if !decodeJSON(w, r, &input) {
		return
	}
	if input.IsRead == nil && input.IsStarred == nil {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "至少提供一个整理状态")
		return
	}
	state, err := app.upsertEntryInboxState(r.Context(), access.WorkspaceID, entryID, claims(r).Subject, input.IsRead, input.IsStarred)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entry_id": entryID, "is_read": state.IsRead, "is_starred": state.IsStarred, "updated_at": time.Now()})
}
