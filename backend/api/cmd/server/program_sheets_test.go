package main

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestLegacyProgramSheetMigrationDecodesCamelCaseReferences(t *testing.T) {
	var input legacyProgramSheetMigrationInput
	err := json.Unmarshal([]byte(`{
		"state": {
			"productionPrograms": [{"id":"program-1","name":"节目","sourceKind":"workspace_copy"}],
			"sheets": [{
				"id":"sheet-1",
				"name":"节目单",
				"revision":1,
				"status":"review",
				"items":[{
					"id":"item-1",
					"kind":"program",
					"productionProgramId":"program-1",
					"segmentTypeId":"segment-1",
					"titleOverride":"标题",
					"durationSecondsOverride":120,
					"countsTowardDuration":true,
					"audienceVisible":true,
					"requiresExecution":true,
					"notes":"备注"
				}],
				"assignments":[{"occurrenceId":"occurrence-1","role":"official"}]
			}]
		}
	}`), &input)
	if err != nil {
		t.Fatal(err)
	}
	item := input.State.Sheets[0].Items[0]
	if item.ProductionProgramID == nil || *item.ProductionProgramID != "program-1" || item.SegmentTypeID == nil || *item.SegmentTypeID != "segment-1" {
		t.Fatalf("item references were not decoded: %#v", item)
	}
	assignment := input.State.Sheets[0].Assignments[0]
	if assignment.OccurrenceID != "occurrence-1" {
		t.Fatalf("occurrence reference was not decoded: %#v", assignment)
	}
}

func TestMigrateProgramSheetsPreservesCamelCaseReferences(t *testing.T) {
	app := newIntegrationApp(t)
	owner := createTestUser(t, app, "program-sheet-migration-"+newID()+"@example.test")
	token := issueTestToken(t, app, owner)
	workspaceID := createWorkspaceFor(t, app, token, "节目单迁移工作空间")["id"].(string)
	productionID := createProductionFor(t, app, token, workspaceID, "节目单迁移活动", "", "")["id"].(string)
	occurrences := authedRequest(t, app, token, http.MethodGet, "/v1/productions/"+productionID+"/occurrences", nil)
	if occurrences.Code != http.StatusOK {
		t.Fatalf("list occurrences = %d: %s", occurrences.Code, occurrences.Body.String())
	}
	var occurrenceItems []map[string]any
	if err := json.Unmarshal(occurrences.Body.Bytes(), &occurrenceItems); err != nil || len(occurrenceItems) == 0 {
		t.Fatalf("decode default occurrence: %v %s", err, occurrences.Body.String())
	}
	occurrenceID := occurrenceItems[0]["id"].(string)
	programID, sheetID := "legacy-program-"+newID(), "legacy-sheet-"+newID()
	migrated := authedRequest(t, app, token, http.MethodPost, "/v1/productions/"+productionID+"/program-sheets/migrate", map[string]any{
		"state": map[string]any{
			"productionPrograms": []map[string]any{{
				"id": programID, "name": "迁移节目", "sourceKind": "manual",
				"performers": []string{}, "durationSeconds": 120,
			}},
			"sheets": []map[string]any{{
				"id": sheetID, "name": "迁移节目单", "revision": 1, "status": "review",
				"items": []map[string]any{{
					"id": "legacy-item-" + newID(), "kind": "program", "productionProgramId": programID,
					"countsTowardDuration": true, "audienceVisible": true,
				}},
				"assignments": []map[string]any{{"occurrenceId": occurrenceID, "role": "official"}},
			}},
		},
	})
	if migrated.Code != http.StatusCreated {
		t.Fatalf("migrate legacy program sheets = %d: %s", migrated.Code, migrated.Body.String())
	}
	var storedProgramID, storedOccurrenceID string
	if err := app.db.QueryRow(t.Context(), "SELECT production_program_id FROM program_sheet_items WHERE sheet_id=$1", sheetID).Scan(&storedProgramID); err != nil {
		t.Fatal(err)
	}
	if err := app.db.QueryRow(t.Context(), "SELECT occurrence_id FROM program_sheet_assignments WHERE sheet_id=$1", sheetID).Scan(&storedOccurrenceID); err != nil {
		t.Fatal(err)
	}
	if storedProgramID != programID || storedOccurrenceID != occurrenceID {
		t.Fatalf("legacy references were not preserved: program=%q occurrence=%q", storedProgramID, storedOccurrenceID)
	}
}
