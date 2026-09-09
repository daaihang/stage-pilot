package main

// Campaign/结果契约迁移集成测试。
//
// 测试复用现有 PostgreSQL 集成测试约定：没有 DATABASE_URL，或数据库尚未
// 执行到 schema 29 时跳过；这样普通的 go test ./... 不需要本地数据库。

import (
	"encoding/json"
	"testing"

	"github.com/jackc/pgx/v5"
)

func expectMigrationConstraintError(t *testing.T, tx pgx.Tx, query string, args ...any) {
	t.Helper()
	const savepoint = "campaign_constraint_check"
	if _, err := tx.Exec(t.Context(), "SAVEPOINT "+savepoint); err != nil {
		t.Fatalf("create constraint savepoint: %v", err)
	}
	_, execErr := tx.Exec(t.Context(), query, args...)
	if _, err := tx.Exec(t.Context(), "ROLLBACK TO SAVEPOINT "+savepoint); err != nil {
		t.Fatalf("rollback constraint savepoint: %v", err)
	}
	if _, err := tx.Exec(t.Context(), "RELEASE SAVEPOINT "+savepoint); err != nil {
		t.Fatalf("release constraint savepoint: %v", err)
	}
	if execErr == nil {
		t.Fatalf("expected database constraint error for query: %s", query)
	}
}

func requireCampaignSchemaV1(t *testing.T, app *application) {
	t.Helper()
	var version string
	if err := app.db.QueryRow(t.Context(), `SELECT value->>'version' FROM app_metadata WHERE key='schema'`).Scan(&version); err != nil {
		t.Skipf("campaign migration schema unavailable: %v", err)
	}
	if version != "29" {
		t.Skipf("campaign migration schema is %s, want 29", version)
	}
	for _, table := range []string{
		"production_programs", "production_people", "production_registrations", "requirements", "resource_commitments",
		"campaign_templates", "campaign_template_versions", "form_versions", "campaigns", "campaign_revisions",
		"entries", "entry_revisions", "decisions", "entry_materializations", "form_responses",
		"api_idempotency_keys",
	} {
		var registered *string
		if err := app.db.QueryRow(t.Context(), `SELECT to_regclass($1)`, "public."+table).Scan(&registered); err != nil {
			t.Fatalf("inspect table %s: %v", table, err)
		}
		if registered == nil {
			t.Fatalf("table %s missing at schema 27", table)
		}
	}
}

