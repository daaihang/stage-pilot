package main

// Campaign/结果契约迁移集成测试。
//
// 测试复用现有 PostgreSQL 集成测试约定：没有 DATABASE_URL，或数据库尚未
// 执行到 schema 30-44 时运行；这样普通的 go test ./... 不需要本地数据库。

import (
	"encoding/json"
	"strconv"
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
	versionNumber, parseErr := strconv.Atoi(version)
	if parseErr != nil || versionNumber < 30 || versionNumber > 44 {
		t.Skipf("campaign migration schema is %s, want 30-44", version)
	}
	tables := []string{
		"production_programs", "production_people", "production_registrations", "requirements", "resource_commitments",
		"campaign_templates", "campaign_template_versions", "form_versions", "campaigns", "campaign_revisions",
		"entries", "entry_revisions", "decisions", "entry_materializations", "form_responses",
		"api_idempotency_keys",
		"review_recipe_templates", "review_recipe_versions",
		"campaign_share_links", "campaign_public_submission_idempotency",
	}
	if versionNumber >= 34 {
		tables = append(tables, "entry_inbox_user_states")
	}
	for _, table := range tables {
		var registered *string
		if err := app.db.QueryRow(t.Context(), `SELECT to_regclass($1)`, "public."+table).Scan(&registered); err != nil {
			t.Fatalf("inspect table %s: %v", table, err)
		}
		if registered == nil {
			t.Fatalf("table %s missing at campaign schema", table)
		}
	}
	if versionNumber >= 44 {
		var indexExists bool
		if err := app.db.QueryRow(t.Context(), `SELECT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='entries_campaign_contact_email_limit_idx')`).Scan(&indexExists); err != nil {
			t.Fatal(err)
		}
		if !indexExists {
			t.Fatal("per-contact-email submission limit index missing")
		}
	}
}

