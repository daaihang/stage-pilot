package main

import (
	"context"

	"github.com/jackc/pgx/v5"
)

type membershipAuditEvent struct {
	ScopeKind     string
	WorkspaceID   string
	ProductionID  string
	MembershipID  string
	TargetUserID  string
	ActorUserID   string
	Action        string
	PreviousRole  string
	NextRole      string
	PreviousState string
	NextState     string
}

func recordMembershipAudit(ctx context.Context, tx pgx.Tx, event membershipAuditEvent) error {
	_, err := tx.Exec(ctx, `INSERT INTO membership_audit_events(
		id,scope_kind,workspace_id,production_id,membership_id,target_user_id,actor_user_id,
		action,previous_role,next_role,previous_status,next_status
	) VALUES($1,$2,$3,NULLIF($4,''),$5,$6,NULLIF($7,''),$8,NULLIF($9,''),NULLIF($10,''),NULLIF($11,''),NULLIF($12,''))`,
		newID(), event.ScopeKind, event.WorkspaceID, event.ProductionID, event.MembershipID,
		event.TargetUserID, event.ActorUserID, event.Action, event.PreviousRole, event.NextRole,
		event.PreviousState, event.NextState)
	return err
}