func TestCampaignResultMigrationV1Constraints(t *testing.T) {
	app := newIntegrationApp(t)
	requireCampaignSchemaV1(t, app)

	uid := createTestUser(t, app, "campaign-migration-owner-"+newID()+"@example.test")
	token := issueTestToken(t, app, uid)
	workspaceA := createWorkspaceFor(t, app, token, "Campaign 迁移工作空间 A")
	workspaceB := createWorkspaceFor(t, app, token, "Campaign 迁移工作空间 B")
	productionA := createProductionFor(t, app, token, workspaceA["id"].(string), "Campaign 活动 A", "", "")
	workspaceAID := workspaceA["id"].(string)
	workspaceBID := workspaceB["id"].(string)
	productionAID := productionA["id"].(string)

	tx, err := app.db.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin transaction: %v", err)
	}
	t.Cleanup(func() { _ = tx.Rollback(t.Context()) })

	programTypeA := newID()
	programTypeB := newID()
	programA := newID()
	programB := newID()
	if _, err := tx.Exec(t.Context(), `INSERT INTO program_types(id,workspace_id,name,sort_order,created_by) VALUES($1,$2,$3,100,$4)`, programTypeA, workspaceAID, "独唱", uid); err != nil {
		t.Fatalf("insert program type: %v", err)
	}
	if _, err := tx.Exec(t.Context(), `INSERT INTO programs(id,workspace_id,name,program_type_id,created_by) VALUES($1,$2,$3,$4,$5)`, programA, workspaceAID, "原始节目", programTypeA, uid); err != nil {
		t.Fatalf("insert workspace program A: %v", err)
	}
	if _, err := tx.Exec(t.Context(), `INSERT INTO program_types(id,workspace_id,name,sort_order,created_by) VALUES($1,$2,$3,100,$4)`, programTypeB, workspaceBID, "其他类型", uid); err != nil {
		t.Fatalf("insert program type B: %v", err)
	}
	if _, err := tx.Exec(t.Context(), `INSERT INTO programs(id,workspace_id,name,program_type_id,created_by) VALUES($1,$2,$3,$4,$5)`, programB, workspaceBID, "其他租户节目", programTypeB, uid); err != nil {
		t.Fatalf("insert workspace program B: %v", err)
	}

	productionProgram := newID()
	if _, err := tx.Exec(t.Context(), `INSERT INTO production_programs(id,workspace_id,production_id,workspace_program_id,source_kind,name,program_type_id,performers,duration_seconds,status,created_by) VALUES($1,$2,$3,$4,'workspace_copy',$5,$6,$7,180,'confirmed',$8)`, productionProgram, workspaceAID, productionAID, programA, "活动快照", programTypeA, `[ {"display_name":"张三"} ]`, uid); err != nil {
		t.Fatalf("insert production program: %v", err)
	}
	if _, err := tx.Exec(t.Context(), `UPDATE programs SET name='Workspace 后续改名' WHERE id=$1`, programA); err != nil {
		t.Fatalf("update workspace program: %v", err)
	}
	var snapshotName string
	if err := tx.QueryRow(t.Context(), `SELECT name FROM production_programs WHERE id=$1`, productionProgram).Scan(&snapshotName); err != nil {
		t.Fatalf("read production program snapshot: %v", err)
	}
	if snapshotName != "活动快照" {
		t.Fatalf("production program snapshot changed with workspace program: %q", snapshotName)
	}

	expectMigrationConstraintError(t, tx, `INSERT INTO production_programs(id,workspace_id,production_id,workspace_program_id,name,created_by) VALUES($1,$2,$3,$4,$5,$6)`, newID(), workspaceAID, productionAID, programB, "跨租户节目", uid)
	if _, err := tx.Exec(t.Context(), `INSERT INTO production_people(id,workspace_id,production_id,display_name,roles,created_by) VALUES($1,$2,$3,$4,$5,$6)`, newID(), workspaceAID, productionAID, "外部候选人", `{"摄影师","导播"}`, uid); err != nil {
		t.Fatalf("unlinked production person should be accepted: %v", err)
	}
	expectMigrationConstraintError(t, tx, `INSERT INTO production_programs(id,workspace_id,production_id,name,duration_seconds,created_by) VALUES($1,$2,$3,$4,-1,$5)`, newID(), workspaceAID, productionAID, "负时长", uid)

	formVersion := newID()
	campaign := newID()
	revision := newID()
	entry := newID()
	decision := newID()
	if _, err := tx.Exec(t.Context(), `INSERT INTO form_versions(id,workspace_id,created_by) VALUES($1,$2,$3)`, formVersion, workspaceAID, uid); err != nil {
		t.Fatalf("insert form version: %v", err)
	}
	if _, err := tx.Exec(t.Context(), `INSERT INTO campaigns(id,workspace_id,production_id,kind,name,created_by) VALUES($1,$2,$3,'COLLECTION',$4,$5)`, campaign, workspaceAID, productionAID, "设备收集", uid); err != nil {
		t.Fatalf("insert campaign: %v", err)
	}
	if _, err := tx.Exec(t.Context(), `INSERT INTO campaign_revisions(id,workspace_id,campaign_id,revision_no,form_version_id,created_by) VALUES($1,$2,$3,1,$4,$5)`, revision, workspaceAID, campaign, formVersion, uid); err != nil {
		t.Fatalf("insert campaign revision: %v", err)
	}
	if _, err := tx.Exec(t.Context(), `UPDATE campaigns SET published_revision_id=$1,status='published' WHERE id=$2`, revision, campaign); err != nil {
		t.Fatalf("publish campaign revision: %v", err)
	}
	if _, err := tx.Exec(t.Context(), `INSERT INTO entries(id,workspace_id,production_id,campaign_id,campaign_revision_id,status,contact_email) VALUES($1,$2,$3,$4,$5,'submitted','candidate@example.test')`, entry, workspaceAID, productionAID, campaign, revision); err != nil {
		t.Fatalf("insert entry: %v", err)
	}
	if _, err := tx.Exec(t.Context(), `INSERT INTO decisions(id,workspace_id,entry_id,campaign_id,type,decided_by) VALUES($1,$2,$3,$4,'accept',$5)`, decision, workspaceAID, entry, campaign, uid); err != nil {
		t.Fatalf("insert decision: %v", err)
	}
	if _, err := tx.Exec(t.Context(), `UPDATE entries SET current_decision_id=$1,status='accepted' WHERE id=$2`, decision, entry); err != nil {
		t.Fatalf("set current decision: %v", err)
	}
	expectMigrationConstraintError(t, tx, `INSERT INTO decisions(id,workspace_id,entry_id,campaign_id,type,decided_by) VALUES($1,$2,$3,$4,'waitlist',$5)`, newID(), workspaceAID, entry, campaign, uid)

	registration := newID()
	if _, err := tx.Exec(t.Context(), `INSERT INTO production_registrations(id,workspace_id,production_id,entry_id,subject_kind,subject_snapshot,participant_count,created_by) VALUES($1,$2,$3,$4,'team',$5,3,$6)`, registration, workspaceAID, productionAID, entry, `{"name":"测试团队"}`, uid); err != nil {
		t.Fatalf("insert production registration: %v", err)
	}
	expectMigrationConstraintError(t, tx, `INSERT INTO production_registrations(id,workspace_id,production_id,entry_id,subject_kind,created_by) VALUES($1,$2,$3,$4,'person',$5)`, newID(), workspaceAID, productionAID, entry, uid)

	formResponse := newID()
	if _, err := tx.Exec(t.Context(), `INSERT INTO form_responses(id,workspace_id,production_id,campaign_id,entry_id,form_version_id,schema_version,answers) VALUES($1,$2,$3,$4,$5,$6,1,$7)`, formResponse, workspaceAID, productionAID, campaign, entry, formVersion, `{"vehicle_type":"商务车"}`); err != nil {
		t.Fatalf("insert form response: %v", err)
	}
	expectMigrationConstraintError(t, tx, `INSERT INTO form_responses(id,workspace_id,production_id,campaign_id,entry_id,form_version_id,schema_version) VALUES($1,$2,$3,$4,$5,$6,1)`, newID(), workspaceAID, productionAID, campaign, entry, formVersion)

	materializationID := newID()
	if _, err := tx.Exec(t.Context(), `INSERT INTO entry_materializations(id,workspace_id,entry_id,decision_id,target_kind,operation,status,idempotency_key,requested_by) VALUES($1,$2,$3,$4,'form_response','create','pending',$5,$6)`, materializationID, workspaceAID, entry, decision, entry+":form_response:create", uid); err != nil {
		t.Fatalf("insert materialization: %v", err)
	}
	expectMigrationConstraintError(t, tx, `INSERT INTO entry_materializations(id,workspace_id,entry_id,decision_id,target_kind,operation,status,idempotency_key,requested_by) VALUES($1,$2,$3,$4,'form_response','create','pending',$5,$6)`, newID(), workspaceAID, entry, decision, entry+":form_response:create", uid)
	expectMigrationConstraintError(t, tx, `INSERT INTO entry_materializations(id,workspace_id,entry_id,decision_id,target_kind,operation,status,idempotency_key,requested_by) VALUES($1,$2,$3,$4,'crew_assignment','create','pending',$5,$6)`, newID(), workspaceAID, entry, decision, entry+":crew:create", uid)

	requirement := newID()
	if _, err := tx.Exec(t.Context(), `INSERT INTO requirements(id,workspace_id,production_id,source_entry_id,kind,title,quantity_requested,created_by) VALUES($1,$2,$3,$4,'equipment','无线麦克风',2,$5)`, requirement, workspaceAID, productionAID, entry, uid); err != nil {
		t.Fatalf("insert requirement: %v", err)
	}
	expectMigrationConstraintError(t, tx, `INSERT INTO requirements(id,workspace_id,production_id,kind,title,quantity_requested,created_by) VALUES($1,$2,$3,'equipment','负数量',-1,$4)`, newID(), workspaceAID, productionAID, uid)
	if _, err := tx.Exec(t.Context(), `INSERT INTO resource_commitments(id,workspace_id,production_id,requirement_id,source_entry_id,commitment_snapshot,status,created_by) VALUES($1,$2,$3,$4,$5,$6,'proposed',$7)`, newID(), workspaceAID, productionAID, requirement, entry, `{"provider_name":"张三"}`, uid); err != nil {
		t.Fatalf("insert resource commitment: %v", err)
	}
	expectMigrationConstraintError(t, tx, `INSERT INTO resource_commitments(id,workspace_id,production_id,status,created_by) VALUES($1,$2,$3,'open',$4)`, newID(), workspaceAID, productionAID, uid)

	answers := map[string]any{"private_phone": "13800000000"}
	answerJSON, _ := json.Marshal(answers)
	if _, err := tx.Exec(t.Context(), `INSERT INTO entry_revisions(id,workspace_id,entry_id,revision_no,schema_version,answers) VALUES($1,$2,$3,1,1,$4)`, newID(), workspaceAID, entry, answerJSON); err != nil {
		t.Fatalf("insert entry revision: %v", err)
	}
	if _, err := tx.Exec(t.Context(), `UPDATE entries SET deleted_at=NOW(),anonymized_at=NOW(),anonymization_reason='privacy request',contact_email='' WHERE id=$1`, entry); err != nil {
		t.Fatalf("anonymize entry: %v", err)
	}
	if _, err := tx.Exec(t.Context(), `UPDATE entry_revisions SET answers='{}'::jsonb WHERE entry_id=$1`, entry); err != nil {
		t.Fatalf("redact entry answers: %v", err)
	}
	var decisions, materializations, registrations int
	if err := tx.QueryRow(t.Context(), `SELECT (SELECT count(*) FROM decisions WHERE entry_id=$1)::int,(SELECT count(*) FROM entry_materializations WHERE entry_id=$1)::int,(SELECT count(*) FROM production_registrations WHERE entry_id=$1)::int`, entry).Scan(&decisions, &materializations, &registrations); err != nil {
		t.Fatalf("read retained audit chain: %v", err)
	}
	if decisions != 1 || materializations != 1 || registrations != 1 {
		t.Fatalf("anonymization removed audit chain: decisions=%d materializations=%d registrations=%d", decisions, materializations, registrations)
	}

}

func TestCampaignSystemTemplateSeedAndIdempotencyTable(t *testing.T) {
	app := newIntegrationApp(t)
	requireCampaignSchemaV1(t, app)
	var templateCount int
	if err := app.db.QueryRow(t.Context(), `SELECT count(*) FROM campaign_templates WHERE scope='system' AND id LIKE 'system_%'`).Scan(&templateCount); err != nil {
		t.Fatal(err)
	}
	if templateCount != 4 {
		t.Fatalf("system template count = %d, want 4", templateCount)
	}
	var versionCount int
	if err := app.db.QueryRow(t.Context(), `SELECT count(*) FROM campaign_template_versions WHERE id LIKE 'system_%_v1'`).Scan(&versionCount); err != nil {
		t.Fatal(err)
	}
	if versionCount != 4 {
		t.Fatalf("system template version count = %d, want 4", versionCount)
	}
}