func TestCampaignFormBlocksV2TemplateInvariant(t *testing.T) {
	app := newIntegrationApp(t)
	var version string
	if err := app.db.QueryRow(t.Context(), `SELECT value->>'version' FROM app_metadata WHERE key='schema'`).Scan(&version); err != nil {
		t.Skipf("campaign form blocks v2 schema unavailable: %v", err)
	}
	versionNumber, parseErr := strconv.Atoi(version)
	if parseErr != nil || versionNumber < 32 || versionNumber > 44 {
		t.Skipf("campaign form blocks v2 requires schema 32-44 (got %s)", version)
	}
	rows, err := app.db.Query(t.Context(), `
		SELECT ctv.definition->'form'->'fields', ctv.definition->'form'->'blocks', ctv.review_recipe_version_id
		FROM campaign_template_versions ctv
		WHERE ctv.version=2 AND ctv.template_id LIKE 'system_%'
	`)
	if err != nil {
		t.Fatalf("query v2 templates: %v", err)
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		var fieldsJSON, blocksJSON []byte
		var recipeID *string
		if err := rows.Scan(&fieldsJSON, &blocksJSON, &recipeID); err != nil {
			t.Fatalf("scan v2 template: %v", err)
		}
		var fields, blocks []map[string]any
		if err := json.Unmarshal(fieldsJSON, &fields); err != nil {
			t.Fatalf("decode fields: %v", err)
		}
		if err := json.Unmarshal(blocksJSON, &blocks); err != nil {
			t.Fatalf("decode blocks: %v", err)
		}
		if recipeID == nil || *recipeID == "" {
			t.Fatal("v2 template is missing review recipe source")
		}
		seen := map[string]int{}
		for _, block := range blocks {
			if block["type"] == "field" {
				if key, ok := block["field_key"].(string); ok {
					seen[key]++
				}
			}
		}
		for _, field := range fields {
			id, _ := field["id"].(string)
			if id == "" || seen[id] != 1 {
				t.Fatalf("field %q has %d field blocks", id, seen[id])
			}
		}
		count++
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate v2 templates: %v", err)
	}
	if count != 4 {
		t.Fatalf("v2 template count=%d, want 4", count)
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
	recipeTemplateA, recipeVersionA := newID(), newID()
	if _, err := tx.Exec(t.Context(), `INSERT INTO review_recipe_templates(id,workspace_id,scope,key,name,status,latest_version,created_by) VALUES($1,$2,'workspace',$3,'A 的审核方案','published',1,$4)`, recipeTemplateA, workspaceAID, "recipe_"+newID(), uid); err != nil {
		t.Fatalf("insert workspace recipe template: %v", err)
	}
	if _, err := tx.Exec(t.Context(), `INSERT INTO review_recipe_versions(id,template_id,workspace_id,version,schema_version,definition,created_by,published_at) VALUES($1,$2,$3,1,1,'{"schema_version":1,"mode":"AUTO_ACCEPT","rounds":[]}'::jsonb,$4,NOW())`, recipeVersionA, recipeTemplateA, workspaceAID, uid); err != nil {
		t.Fatalf("insert workspace recipe version: %v", err)
	}
	crossTemplate := newID()
	if _, err := tx.Exec(t.Context(), `INSERT INTO campaign_templates(id,workspace_id,scope,kind,name,status,latest_version,created_by) VALUES($1,$2,'workspace','COLLECTION','B 的模板','published',1,$3)`, crossTemplate, workspaceBID, uid); err != nil {
		t.Fatalf("insert workspace B template: %v", err)
	}
	expectMigrationConstraintError(t, tx, `INSERT INTO campaign_template_versions(id,template_id,workspace_id,version,review_recipe_version_id,definition,created_by) VALUES($1,$2,$3,1,$4,'{}'::jsonb,$5)`, newID(), crossTemplate, workspaceBID, recipeVersionA, uid)
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

func TestCampaignPublicIntakeSchema(t *testing.T) {
	app := newIntegrationApp(t)
	var version string
	if err := app.db.QueryRow(t.Context(), `SELECT value->>'version' FROM app_metadata WHERE key='schema'`).Scan(&version); err != nil {
		t.Skipf("campaign public intake schema unavailable: %v", err)
	}
	versionNumber, parseErr := strconv.Atoi(version)
	if parseErr != nil || versionNumber < 33 || versionNumber > 44 {
		t.Skipf("campaign public intake requires schema 33-44 (got %s)", version)
	}
	for _, table := range []string{"campaign_share_links", "campaign_public_submission_idempotency"} {
		var registered *string
		if err := app.db.QueryRow(t.Context(), `SELECT to_regclass($1)`, "public."+table).Scan(&registered); err != nil || registered == nil {
			t.Fatalf("public intake table %s missing", table)
		}
	}
}

func TestEntryInboxUserStateSchema(t *testing.T) {
	app := newIntegrationApp(t)
	var version string
	if err := app.db.QueryRow(t.Context(), `SELECT value->>'version' FROM app_metadata WHERE key='schema'`).Scan(&version); err != nil {
		t.Skipf("entry inbox schema unavailable: %v", err)
	}
	versionNumber, parseErr := strconv.Atoi(version)
	if parseErr != nil || versionNumber < 34 || versionNumber > 44 {
		t.Skipf("entry inbox schema requires schema 34-44 (got %s)", version)
	}
	var uniqueCount int
	if err := app.db.QueryRow(t.Context(), `SELECT count(*) FROM pg_indexes WHERE tablename='entry_inbox_user_states' AND indexdef LIKE '%workspace_id, entry_id, user_id%'`).Scan(&uniqueCount); err != nil {
		t.Fatal(err)
	}
	if uniqueCount == 0 {
		t.Fatal("entry inbox user state uniqueness index missing")
	}
}

func TestTemplateRecipeManagementSchema(t *testing.T) {
	app := newIntegrationApp(t)
	var version string
	if err := app.db.QueryRow(t.Context(), `SELECT value->>'version' FROM app_metadata WHERE key='schema'`).Scan(&version); err != nil {
		t.Skipf("template management schema unavailable: %v", err)
	}
	versionNumber, parseErr := strconv.Atoi(version)
	if parseErr != nil || versionNumber < 37 || versionNumber > 44 {
		t.Skipf("template management schema requires version 37-44 (got %s)", version)
	}
	for _, column := range []struct{ table, name string }{
		{"campaign_templates", "published_version"}, {"campaign_templates", "source_campaign_id"},
		{"campaign_template_versions", "published_at"}, {"review_recipe_templates", "published_version"},
	} {
		var exists bool
		if err := app.db.QueryRow(t.Context(), `SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2)`, column.table, column.name).Scan(&exists); err != nil {
			t.Fatalf("inspect %s.%s: %v", column.table, column.name, err)
		}
		if !exists {
			t.Fatalf("column %s.%s missing", column.table, column.name)
		}
	}
	var publishedTemplates int
	if err := app.db.QueryRow(t.Context(), `SELECT count(*) FROM campaign_templates WHERE scope='system' AND published_version IS NOT NULL`).Scan(&publishedTemplates); err != nil {
		t.Fatal(err)
	}
	if publishedTemplates != 4 {
		t.Fatalf("system campaign templates with published version=%d, want 4", publishedTemplates)
	}
}
