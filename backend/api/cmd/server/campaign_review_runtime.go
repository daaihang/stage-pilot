package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type reviewRuntimeQueryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

type reviewRunResponse struct {
	ID                 string                    `json:"id"`
	Status             string                    `json:"status"`
	CompletionMode     string                    `json:"completion_mode"`
	RequiredCount      int                       `json:"required_count"`
	CompletedCount     int                       `json:"completed_count"`
	TaskCount          int                       `json:"task_count"`
	AssignedCount      int                       `json:"assigned_count"`
	CampaignRevisionID string                    `json:"campaign_revision_id"`
	EntryRevisionID    string                    `json:"entry_revision_id"`
	Source             string                    `json:"source"`
	Tasks              []reviewTaskAdminResponse `json:"tasks"`
}

type reviewTaskAdminResponse struct {
	ID          string                     `json:"id"`
	Status      string                     `json:"status"`
	CreatedAt   time.Time                  `json:"created_at"`
	Assignments []reviewAssignmentResponse `json:"assignments"`
	Feedback    []reviewFeedbackResponse   `json:"feedback"`
}

type reviewAssignmentResponse struct {
	ID         string     `json:"id"`
	ReviewerID string     `json:"reviewer_id"`
	Name       string     `json:"name"`
	Reason     string     `json:"reason"`
	Source     string     `json:"source"`
	AssignedBy *string    `json:"assigned_by,omitempty"`
	AssignedAt time.Time  `json:"assigned_at"`
	EndedAt    *time.Time `json:"ended_at,omitempty"`
	Current    bool       `json:"current"`
	Active     bool       `json:"active"`
}

type reviewFeedbackResponse struct {
	ID                 string    `json:"id"`
	TaskID             string    `json:"task_id"`
	ReviewerID         string    `json:"reviewer_id"`
	ReviewerName       string    `json:"reviewer_name"`
	Recommendation     string    `json:"recommendation"`
	Comment            string    `json:"comment"`
	SupersedesFeedback *string   `json:"supersedes_feedback_id,omitempty"`
	IsCurrent          bool      `json:"is_current"`
	CampaignRevisionID string    `json:"campaign_revision_id"`
	EntryRevisionID    string    `json:"entry_revision_id"`
	CreatedAt          time.Time `json:"created_at"`
}

type reviewTaskListItem struct {
	ID                 string    `json:"id"`
	EntryID            string    `json:"entry_id"`
	CampaignID         string    `json:"campaign_id"`
	CampaignName       string    `json:"campaign_name"`
	ProductionID       string    `json:"production_id"`
	ProductionName     string    `json:"production_name"`
	EntryStatus        string    `json:"entry_status"`
	TaskStatus         string    `json:"task_status"`
	RunStatus          string    `json:"run_status"`
	CompletedCount     int       `json:"completed_count"`
	RequiredCount      int       `json:"required_count"`
	CampaignRevisionID string    `json:"campaign_revision_id"`
	AssignedAt         time.Time `json:"assigned_at"`
}

type reviewTaskDetailResponse struct {
	Task            reviewTaskListItem       `json:"task"`
	FormVersion     *formVersionItem         `json:"form_version,omitempty"`
	EntryRevision   *entryRevisionResponse   `json:"entry_revision,omitempty"`
	FeedbackHistory []reviewFeedbackResponse `json:"feedback_history"`
	CurrentFeedback *reviewFeedbackResponse  `json:"current_feedback"`
	CanSubmit       bool                     `json:"can_submit"`
}

func validateSingleRoundReviewWorkflow(raw json.RawMessage) error {
	return validateSingleRoundReviewWorkflowWithUnboundReviewers(raw, false)
}

func validateReusableSingleRoundReviewWorkflow(raw json.RawMessage) error {
	return validateSingleRoundReviewWorkflowWithUnboundReviewers(raw, true)
}

func validateSingleRoundReviewWorkflowWithUnboundReviewers(raw json.RawMessage, allowUnboundReviewers bool) error {
	definition, _, err := parseReviewRecipeDefinition(raw, allowUnboundReviewers)
	if err != nil {
		return err
	}
	if definition.Mode != intakeSingleRoundDecision {
		return reviewRecipeError("single_round_manual_required", "当前仅支持单轮人工审核，请改用 MANUAL_DECISION")
	}
	if len(definition.Rounds) != 1 {
		return reviewRecipeError("single_round_required", "当前仅支持一个审核轮次")
	}
	round := definition.Rounds[0]
	if round.Execution != "parallel" {
		return reviewRecipeError("parallel_review_required", "单轮审核必须并行执行")
	}
	if definition.RequestChanges.Enabled {
		return reviewRecipeError("request_changes_unavailable", "补件流程尚未开放，请关闭补件后再发布")
	}
	if round.Feedback.Kind != "binary" || (round.Scorecard != nil && len(round.Scorecard.Criteria) > 0) {
		return reviewRecipeError("scored_review_unavailable", "当前仅支持文字审核反馈，不支持评分")
	}
	return nil
}

