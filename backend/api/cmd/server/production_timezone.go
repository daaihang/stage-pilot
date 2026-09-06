package main

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	keepWallTimeStrategy = "keep_wall_time"
	keepInstantStrategy  = "keep_instant"
)

type timezoneRebaseError struct {
	Code    string
	Message string
}

func (err *timezoneRebaseError) Error() string { return err.Message }

type productionTimezoneRow struct {
	table string
	id    string
	start *time.Time
	end   *time.Time
}

func (app *application) productionTimezone(ctx context.Context, workspaceID, productionID string) (string, error) {
	var timezone string
	err := app.db.QueryRow(ctx, `SELECT timezone FROM productions WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`, productionID, workspaceID).Scan(&timezone)
	return timezone, err
}

// rebaseScheduledInstant keeps the wall-clock fields represented by value in
// sourceTimezone while resolving them in targetTimezone. It deliberately
// rejects nonexistent and ambiguous target local times instead of letting
// time.Date silently normalize them.
func rebaseScheduledInstant(value *time.Time, sourceTimezone, targetTimezone string) (*time.Time, error) {
	if value == nil {
		return nil, nil
	}
	source, err := time.LoadLocation(sourceTimezone)
	if err != nil {
		return nil, &timezoneRebaseError{Code: "timezone_source_invalid", Message: fmt.Sprintf("记录 %s 的原时区无效，无法同步计划时间", sourceTimezone)}
	}
	target, err := time.LoadLocation(targetTimezone)
	if err != nil {
		return nil, &timezoneRebaseError{Code: "timezone_invalid", Message: "目标时区无效，需要合法的 IANA 时区名称"}
	}
	local := value.In(source)
	// A wall-clock value is represented as UTC only as an arithmetic carrier;
	// no host machine timezone participates in the conversion.
	naive := time.Date(local.Year(), local.Month(), local.Day(), local.Hour(), local.Minute(), local.Second(), local.Nanosecond(), time.UTC)
	offsets := map[int]struct{}{}
	for delta := -3; delta <= 3; delta++ {
		_, offset := naive.Add(time.Duration(delta) * 24 * time.Hour).In(target).Zone()
		offsets[offset] = struct{}{}
	}
	candidates := make([]time.Time, 0, len(offsets))
	for offset := range offsets {
		candidate := naive.Add(-time.Duration(offset) * time.Second)
		check := candidate.In(target)
		if check.Year() == local.Year() && check.Month() == local.Month() && check.Day() == local.Day() &&
			check.Hour() == local.Hour() && check.Minute() == local.Minute() && check.Second() == local.Second() && check.Nanosecond() == local.Nanosecond() {
			candidates = append(candidates, candidate)
		}
	}
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].Before(candidates[j]) })
	switch len(candidates) {
	case 0:
		return nil, &timezoneRebaseError{Code: "timezone_nonexistent_time", Message: fmt.Sprintf("记录计划时间 %s 在目标时区 %s 不存在，请改用“保持实际时间”或先调整时间", local.Format("2006-01-02 15:04"), targetTimezone)}
	case 1:
		instant := candidates[0].UTC()
		return &instant, nil
	default:
		return nil, &timezoneRebaseError{Code: "timezone_ambiguous_time", Message: fmt.Sprintf("记录计划时间 %s 在目标时区 %s 重复，请改用“保持实际时间”或先调整时间", local.Format("2006-01-02 15:04"), targetTimezone)}
	}
}

func loadProductionTimezoneRows(ctx context.Context, tx pgx.Tx, workspaceID, productionID string) ([]productionTimezoneRow, error) {
	rows := make([]productionTimezoneRow, 0)
	for _, table := range []string{"production_occurrences", "rehearsal_sessions", "schedule_items"} {
		result, err := tx.Query(ctx, "SELECT id,scheduled_start_at,scheduled_end_at FROM "+table+" WHERE workspace_id=$1 AND production_id=$2 FOR UPDATE", workspaceID, productionID)
		if err != nil {
			return nil, err
		}
		for result.Next() {
			var row productionTimezoneRow
			row.table, row.start, row.end = table, nil, nil
			if err := result.Scan(&row.id, &row.start, &row.end); err != nil {
				result.Close()
				return nil, err
			}
			rows = append(rows, row)
		}
		if err := result.Err(); err != nil {
			result.Close()
			return nil, err
		}
		result.Close()
	}
	return rows, nil
}

// updateProductionTimezone atomically updates the production and all planning
// records. Actual timestamps are intentionally never touched.
func (app *application) updateProductionTimezone(ctx context.Context, workspaceID, productionID string, name, description, targetTimezone string, plannedStart, plannedEnd *time.Time, status string, actualCompletedAt *time.Time, strategy string) error {
	tx, err := app.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var lockedTimezone string
	if err := tx.QueryRow(ctx, `SELECT timezone FROM productions WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL FOR UPDATE`, productionID, workspaceID).Scan(&lockedTimezone); err != nil {
		return err
	}
	rows, err := loadProductionTimezoneRows(ctx, tx, workspaceID, productionID)
	if err != nil {
		return err
	}
	if strategy == keepWallTimeStrategy {
		plannedStart, err = rebaseScheduledInstant(plannedStart, lockedTimezone, targetTimezone)
		if err != nil {
			return err
		}
		plannedEnd, err = rebaseScheduledInstant(plannedEnd, lockedTimezone, targetTimezone)
		if err != nil {
			return err
		}
		for index := range rows {
			rows[index].start, err = rebaseScheduledInstant(rows[index].start, lockedTimezone, targetTimezone)
			if err != nil {
				return err
			}
			rows[index].end, err = rebaseScheduledInstant(rows[index].end, lockedTimezone, targetTimezone)
			if err != nil {
				return err
			}
			if rows[index].start != nil && rows[index].end != nil && rows[index].end.Before(*rows[index].start) {
				return &timezoneRebaseError{Code: "invalid_input", Message: "同步后的计划结束时间不能早于开始时间"}
			}
		}
	}
	if plannedStart != nil && plannedEnd != nil && plannedEnd.Before(*plannedStart) {
		return &timezoneRebaseError{Code: "invalid_input", Message: "同步后的活动结束时间不能早于开始时间"}
	}
	if strategy == keepWallTimeStrategy {
		for _, row := range rows {
			if _, err := tx.Exec(ctx, "UPDATE "+row.table+" SET scheduled_start_at=$1,scheduled_end_at=$2,updated_at=NOW() WHERE id=$3 AND workspace_id=$4 AND production_id=$5 AND (scheduled_start_at IS DISTINCT FROM $1 OR scheduled_end_at IS DISTINCT FROM $2)", row.start, row.end, row.id, workspaceID, productionID); err != nil {
				return err
			}
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE productions SET name=$1,description=$2,timezone=$3,planned_start_at=$4,planned_end_at=$5,status=$6,actual_completed_at=$7,
		archived_at=CASE WHEN $6='archived' THEN COALESCE(archived_at,NOW()) ELSE NULL END,updated_at=NOW()
		WHERE id=$8 AND workspace_id=$9 AND deleted_at IS NULL`, name, description, targetTimezone, plannedStart, plannedEnd, status, actualCompletedAt, productionID, workspaceID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
