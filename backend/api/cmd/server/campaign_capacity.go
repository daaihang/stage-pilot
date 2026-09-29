package main

import (
	"context"

	"github.com/jackc/pgx/v5"
)

type campaignCapacityQueryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func countCampaignCapacityEntries(ctx context.Context, queryer campaignCapacityQueryer, workspaceID, campaignID, excludeEntryID string) (int64, error) {
	var count int64
	err := queryer.QueryRow(ctx, `SELECT COUNT(*) FROM entries
		WHERE workspace_id=$1 AND campaign_id=$2 AND deleted_at IS NULL
		AND status IN ('accepted','converted') AND ($3='' OR id<>$3)`, workspaceID, campaignID, excludeEntryID).Scan(&count)
	return count, err
}