func reviewCompletion(round reviewRecipeRound, reviewerCount int) (mode string, required int) {
	switch round.Completion.Mode {
	case "all":
		return "all", max(reviewerCount, 1)
	case "any":
		return "at_least_n", 1
	default:
		if round.Completion.N != nil {
			return "at_least_n", *round.Completion.N
		}
		return "at_least_n", 1
	}
}

func resolveReviewers(ctx context.Context, queryer reviewRuntimeQueryer, workspaceID, productionID string, policy reviewRecipeReviewerPolicy) ([]string, error) {
	ids := make([]string, 0)
	var rows pgx.Rows
	var err error
	if policy.Source == "explicit_members" {
		rows, err = queryer.Query(ctx, `
			WITH configured AS (SELECT unnest($3::text[]) AS value), selected_users AS (
				SELECT c.value AS user_id FROM configured c JOIN workspace_memberships wm ON wm.workspace_id=$1 AND wm.status='active' AND wm.user_id=c.value
				UNION
				SELECT selected.user_id FROM configured c JOIN production_memberships selected
				  ON selected.production_id=$2 AND (selected.id=c.value OR selected.user_id=c.value)
			), current_users AS (
				SELECT DISTINCT ON (pm.user_id) pm.id,pm.user_id,pm.status,pm.starts_at,pm.expires_at
				FROM production_memberships pm JOIN selected_users su ON su.user_id=pm.user_id
				WHERE pm.production_id=$2 ORDER BY pm.user_id,pm.created_at DESC,pm.id DESC
			), candidates AS (
				SELECT wm.user_id
				FROM configured c JOIN workspace_memberships wm ON wm.workspace_id=$1 AND wm.status='active' AND wm.user_id=c.value
				UNION
				SELECT current_member.user_id FROM current_users current_member
				WHERE current_member.status='active'
				  AND (current_member.starts_at IS NULL OR current_member.starts_at<=NOW())
				  AND (current_member.expires_at IS NULL OR current_member.expires_at>NOW())
			)
			SELECT DISTINCT user_id FROM candidates ORDER BY user_id`, workspaceID, productionID, policy.MemberIDs)
	} else {
		rows, err = queryer.Query(ctx, `
			WITH current_members AS (
				SELECT DISTINCT ON (pm.user_id) pm.user_id,pm.role_key,pm.status,pm.starts_at,pm.expires_at
				FROM production_memberships pm WHERE pm.production_id=$2
				ORDER BY pm.user_id,pm.created_at DESC,pm.id DESC
			), candidates AS (
				SELECT user_id FROM current_members
				WHERE status='active' AND (starts_at IS NULL OR starts_at<=NOW())
				  AND (expires_at IS NULL OR expires_at>NOW()) AND role_key=ANY($3::text[])
				UNION
				SELECT wm.user_id FROM workspace_memberships wm
				WHERE wm.workspace_id=$1 AND wm.status='active' AND wm.role IN ('owner','admin')
				  AND 'producer'=ANY($3::text[])
			)
			SELECT DISTINCT user_id FROM candidates ORDER BY user_id`, workspaceID, productionID, policy.RoleKeys)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.Strings(ids)
	return ids, nil
}

func validateP1ReviewerThreshold(ctx context.Context, queryer reviewRuntimeQueryer, workspaceID, productionID string, definition reviewRecipeDefinition) error {
	if err := validateSingleRoundReviewWorkflow(json.RawMessage(mustJSON(definition))); err != nil {
		return err
	}
	ids, err := resolveReviewers(ctx, queryer, workspaceID, productionID, definition.Rounds[0].ReviewerPolicy)
	if err != nil {
		return err
	}
	_, required := reviewCompletion(definition.Rounds[0], len(ids))
	if len(ids) == 0 {
		return reviewRecipeError("reviewer_required", "单轮审核必须至少配置一位当前有效的审核人")
	}
	if required > len(ids) {
		return reviewRecipeError("reviewer_threshold_exceeds_members", "审核完成门槛不能高于当前可用审核人数")
	}
	return nil
}

func createEntryReviewRun(ctx context.Context, tx pgx.Tx, workspaceID, productionID, campaignRevisionID, entryID, entryRevisionID string, raw json.RawMessage) error {
	definition, normalized, err := parseReviewRecipeDefinition(raw, false)
	if err != nil {
		return err
	}
	if err := validateSingleRoundReviewWorkflow(normalized); err != nil {
		return err
	}
	reviewerIDs, err := resolveReviewers(ctx, tx, workspaceID, productionID, definition.Rounds[0].ReviewerPolicy)
	if err != nil {
		return err
	}
	mode, required := reviewCompletion(definition.Rounds[0], len(reviewerIDs))
	status := "collecting_feedback"
	if len(reviewerIDs) < required {
		status = "awaiting_assignment"
	}
	runID := newID()
	if _, err := tx.Exec(ctx, `INSERT INTO entry_review_runs(id,workspace_id,entry_id,campaign_revision_id,entry_revision_id,workflow_snapshot,completion_mode,required_count,status,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'submission')`, runID, workspaceID, entryID, campaignRevisionID, entryRevisionID, normalized, mode, required, status); err != nil {
		return err
	}
	for _, reviewerID := range reviewerIDs {
		taskID := newID()
		if _, err := tx.Exec(ctx, `INSERT INTO entry_review_tasks(id,workspace_id,run_id,entry_id) VALUES($1,$2,$3,$4)`, taskID, workspaceID, runID, entryID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO entry_review_task_assignments(id,workspace_id,run_id,task_id,reviewer_id,source) VALUES($1,$2,$3,$4,$5,'submission')`, newID(), workspaceID, runID, taskID, reviewerID); err != nil {
			return err
		}
	}
	return nil
}

func refreshReviewRunStatus(ctx context.Context, tx pgx.Tx, runID string) error {
	var mode, status string
	var required int
	if err := tx.QueryRow(ctx, `SELECT completion_mode,required_count,status FROM entry_review_runs WHERE id=$1 FOR UPDATE`, runID).Scan(&mode, &required, &status); err != nil {
		return err
	}
	if status == "decided" || status == "legacy_override_decided" || status == "blocked_unsupported" {
		return nil
	}
	var assigned, completed int
	if err := tx.QueryRow(ctx, `SELECT
		COUNT(DISTINCT t.id) FILTER (WHERE a.id IS NOT NULL AND (
			EXISTS(SELECT 1 FROM workspace_memberships wm WHERE wm.workspace_id=t.workspace_id AND wm.user_id=a.reviewer_id AND wm.status='active')
			OR EXISTS(SELECT 1 FROM (
				SELECT pm.status,pm.starts_at,pm.expires_at FROM production_memberships pm
				WHERE pm.production_id=e.production_id AND pm.user_id=a.reviewer_id
				ORDER BY pm.created_at DESC,pm.id DESC LIMIT 1
			) current_member WHERE current_member.status='active'
				AND (current_member.starts_at IS NULL OR current_member.starts_at<=NOW())
				AND (current_member.expires_at IS NULL OR current_member.expires_at>NOW())
			))),
		COUNT(DISTINCT t.id) FILTER (WHERE t.status='submitted')
		FROM entry_review_tasks t JOIN entries e ON e.workspace_id=t.workspace_id AND e.id=t.entry_id
		LEFT JOIN entry_review_task_assignments a ON a.workspace_id=t.workspace_id AND a.task_id=t.id AND a.ended_at IS NULL
		WHERE t.run_id=$1`, runID).Scan(&assigned, &completed); err != nil {
		return err
	}
	next := "collecting_feedback"
	if completed >= required {
		next = "ready_for_decision"
	} else if assigned < required {
		next = "awaiting_assignment"
	}
	_, err := tx.Exec(ctx, `UPDATE entry_review_runs SET status=$1,updated_at=NOW() WHERE id=$2`, next, runID)
	return err
}

func currentMemberOfProduction(ctx context.Context, queryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, workspaceID, productionID, userID string) (bool, error) {
	var active bool
	err := queryer.QueryRow(ctx, `SELECT EXISTS(
		SELECT 1 FROM workspace_memberships WHERE workspace_id=$1 AND user_id=$3 AND status='active'
		UNION ALL
		SELECT 1 FROM (
			SELECT pm.status,pm.starts_at,pm.expires_at FROM production_memberships pm
			WHERE pm.production_id=$2 AND pm.user_id=$3 ORDER BY pm.created_at DESC,pm.id DESC LIMIT 1
		) current_member WHERE current_member.status='active'
			AND (current_member.starts_at IS NULL OR current_member.starts_at<=NOW())
			AND (current_member.expires_at IS NULL OR current_member.expires_at>NOW())
	)`, workspaceID, productionID, userID).Scan(&active)
	return active, err
}

var errReviewTaskUnavailable = errors.New("review task unavailable")
var errReviewFeedbackClosed = errors.New("review feedback is closed")
var errReviewFeedbackInvalid = errors.New("review feedback is invalid")
var errReviewQuorumNotMet = errors.New("review quorum not met")

func normalizeReviewFeedback(recommendation, comment string) (string, string, error) {
	recommendation = strings.TrimSpace(recommendation)
	comment = strings.TrimSpace(comment)
	if recommendation != "recommend" && recommendation != "do_not_recommend" && recommendation != "no_opinion" {
		return "", "", errReviewFeedbackInvalid
	}
	if comment == "" || len([]rune(comment)) > 5000 {
		return "", "", errReviewFeedbackInvalid
	}
	return recommendation, comment, nil
}

func reviewError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errReviewTaskUnavailable):
		errorJSON(w, http.StatusNotFound, "review_task_not_found", "审核任务不存在或当前账号无权处理")
	case errors.Is(err, errReviewFeedbackClosed):
		errorJSON(w, http.StatusConflict, "review_feedback_closed", "最终决定已提交，审核意见已关闭")
	case errors.Is(err, errReviewFeedbackInvalid):
		errorJSON(w, http.StatusUnprocessableEntity, "invalid_review_feedback", "请选择审核建议并填写 1 至 5000 字的意见")
	case errors.Is(err, errReviewQuorumNotMet):
		errorJSON(w, http.StatusConflict, "review_quorum_not_met", "审核任务尚未达到最终决定门槛")
	default:
		serverError(w, fmt.Errorf("review operation: %w", err))
	}
}

func effectiveReviewPermission(access productionAccess, permission string) bool {
	return access.Permissions[permission]
}

func listStringsEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func loadReviewRunAdminResponse(ctx context.Context, queryer reviewRuntimeQueryer, workspaceID, entryID string) (*reviewRunResponse, error) {
	var response reviewRunResponse
	err := queryer.QueryRow(ctx, `SELECT id,status,completion_mode,required_count,campaign_revision_id,entry_revision_id,source FROM entry_review_runs WHERE workspace_id=$1 AND entry_id=$2`, workspaceID, entryID).Scan(&response.ID, &response.Status, &response.CompletionMode, &response.RequiredCount, &response.CampaignRevisionID, &response.EntryRevisionID, &response.Source)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	response.Tasks = make([]reviewTaskAdminResponse, 0)
	rows, err := queryer.Query(ctx, `SELECT id,status,created_at FROM entry_review_tasks WHERE workspace_id=$1 AND run_id=$2 ORDER BY created_at,id`, workspaceID, response.ID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var task reviewTaskAdminResponse
		if err := rows.Scan(&task.ID, &task.Status, &task.CreatedAt); err != nil {
			rows.Close()
			return nil, err
		}
		task.Assignments, err = loadReviewAssignments(ctx, queryer, workspaceID, response.ID, task.ID)
		if err != nil {
			rows.Close()
			return nil, err
		}
		task.Feedback, err = loadReviewFeedbackHistory(ctx, queryer, workspaceID, task.ID)
		if err != nil {
			rows.Close()
			return nil, err
		}
		for _, feedback := range task.Feedback {
			if feedback.IsCurrent {
				response.CompletedCount++
				break
			}
		}
		for _, assignment := range task.Assignments {
			if assignment.Current && assignment.Active {
				response.AssignedCount++
				break
			}
		}
		response.Tasks = append(response.Tasks, task)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	response.TaskCount = len(response.Tasks)
	if response.Status != "decided" && response.Status != "legacy_override_decided" && response.Status != "blocked_unsupported" && response.CompletedCount < response.RequiredCount && response.AssignedCount < response.RequiredCount {
		response.Status = "awaiting_assignment"
	}
	return &response, nil
}

func loadReviewAssignments(ctx context.Context, queryer reviewRuntimeQueryer, workspaceID, runID, taskID string) ([]reviewAssignmentResponse, error) {
	rows, err := queryer.Query(ctx, `SELECT a.id,a.reviewer_id,COALESCE(u.display_name,''),a.reason,a.source,a.assigned_by,a.assigned_at,a.ended_at,(a.ended_at IS NULL),
		EXISTS(
			SELECT 1 FROM workspace_memberships wm WHERE wm.workspace_id=a.workspace_id AND wm.user_id=a.reviewer_id AND wm.status='active'
			UNION ALL
			SELECT 1 FROM (
				SELECT pm.status,pm.starts_at,pm.expires_at FROM production_memberships pm
				WHERE pm.production_id=e.production_id AND pm.user_id=a.reviewer_id
				ORDER BY pm.created_at DESC,pm.id DESC LIMIT 1
			) current_member WHERE current_member.status='active'
				AND (current_member.starts_at IS NULL OR current_member.starts_at<=NOW())
				AND (current_member.expires_at IS NULL OR current_member.expires_at>NOW())
		)
		FROM entry_review_task_assignments a JOIN users u ON u.id=a.reviewer_id
		JOIN entry_review_tasks t ON t.workspace_id=a.workspace_id AND t.id=a.task_id
		JOIN entries e ON e.workspace_id=t.workspace_id AND e.id=t.entry_id
		WHERE a.workspace_id=$1 AND a.run_id=$2 AND a.task_id=$3 ORDER BY a.assigned_at DESC,a.id DESC`, workspaceID, runID, taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]reviewAssignmentResponse, 0)
	for rows.Next() {
		var item reviewAssignmentResponse
		if err := rows.Scan(&item.ID, &item.ReviewerID, &item.Name, &item.Reason, &item.Source, &item.AssignedBy, &item.AssignedAt, &item.EndedAt, &item.Current, &item.Active); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func loadReviewFeedbackHistory(ctx context.Context, queryer reviewRuntimeQueryer, workspaceID, taskID string) ([]reviewFeedbackResponse, error) {
	rows, err := queryer.Query(ctx, `SELECT f.id,f.task_id,f.reviewer_id,COALESCE(u.display_name,''),f.recommendation,f.comment,f.supersedes_id,f.is_current,f.campaign_revision_id,f.entry_revision_id,f.created_at
		FROM entry_review_feedback f JOIN users u ON u.id=f.reviewer_id
		WHERE f.workspace_id=$1 AND f.task_id=$2 ORDER BY f.created_at DESC,f.id DESC`, workspaceID, taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]reviewFeedbackResponse, 0)
	for rows.Next() {
		var item reviewFeedbackResponse
		if err := rows.Scan(&item.ID, &item.TaskID, &item.ReviewerID, &item.ReviewerName, &item.Recommendation, &item.Comment, &item.SupersedesFeedback, &item.IsCurrent, &item.CampaignRevisionID, &item.EntryRevisionID, &item.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func reviewTaskListSQL(statusFilter string) (string, []any) {
	condition := ""
	switch statusFilter {
	case "pending":
		condition = " AND t.status='pending' AND r.status NOT IN ('decided','legacy_override_decided')"
	case "completed":
		condition = " AND t.status IN ('submitted','closed_by_decision')"
	case "all", "":
	default:
		condition = " AND false"
	}
	return `SELECT t.id,t.entry_id,e.campaign_id,c.name,e.production_id,p.name,e.status,t.status,r.status,
		(SELECT COUNT(*) FROM entry_review_tasks done JOIN entry_review_feedback f ON f.workspace_id=done.workspace_id AND f.task_id=done.id AND f.is_current WHERE done.run_id=r.id),
		r.required_count,r.campaign_revision_id,a.assigned_at
		FROM entry_review_task_assignments a
		JOIN entry_review_tasks t ON t.workspace_id=a.workspace_id AND t.id=a.task_id
		JOIN entry_review_runs r ON r.workspace_id=t.workspace_id AND r.id=t.run_id
		JOIN entries e ON e.workspace_id=t.workspace_id AND e.id=t.entry_id
		JOIN campaigns c ON c.workspace_id=e.workspace_id AND c.id=e.campaign_id
		JOIN productions p ON p.workspace_id=e.workspace_id AND p.id=e.production_id
		WHERE a.reviewer_id=$1 AND a.ended_at IS NULL AND e.deleted_at IS NULL
		AND (EXISTS(SELECT 1 FROM workspace_memberships wm WHERE wm.workspace_id=e.workspace_id AND wm.user_id=$1 AND wm.status='active')
		 OR EXISTS(SELECT 1 FROM production_memberships pm WHERE pm.production_id=e.production_id AND pm.user_id=$1 AND pm.status='active'
		   AND (pm.starts_at IS NULL OR pm.starts_at<=NOW()) AND (pm.expires_at IS NULL OR pm.expires_at>NOW())
		   AND NOT EXISTS(SELECT 1 FROM production_memberships later WHERE later.production_id=pm.production_id AND later.user_id=pm.user_id AND (later.created_at,later.id)>(pm.created_at,pm.id))))` + condition + ` ORDER BY a.assigned_at DESC,t.id`, nil
}

func (app *application) listMyReviewTasks(w http.ResponseWriter, r *http.Request) {
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	if status != "" && status != "pending" && status != "completed" && status != "all" {
		errorJSON(w, http.StatusBadRequest, "invalid_review_task_filter", "审核任务筛选无效")
		return
	}
	query, _ := reviewTaskListSQL(status)
	rows, err := app.db.Query(r.Context(), query, claims(r).Subject)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	items := make([]reviewTaskListItem, 0)
	for rows.Next() {
		var item reviewTaskListItem
		if err := rows.Scan(&item.ID, &item.EntryID, &item.CampaignID, &item.CampaignName, &item.ProductionID, &item.ProductionName, &item.EntryStatus, &item.TaskStatus, &item.RunStatus, &item.CompletedCount, &item.RequiredCount, &item.CampaignRevisionID, &item.AssignedAt); err != nil {
			serverError(w, err)
			return
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "next_cursor": nil, "total": len(items)})
}

func (app *application) reviewTaskAccess(ctx context.Context, taskID, userID string) (entryAccess, string, error) {
	var entryID string
	if err := app.db.QueryRow(ctx, `SELECT entry_id FROM entry_review_tasks WHERE id=$1`, taskID).Scan(&entryID); err != nil {
		return entryAccess{}, "", errReviewTaskUnavailable
	}
	access, err := app.entryAccessForID(ctx, userID, entryID, campaignReview)
	if err != nil {
		return entryAccess{}, "", errReviewTaskUnavailable
	}
	var assigned, runID string
	err = app.db.QueryRow(ctx, `SELECT a.reviewer_id,t.run_id FROM entry_review_task_assignments a JOIN entry_review_tasks t ON t.workspace_id=a.workspace_id AND t.id=a.task_id
		WHERE t.id=$1 AND a.ended_at IS NULL`, taskID).Scan(&assigned, &runID)
	if err != nil || assigned != userID {
		return entryAccess{}, "", errReviewTaskUnavailable
	}
	active, err := currentMemberOfProduction(ctx, app.db, access.WorkspaceID, access.ProductionID, userID)
	if err != nil || !active {
		return entryAccess{}, "", errReviewTaskUnavailable
	}
	return access, runID, nil
}

func (app *application) getReviewTask(w http.ResponseWriter, r *http.Request) {
	taskID, userID := r.PathValue("taskId"), claims(r).Subject
	access, _, err := app.reviewTaskAccess(r.Context(), taskID, userID)
	if err != nil {
		reviewError(w, err)
		return
	}
	var result reviewTaskDetailResponse
	var runID, entryID, campaignID string
	var anonymous bool
	err = app.db.QueryRow(r.Context(), `SELECT t.id,t.entry_id,e.campaign_id,c.name,e.production_id,p.name,e.status,t.status,r.status,
		(SELECT COUNT(*) FROM entry_review_tasks done JOIN entry_review_feedback f ON f.workspace_id=done.workspace_id AND f.task_id=done.id AND f.is_current WHERE done.run_id=r.id),
		r.required_count,r.campaign_revision_id,a.assigned_at,r.id,e.anonymized_at IS NOT NULL
		FROM entry_review_tasks t JOIN entry_review_task_assignments a ON a.workspace_id=t.workspace_id AND a.task_id=t.id AND a.ended_at IS NULL
		JOIN entry_review_runs r ON r.workspace_id=t.workspace_id AND r.id=t.run_id
		JOIN entries e ON e.workspace_id=t.workspace_id AND e.id=t.entry_id JOIN campaigns c ON c.workspace_id=e.workspace_id AND c.id=e.campaign_id
		JOIN productions p ON p.workspace_id=e.workspace_id AND p.id=e.production_id
		WHERE t.id=$1 AND a.reviewer_id=$2 AND e.workspace_id=$3`, taskID, userID, access.WorkspaceID).Scan(
		&result.Task.ID, &entryID, &campaignID, &result.Task.CampaignName, &result.Task.ProductionID, &result.Task.ProductionName, &result.Task.EntryStatus, &result.Task.TaskStatus, &result.Task.RunStatus, &result.Task.CompletedCount, &result.Task.RequiredCount, &result.Task.CampaignRevisionID, &result.Task.AssignedAt, &runID, &anonymous)
	if err != nil {
		reviewError(w, errReviewTaskUnavailable)
		return
	}
	result.Task.EntryID, result.Task.CampaignID = entryID, campaignID
	var revision entryRevisionResponse
	if err := app.db.QueryRow(r.Context(), `SELECT id,revision_no,schema_version,answers,source,created_at FROM entry_revisions WHERE workspace_id=$1 AND entry_id=$2 AND id=(SELECT entry_revision_id FROM entry_review_runs WHERE id=$3)`, access.WorkspaceID, entryID, runID).Scan(&revision.ID, &revision.RevisionNo, &revision.SchemaVersion, &revision.Answers, &revision.Source, &revision.CreatedAt); err == nil {
		if anonymous {
			revision.Answers = json.RawMessage(`{}`)
		}
		result.EntryRevision = &revision
	} else if !errors.Is(err, pgx.ErrNoRows) {
		serverError(w, err)
		return
	}
	campaignRevision, err := app.loadRevision(r.Context(), app.db, result.Task.CampaignRevisionID, access.WorkspaceID)
	if err != nil {
		serverError(w, err)
		return
	}
	result.FormVersion = campaignRevision.FormVersion
	result.FeedbackHistory, err = loadReviewFeedbackHistory(r.Context(), app.db, access.WorkspaceID, taskID)
	if err != nil {
		serverError(w, err)
		return
	}
	for i := range result.FeedbackHistory {
		if result.FeedbackHistory[i].IsCurrent {
			result.CurrentFeedback = &result.FeedbackHistory[i]
			break
		}
	}
	result.CanSubmit = result.Task.TaskStatus != "closed_by_decision" && result.Task.RunStatus != "decided" && result.Task.RunStatus != "legacy_override_decided" && result.Task.RunStatus != "blocked_unsupported"
	writeJSON(w, http.StatusOK, result)
}

type createReviewFeedbackInput struct {
	Recommendation     string `json:"recommendation"`
	Comment            string `json:"comment"`
	SupersedesFeedback string `json:"supersedes_feedback_id"`
}

func (app *application) createReviewTaskFeedback(w http.ResponseWriter, r *http.Request) {
	taskID, userID := r.PathValue("taskId"), claims(r).Subject
	access, runID, err := app.reviewTaskAccess(r.Context(), taskID, userID)
	if err != nil {
		reviewError(w, err)
		return
	}
	var input createReviewFeedbackInput
	if !decodeJSON(w, r, &input) {
		return
	}
	recommendation, comment, err := normalizeReviewFeedback(input.Recommendation, input.Comment)
	if err != nil {
		reviewError(w, err)
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var runStatus, campaignRevisionID, entryRevisionID string
	if err := tx.QueryRow(r.Context(), `SELECT status,campaign_revision_id,entry_revision_id FROM entry_review_runs WHERE id=$1 AND workspace_id=$2 FOR UPDATE`, runID, access.WorkspaceID).Scan(&runStatus, &campaignRevisionID, &entryRevisionID); err != nil {
		reviewError(w, errReviewTaskUnavailable)
		return
	}
	if runStatus == "decided" || runStatus == "legacy_override_decided" || runStatus == "blocked_unsupported" {
		reviewError(w, errReviewFeedbackClosed)
		return
	}
	var taskStatus, currentAssignmentID, currentFeedbackID string
	err = tx.QueryRow(r.Context(), `SELECT t.status,a.id,COALESCE((SELECT f.id FROM entry_review_feedback f WHERE f.workspace_id=t.workspace_id AND f.task_id=t.id AND f.is_current), '')
		FROM entry_review_tasks t JOIN entry_review_task_assignments a ON a.workspace_id=t.workspace_id AND a.task_id=t.id AND a.ended_at IS NULL
		WHERE t.id=$1 AND t.run_id=$2 AND a.reviewer_id=$3 FOR UPDATE OF t,a`, taskID, runID, userID).Scan(&taskStatus, &currentAssignmentID, &currentFeedbackID)
	if err != nil || taskStatus == "closed_by_decision" {
		reviewError(w, errReviewTaskUnavailable)
		return
	}
	active, err := currentMemberOfProduction(r.Context(), tx, access.WorkspaceID, access.ProductionID, userID)
	if err != nil || !active {
		reviewError(w, errReviewTaskUnavailable)
		return
	}
	if currentFeedbackID != "" {
		if strings.TrimSpace(input.SupersedesFeedback) != currentFeedbackID {
			errorJSON(w, http.StatusConflict, "review_feedback_revision_conflict", "当前审核意见已变化，请重新加载后再修订")
			return
		}
		if _, err := tx.Exec(r.Context(), `UPDATE entry_review_feedback SET is_current=false WHERE workspace_id=$1 AND task_id=$2 AND id=$3 AND is_current`, access.WorkspaceID, taskID, currentFeedbackID); err != nil {
			serverError(w, err)
			return
		}
	} else if strings.TrimSpace(input.SupersedesFeedback) != "" {
		errorJSON(w, http.StatusConflict, "review_feedback_revision_conflict", "当前没有可修订的审核意见，请重新加载任务")
		return
	}
	feedback := reviewFeedbackResponse{ID: newID(), TaskID: taskID, ReviewerID: userID, Recommendation: recommendation, Comment: comment, IsCurrent: true, CampaignRevisionID: campaignRevisionID, EntryRevisionID: entryRevisionID}
	var supersedes *string
	if currentFeedbackID != "" {
		supersedes = &currentFeedbackID
	}
	if err := tx.QueryRow(r.Context(), `INSERT INTO entry_review_feedback(id,workspace_id,run_id,task_id,assignment_id,reviewer_id,campaign_revision_id,entry_revision_id,recommendation,comment,supersedes_id)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING created_at`, feedback.ID, access.WorkspaceID, runID, taskID, currentAssignmentID, userID, campaignRevisionID, entryRevisionID, recommendation, comment, supersedes).Scan(&feedback.CreatedAt); err != nil {
		serverError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `UPDATE entry_review_tasks SET status='submitted',updated_at=NOW() WHERE workspace_id=$1 AND id=$2`, access.WorkspaceID, taskID); err != nil {
		serverError(w, err)
		return
	}
	if err := refreshReviewRunStatus(r.Context(), tx, runID); err != nil {
		serverError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, feedback)
}

type assignReviewTaskInput struct {
	TaskID     string `json:"task_id"`
	ReviewerID string `json:"reviewer_id"`
	Reason     string `json:"reason"`
}

func (app *application) assignEntryReviewTask(w http.ResponseWriter, r *http.Request) {
	entryID, userID := r.PathValue("entryId"), claims(r).Subject
	access, err := app.entryAccessForID(r.Context(), userID, entryID, campaignManage)
	if err != nil {
		if errors.Is(err, errCampaignPermissionDenied) {
			errorJSON(w, http.StatusForbidden, "forbidden", "没有管理审核分配的权限")
		} else {
			errorJSON(w, http.StatusNotFound, "entry_not_found", "提交记录不存在或无权访问")
		}
		return
	}
	var input assignReviewTaskInput
	if !decodeJSON(w, r, &input) {
		return
	}
	input.TaskID, input.ReviewerID, input.Reason = strings.TrimSpace(input.TaskID), strings.TrimSpace(input.ReviewerID), strings.TrimSpace(input.Reason)
	if input.ReviewerID == "" || input.Reason == "" || len([]rune(input.Reason)) > 1000 {
		errorJSON(w, http.StatusUnprocessableEntity, "review_assignment_reason_required", "必须选择有效审核人并填写不超过 1000 字的改派原因")
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var processingMode string
	if err := tx.QueryRow(r.Context(), `SELECT processing_mode FROM campaign_revisions WHERE workspace_id=$1 AND id=$2`, access.WorkspaceID, access.CampaignRevisionID).Scan(&processingMode); err != nil {
		serverError(w, err)
		return
	}
	if processingMode != intakeSingleRoundDecision {
		errorJSON(w, http.StatusConflict, "review_not_applicable", "该提交的处理方式不创建审核任务或审核人分配")
		return
	}
	var runID, runStatus, mode string
	var required int
	if err := tx.QueryRow(r.Context(), `SELECT id,status,completion_mode,required_count FROM entry_review_runs WHERE workspace_id=$1 AND entry_id=$2 FOR UPDATE`, access.WorkspaceID, entryID).Scan(&runID, &runStatus, &mode, &required); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			errorJSON(w, http.StatusConflict, "review_run_not_found", "该提交没有可管理的审核运行")
		} else {
			serverError(w, err)
		}
		return
	}
	if runStatus == "blocked_unsupported" || runStatus == "decided" || runStatus == "legacy_override_decided" {
		errorJSON(w, http.StatusConflict, "review_assignment_closed", "当前审核运行不接受新的分配")
		return
	}
	active, err := currentMemberOfProduction(r.Context(), tx, access.WorkspaceID, access.ProductionID, input.ReviewerID)
	if err != nil {
		serverError(w, err)
		return
	}
	if !active {
		errorJSON(w, http.StatusUnprocessableEntity, "reviewer_not_active", "审核人必须是当前有效的 Production 成员")
		return
	}
	if input.TaskID == "" {
		var taskCount int
		if err := tx.QueryRow(r.Context(), `SELECT COUNT(*)::int FROM entry_review_tasks WHERE workspace_id=$1 AND run_id=$2`, access.WorkspaceID, runID).Scan(&taskCount); err != nil {
			serverError(w, err)
			return
		}
		taskID := newID()
		if _, err := tx.Exec(r.Context(), `INSERT INTO entry_review_tasks(id,workspace_id,run_id,entry_id) VALUES($1,$2,$3,$4)`, taskID, access.WorkspaceID, runID, entryID); err != nil {
			serverError(w, err)
			return
		}
		if mode == "all" && taskCount > 0 {
			required++
			if _, err := tx.Exec(r.Context(), `UPDATE entry_review_runs SET required_count=$1,updated_at=NOW() WHERE id=$2`, required, runID); err != nil {
				serverError(w, err)
				return
			}
		}
		input.TaskID = taskID
	} else {
		var taskStatus string
		if err := tx.QueryRow(r.Context(), `SELECT status FROM entry_review_tasks WHERE workspace_id=$1 AND run_id=$2 AND entry_id=$3 AND id=$4 FOR UPDATE`, access.WorkspaceID, runID, entryID, input.TaskID).Scan(&taskStatus); err != nil {
			errorJSON(w, http.StatusNotFound, "review_task_not_found", "审核任务不存在")
			return
		}
		if taskStatus != "pending" {
			errorJSON(w, http.StatusConflict, "review_task_already_submitted", "已提交意见的审核任务不能改派")
			return
		}
		if _, err := tx.Exec(r.Context(), `UPDATE entry_review_task_assignments SET ended_at=NOW() WHERE workspace_id=$1 AND task_id=$2 AND ended_at IS NULL`, access.WorkspaceID, input.TaskID); err != nil {
			serverError(w, err)
			return
		}
	}
	if _, err := tx.Exec(r.Context(), `INSERT INTO entry_review_task_assignments(id,workspace_id,run_id,task_id,reviewer_id,assigned_by,reason,source) VALUES($1,$2,$3,$4,$5,$6,$7,'manual')`, newID(), access.WorkspaceID, runID, input.TaskID, input.ReviewerID, userID, input.Reason); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			errorJSON(w, http.StatusConflict, "reviewer_already_assigned", "该成员已承担此审核运行中的另一个任务")
		} else {
			serverError(w, err)
		}
		return
	}
	if err := refreshReviewRunStatus(r.Context(), tx, runID); err != nil {
		serverError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	updated, err := loadReviewRunAdminResponse(r.Context(), app.db, access.WorkspaceID, entryID)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"review": updated})
}
