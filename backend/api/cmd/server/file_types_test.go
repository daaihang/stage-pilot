package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func fileTypeItems(t *testing.T, response *httptest.ResponseRecorder) []map[string]any {
	t.Helper()
	items, _ := decodeResourceList(t, response.Body.Bytes())
	return items
}

func TestFileTypeManagementAndMigration(t *testing.T) {
	app := newIntegrationApp(t)
	owner := createTestUser(t, app, "file-type-owner-"+newID()+"@example.test")
	token := issueTestToken(t, app, owner)
	workspaceID := createWorkspaceFor(t, app, token, "文件类型管理")["id"].(string)

	listed := authedRequest(t, app, token, http.MethodGet, "/v1/workspaces/"+workspaceID+"/file-types?scope=workspace&sort=sort_order&direction=asc", nil)
	if listed.Code != http.StatusOK {
		t.Fatalf("list file types = %d: %s", listed.Code, listed.Body.String())
	}
	items := fileTypeItems(t, listed)
	if len(items) != 5 || items[len(items)-1]["template_key"] != "workspace.uncategorized" {
		t.Fatalf("workspace defaults = %#v", items)
	}

	created := authedRequest(t, app, token, http.MethodPost, "/v1/workspaces/"+workspaceID+"/file-types", map[string]any{
		"scope": "workspace", "name": "迁移备注", "description": "本地自定义描述", "is_active": false,
	})
	if created.Code != http.StatusCreated {
		t.Fatalf("create file type = %d: %s", created.Code, created.Body.String())
	}
	var createdItem map[string]any
	if err := json.Unmarshal(created.Body.Bytes(), &createdItem); err != nil {
		t.Fatal(err)
	}
	customID := createdItem["id"].(string)

	duplicate := authedRequest(t, app, token, http.MethodPost, "/v1/workspaces/"+workspaceID+"/file-types", map[string]any{"scope": "workspace", "name": "  迁移备注 "})
	if duplicate.Code != http.StatusConflict {
		t.Fatalf("duplicate file type = %d, want 409", duplicate.Code)
	}

	uncategorizedID := items[len(items)-1]["id"].(string)
	deactivate := authedRequest(t, app, token, http.MethodPatch, "/v1/workspaces/"+workspaceID+"/file-types/"+uncategorizedID, map[string]any{"is_active": false})
	if deactivate.Code != http.StatusConflict {
		t.Fatalf("deactivate uncategorized = %d, want 409", deactivate.Code)
	}

	migration := authedRequest(t, app, token, http.MethodPost, "/v1/workspaces/"+workspaceID+"/file-types/migrate", map[string]any{
		"scopes": map[string]any{
			"workspace": []map[string]any{
				{"id": "workspace:local:branding", "template_key": "workspace.branding", "name": "品牌标识", "description": "迁移后的品牌说明", "sort_order": 1, "is_system_default": true, "is_active": false},
				{"id": "workspace:local:custom", "template_key": nil, "name": "迁移自定义", "description": "从本地导入", "sort_order": 0, "is_system_default": false, "is_active": true},
			},
		},
	})
	if migration.Code != http.StatusOK {
		t.Fatalf("migrate file types = %d: %s", migration.Code, migration.Body.String())
	}
	updated := authedRequest(t, app, token, http.MethodGet, "/v1/workspaces/"+workspaceID+"/file-types?scope=workspace&sort=sort_order&direction=asc", nil)
	updatedItems := fileTypeItems(t, updated)
	customCount := 0
	var branding map[string]any
	for _, item := range updatedItems {
		if item["name"] == "迁移自定义" {
			customCount++
		}
		if item["template_key"] == "workspace.branding" {
			branding = item
		}
	}
	if customCount != 1 || branding == nil || branding["description"] != "迁移后的品牌说明" || branding["is_active"] != false {
		t.Fatalf("migrated items = %#v", updatedItems)
	}
	search := authedRequest(t, app, token, http.MethodGet, "/v1/workspaces/"+workspaceID+"/file-types?scope=workspace&q=品牌说明", nil)
	if search.Code != http.StatusOK || len(fileTypeItems(t, search)) != 1 {
		t.Fatalf("file type description search = %d: %s", search.Code, search.Body.String())
	}
	inactive := authedRequest(t, app, token, http.MethodGet, "/v1/workspaces/"+workspaceID+"/file-types?scope=workspace&status=inactive", nil)
	if inactive.Code != http.StatusOK || len(fileTypeItems(t, inactive)) != 2 {
		t.Fatalf("inactive file types = %d: %s", inactive.Code, inactive.Body.String())
	}
	// The same local snapshot is safe to submit again: template_key and the
	// case-insensitive custom name are used as the merge keys.
	secondMigration := authedRequest(t, app, token, http.MethodPost, "/v1/workspaces/"+workspaceID+"/file-types/migrate", map[string]any{
		"scopes": map[string]any{
			"workspace": []map[string]any{{"template_key": nil, "name": "迁移自定义", "description": "从本地导入", "sort_order": 0, "is_active": true}},
		},
	})
	if secondMigration.Code != http.StatusOK {
		t.Fatalf("repeat file type migration = %d: %s", secondMigration.Code, secondMigration.Body.String())
	}
	again := fileTypeItems(t, authedRequest(t, app, token, http.MethodGet, "/v1/workspaces/"+workspaceID+"/file-types?scope=workspace", nil))
	customCount = 0
	for _, item := range again {
		if item["name"] == "迁移自定义" {
			customCount++
		}
	}
	if customCount != 1 {
		t.Fatalf("repeat migration created duplicate = %#v", again)
	}

	// A no-op reorder must not touch any row timestamp.
	before := map[string]time.Time{}
	for _, item := range again {
		var updatedAt time.Time
		if err := app.db.QueryRow(t.Context(), `SELECT updated_at FROM file_types WHERE id=$1`, item["id"].(string)).Scan(&updatedAt); err != nil {
			t.Fatal(err)
		}
		before[item["id"].(string)] = updatedAt
	}
	orderItems := make([]map[string]any, len(again))
	for index, item := range again {
		orderItems[index] = map[string]any{"id": item["id"], "sort_order": index}
	}
	ordered := authedRequest(t, app, token, http.MethodPatch, "/v1/workspaces/"+workspaceID+"/file-types/order", map[string]any{"scope": "workspace", "items": orderItems})
	if ordered.Code != http.StatusOK {
		t.Fatalf("no-op file type reorder = %d: %s", ordered.Code, ordered.Body.String())
	}
	for id, previous := range before {
		var current time.Time
		if err := app.db.QueryRow(t.Context(), `SELECT updated_at FROM file_types WHERE id=$1`, id).Scan(&current); err != nil {
			t.Fatal(err)
		}
		if !current.Equal(previous) {
			t.Fatalf("no-op reorder changed timestamp for %s: %s -> %s", id, previous, current)
		}
	}

	deleted := authedRequest(t, app, token, http.MethodPost, "/v1/workspaces/"+workspaceID+"/file-types/"+customID+"/delete", map[string]any{})
	if deleted.Code != http.StatusOK {
		t.Fatalf("delete custom file type = %d: %s", deleted.Code, deleted.Body.String())
	}
	restored := authedRequest(t, app, token, http.MethodPost, "/v1/workspaces/"+workspaceID+"/file-types/restore", map[string]any{"scope": "workspace"})
	if restored.Code != http.StatusOK {
		t.Fatalf("restore file types = %d: %s", restored.Code, restored.Body.String())
	}
	restoredItems := fileTypeItems(t, restored)
	if len(restoredItems) != 5 || restoredItems[len(restoredItems)-1]["template_key"] != "workspace.uncategorized" {
		t.Fatalf("restored defaults = %#v", restoredItems)
	}
}

func TestProgramAndVenueTypeNoopOrderKeepsUpdatedAt(t *testing.T) {
	app := newIntegrationApp(t)
	owner := createTestUser(t, app, "type-order-timestamp-"+newID()+"@example.test")
	token := issueTestToken(t, app, owner)
	workspaceID := createWorkspaceFor(t, app, token, "类型排序时间戳")["id"].(string)

	checkNoop := func(path, table string, items []map[string]any) {
		t.Helper()
		before := map[string]time.Time{}
		order := make([]map[string]any, len(items))
		for index, item := range items {
			id := item["id"].(string)
			var updatedAt time.Time
			if err := app.db.QueryRow(t.Context(), `SELECT updated_at FROM `+table+` WHERE id=$1`, id).Scan(&updatedAt); err != nil {
				t.Fatal(err)
			}
			before[id] = updatedAt
			order[index] = map[string]any{"id": id, "sort_order": index}
		}
		response := authedRequest(t, app, token, http.MethodPatch, "/v1/workspaces/"+workspaceID+path, map[string]any{"items": order})
		if response.Code != http.StatusOK {
			t.Fatalf("no-op %s reorder = %d: %s", table, response.Code, response.Body.String())
		}
		for id, previous := range before {
			var current time.Time
			if err := app.db.QueryRow(t.Context(), `SELECT updated_at FROM `+table+` WHERE id=$1`, id).Scan(&current); err != nil {
				t.Fatal(err)
			}
			if !current.Equal(previous) {
				t.Fatalf("no-op %s reorder changed %s: %s -> %s", table, id, previous, current)
			}
		}
	}

	programItems := fileTypeItems(t, authedRequest(t, app, token, http.MethodGet, "/v1/workspaces/"+workspaceID+"/resource-types/programs?sort=sort_order&direction=asc", nil))
	checkNoop("/resource-types/programs/order", "program_types", programItems)
	venueItems := fileTypeItems(t, authedRequest(t, app, token, http.MethodGet, "/v1/workspaces/"+workspaceID+"/resource-types/venues", nil))
	checkNoop("/resource-types/venues/order", "venue_types", venueItems)

	duplicate := []map[string]any{{"id": venueItems[0]["id"], "sort_order": 0}, {"id": venueItems[0]["id"], "sort_order": 1}}
	if response := authedRequest(t, app, token, http.MethodPatch, "/v1/workspaces/"+workspaceID+"/resource-types/venues/order", map[string]any{"items": duplicate}); response.Code != http.StatusBadRequest {
		t.Fatalf("duplicate venue order = %d, want 400", response.Code)
	}
}
