package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func resourceID(t *testing.T, recorderBody []byte) string {
	t.Helper()
	var value map[string]any
	if err := json.Unmarshal(recorderBody, &value); err != nil {
		t.Fatal(err)
	}
	id, _ := value["id"].(string)
	if id == "" {
		t.Fatalf("missing id in %s", recorderBody)
	}
	return id
}

func TestResourceCRUDAndWorkspaceIsolation(t *testing.T) {
	app := newIntegrationApp(t)
	owner := createTestUser(t, app, "resource-owner-"+newID()+"@example.test")
	other := createTestUser(t, app, "resource-other-"+newID()+"@example.test")
	ownerToken, otherToken := issueTestToken(t, app, owner), issueTestToken(t, app, other)
	workspace := createWorkspaceFor(t, app, ownerToken, "资源库测试")
	otherWorkspace := createWorkspaceFor(t, app, otherToken, "其他资源库测试")
	workspaceID, otherWorkspaceID := workspace["id"].(string), otherWorkspace["id"].(string)

	types := authedRequest(t, app, ownerToken, http.MethodGet, "/v1/workspaces/"+workspaceID+"/program-types", nil)
	if types.Code != http.StatusOK {
		t.Fatalf("list seeded types = %d: %s", types.Code, types.Body.String())
	}
	var seededResult struct {
		Items []map[string]any `json:"items"`
		Total int              `json:"total"`
	}
	if err := json.Unmarshal(types.Body.Bytes(), &seededResult); err != nil {
		t.Fatalf("decode seeded types: %v", err)
	}
	if len(seededResult.Items) != 5 || seededResult.Total != 5 {
		t.Fatalf("seeded types = items %d total %d, want 5", len(seededResult.Items), seededResult.Total)
	}

	created := authedRequest(t, app, ownerToken, http.MethodPost, "/v1/workspaces/"+workspaceID+"/programs", map[string]any{"name": "测试节目", "program_type_id": seededResult.Items[0]["id"], "tags": []string{"开场"}})
	if created.Code != http.StatusCreated {
		t.Fatalf("create program = %d: %s", created.Code, created.Body.String())
	}
	programID := resourceID(t, created.Body.Bytes())

	filtered := authedRequest(t, app, ownerToken, http.MethodGet, "/v1/workspaces/"+workspaceID+"/programs?tag=%E5%BC%80%E5%9C%BA", nil)
	if filtered.Code != http.StatusOK || !json.Valid(filtered.Body.Bytes()) {
		t.Fatalf("filtered list = %d: %s", filtered.Code, filtered.Body.String())
	}
	cross := authedRequest(t, app, otherToken, http.MethodGet, "/v1/workspaces/"+otherWorkspaceID+"/programs/"+programID, nil)
	if cross.Code != http.StatusNotFound {
		t.Fatalf("cross workspace read = %d, want 404: %s", cross.Code, cross.Body.String())
	}
	deleted := authedRequest(t, app, ownerToken, http.MethodDelete, "/v1/workspaces/"+workspaceID+"/programs/"+programID, nil)
	if deleted.Code != http.StatusOK {
		t.Fatalf("delete program = %d: %s", deleted.Code, deleted.Body.String())
	}
	notFound := authedRequest(t, app, ownerToken, http.MethodGet, "/v1/workspaces/"+workspaceID+"/programs/"+programID, nil)
	if notFound.Code != http.StatusNotFound {
		t.Fatalf("soft deleted program read = %d, want 404", notFound.Code)
	}
}

func TestResourceInputValidation(t *testing.T) {
	app := newIntegrationApp(t)
	owner := createTestUser(t, app, "resource-input-"+newID()+"@example.test")
	token := issueTestToken(t, app, owner)
	workspaceID := createWorkspaceFor(t, app, token, "资源输入校验")["id"].(string)
	badEquipment := authedRequest(t, app, token, http.MethodPost, "/v1/workspaces/"+workspaceID+"/equipment", map[string]any{"name": "麦克风", "category": "audio", "quantity_total": -1, "ownership": "owned"})
	if badEquipment.Code != http.StatusBadRequest {
		t.Fatalf("negative quantity = %d, want 400: %s", badEquipment.Code, badEquipment.Body.String())
	}
}

func TestVenueTypesAndLegacyKindCompatibility(t *testing.T) {
	app := newIntegrationApp(t)
	owner := createTestUser(t, app, "venue-type-owner-"+newID()+"@example.test")
	token := issueTestToken(t, app, owner)
	workspaceID := createWorkspaceFor(t, app, token, "场地类型测试")["id"].(string)
	listed := authedRequest(t, app, token, http.MethodGet, "/v1/workspaces/"+workspaceID+"/venue-types", nil)
	if listed.Code != http.StatusOK {
		t.Fatalf("list venue types = %d: %s", listed.Code, listed.Body.String())
	}
	items, total := decodeResourceList(t, listed.Body.Bytes())
	if len(items) != 10 || total != 10 {
		t.Fatalf("venue defaults = %d/%d, want 10/10", len(items), total)
	}
	created := authedRequest(t, app, token, http.MethodPost, "/v1/workspaces/"+workspaceID+"/venues", map[string]any{"name": "旧客户端场地", "kind": "hall"})
	if created.Code != http.StatusCreated {
		t.Fatalf("legacy venue create = %d: %s", created.Code, created.Body.String())
	}
	var venue map[string]any
	if err := json.Unmarshal(created.Body.Bytes(), &venue); err != nil {
		t.Fatal(err)
	}
	if venue["venue_type_id"] == nil || venue["kind"] != "hall" {
		t.Fatalf("legacy venue response = %#v", venue)
	}
	protected := authedRequest(t, app, token, http.MethodPost, "/v1/workspaces/"+workspaceID+"/venue-types/"+items[0]["id"].(string)+"/delete", map[string]any{})
	if protected.Code != http.StatusConflict {
		t.Fatalf("delete system venue type = %d: %s", protected.Code, protected.Body.String())
	}
	other := createTestUser(t, app, "venue-type-other-"+newID()+"@example.test")
	otherToken := issueTestToken(t, app, other)
	otherWorkspaceID := createWorkspaceFor(t, app, otherToken, "其他场地类型")["id"].(string)
	otherListed := authedRequest(t, app, otherToken, http.MethodGet, "/v1/workspaces/"+otherWorkspaceID+"/venue-types", nil)
	otherItems, _ := decodeResourceList(t, otherListed.Body.Bytes())
	cross := authedRequest(t, app, token, http.MethodPost, "/v1/workspaces/"+workspaceID+"/venues", map[string]any{"name": "跨空间类型", "venue_type_id": otherItems[0]["id"]})
	if cross.Code != http.StatusBadRequest {
		t.Fatalf("cross workspace venue type = %d: %s", cross.Code, cross.Body.String())
	}
	deactivate := authedRequest(t, app, token, http.MethodPatch, "/v1/workspaces/"+workspaceID+"/venue-types/"+items[1]["id"].(string), map[string]any{"is_active": false})
	if deactivate.Code != http.StatusOK {
		t.Fatalf("deactivate venue type = %d: %s", deactivate.Code, deactivate.Body.String())
	}
	blocked := authedRequest(t, app, token, http.MethodPost, "/v1/workspaces/"+workspaceID+"/venues", map[string]any{"name": "停用类型场地", "venue_type_id": items[1]["id"]})
	if blocked.Code != http.StatusBadRequest {
		t.Fatalf("inactive venue type = %d: %s", blocked.Code, blocked.Body.String())
	}
}

func decodeResourceList(t *testing.T, body []byte) (items []map[string]any, total int) {
	t.Helper()
	var result struct {
		Items []map[string]any `json:"items"`
		Total int              `json:"total"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		t.Fatalf("decode resource list: %v", err)
	}
	return result.Items, result.Total
}

func errorFields(t *testing.T, body []byte) map[string]any {
	t.Helper()
	var result struct {
		Error map[string]any `json:"error"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		t.Fatalf("decode error: %v", err)
	}
	return result.Error
}

func TestProgramTypeManagementAndFilters(t *testing.T) {
	app := newIntegrationApp(t)
	owner := createTestUser(t, app, "program-type-owner-"+newID()+"@example.test")
	member := createTestUser(t, app, "program-type-member-"+newID()+"@example.test")
	ownerToken, memberToken := issueTestToken(t, app, owner), issueTestToken(t, app, member)
	workspaceID := createWorkspaceFor(t, app, ownerToken, "节目类型管理")["id"].(string)
	if _, err := app.db.Exec(t.Context(), `INSERT INTO workspace_memberships (id,workspace_id,user_id,role,status) VALUES ($1,$2,$3,'member','active')`, newID(), workspaceID, member); err != nil {
		t.Fatalf("insert member membership: %v", err)
	}

	seeded := authedRequest(t, app, ownerToken, http.MethodGet, "/v1/workspaces/"+workspaceID+"/program-types?sort=sort_order&direction=asc", nil)
	if seeded.Code != http.StatusOK {
		t.Fatalf("list seeded program types = %d: %s", seeded.Code, seeded.Body.String())
	}
	types, total := decodeResourceList(t, seeded.Body.Bytes())
	if len(types) != 5 || total != 5 {
		t.Fatalf("seeded types = %d items/%d total, want 5/5", len(types), total)
	}

	created := authedRequest(t, app, ownerToken, http.MethodPost, "/v1/workspaces/"+workspaceID+"/program-types", map[string]any{
		"name":       "  播客  ",
		"color":      " #ABCDEF ",
		"sort_order": 5,
		"is_active":  false,
	})
	if created.Code != http.StatusCreated {
		t.Fatalf("create program type = %d: %s", created.Code, created.Body.String())
	}
	var createdType map[string]any
	if err := json.Unmarshal(created.Body.Bytes(), &createdType); err != nil {
		t.Fatal(err)
	}
	if createdType["name"] != "播客" || createdType["color"] != "#ABCDEF" || createdType["is_active"] != false {
		t.Fatalf("created type normalization = %#v", createdType)
	}
	typeID := createdType["id"].(string)

	for name, body := range map[string]any{
		"duplicate name": map[string]any{"name": " 音乐 ", "color": "#123456"},
		"bad color":      map[string]any{"name": "颜色错误", "color": "123456"},
		"negative order": map[string]any{"name": "负排序", "color": "#123456", "sort_order": -1},
		"empty name":     map[string]any{"name": strings.Repeat(" ", 2), "color": "#123456"},
	} {
		invalid := authedRequest(t, app, ownerToken, http.MethodPost, "/v1/workspaces/"+workspaceID+"/program-types", body)
		if invalid.Code != http.StatusBadRequest {
			t.Fatalf("%s status = %d, want 400: %s", name, invalid.Code, invalid.Body.String())
		}
	}
	if tooLong := authedRequest(t, app, ownerToken, http.MethodPost, "/v1/workspaces/"+workspaceID+"/program-types", map[string]any{"name": strings.Repeat("类", 121), "color": "#123456"}); tooLong.Code != http.StatusBadRequest {
		t.Fatalf("unicode name length status = %d, want 400", tooLong.Code)
	}

	updated := authedRequest(t, app, ownerToken, http.MethodPatch, "/v1/workspaces/"+workspaceID+"/program-types/"+typeID, map[string]any{"name": "  播客节目  ", "color": "#abcdef", "is_active": true, "sort_order": 7})
	if updated.Code != http.StatusOK || !strings.Contains(updated.Body.String(), `"name":"播客节目"`) {
		t.Fatalf("update program type = %d: %s", updated.Code, updated.Body.String())
	}

	programA := authedRequest(t, app, ownerToken, http.MethodPost, "/v1/workspaces/"+workspaceID+"/programs", map[string]any{"name": "音乐节目", "program_type_id": types[0]["id"]})
	if programA.Code != http.StatusCreated {
		t.Fatalf("create assigned program = %d: %s", programA.Code, programA.Body.String())
	}
	programB := authedRequest(t, app, ownerToken, http.MethodPost, "/v1/workspaces/"+workspaceID+"/programs", map[string]any{"name": "未分配节目", "program_type_id": nil})
	if programB.Code != http.StatusCreated {
		t.Fatalf("create unassigned program = %d: %s", programB.Code, programB.Body.String())
	}
	programAID := resourceID(t, programA.Body.Bytes())

	withPrograms := authedRequest(t, app, ownerToken, http.MethodGet, "/v1/workspaces/"+workspaceID+"/program-types?has_programs=true", nil)
	if withPrograms.Code != http.StatusOK {
		t.Fatalf("program count filter = %d: %s", withPrograms.Code, withPrograms.Body.String())
	}
	usedTypes, _ := decodeResourceList(t, withPrograms.Body.Bytes())
	if len(usedTypes) != 1 || usedTypes[0]["id"] != types[0]["id"] || usedTypes[0]["program_count"] != float64(1) {
		t.Fatalf("program count filter result = %#v", usedTypes)
	}
	search := authedRequest(t, app, ownerToken, http.MethodGet, "/v1/workspaces/"+workspaceID+"/program-types?q=播客节目", nil)
	searchTypes, searchTotal := decodeResourceList(t, search.Body.Bytes())
	if search.Code != http.StatusOK || searchTotal != 1 || len(searchTypes) != 1 || searchTypes[0]["id"] != typeID {
		t.Fatalf("program type search = %d %#v/%d", search.Code, searchTypes, searchTotal)
	}

	// A member can read and filter, but cannot mutate workspace resources.
	if read := authedRequest(t, app, memberToken, http.MethodGet, "/v1/workspaces/"+workspaceID+"/programs?type_id=unassigned", nil); read.Code != http.StatusOK {
		t.Fatalf("member read unassigned programs = %d: %s", read.Code, read.Body.String())
	} else {
		items, total := decodeResourceList(t, read.Body.Bytes())
		if total != 1 || len(items) != 1 || items[0]["id"] == programAID {
			t.Fatalf("unassigned program filter = %#v/%d", items, total)
		}
	}
	if write := authedRequest(t, app, memberToken, http.MethodPost, "/v1/workspaces/"+workspaceID+"/program-types", map[string]any{"name": "越权", "color": "#123456"}); write.Code != http.StatusForbidden {
		t.Fatalf("member create program type = %d, want 403", write.Code)
	}
}

func TestProgramTypeDeleteStrategiesAndProgramAssignment(t *testing.T) {
	app := newIntegrationApp(t)
	owner := createTestUser(t, app, "program-type-delete-"+newID()+"@example.test")
	token := issueTestToken(t, app, owner)
	workspaceID := createWorkspaceFor(t, app, token, "节目类型删除策略")["id"].(string)
	list := authedRequest(t, app, token, http.MethodGet, "/v1/workspaces/"+workspaceID+"/program-types", nil)
	types, _ := decodeResourceList(t, list.Body.Bytes())
	sourceID, targetID := types[0]["id"].(string), types[1]["id"].(string)

	program := authedRequest(t, app, token, http.MethodPost, "/v1/workspaces/"+workspaceID+"/programs", map[string]any{"name": "迁移节目", "program_type_id": sourceID})
	programID := resourceID(t, program.Body.Bytes())
	blocked := authedRequest(t, app, token, http.MethodPost, "/v1/workspaces/"+workspaceID+"/program-types/"+sourceID+"/delete", map[string]any{"strategy": "delete"})
	if blocked.Code != http.StatusConflict {
		t.Fatalf("delete in-use type = %d: %s", blocked.Code, blocked.Body.String())
	}
	fields := errorFields(t, blocked.Body.Bytes())
	if fields["code"] != "program_type_in_use" || fields["program_count"] != float64(1) {
		t.Fatalf("in-use error = %#v", fields)
	}

	moved := authedRequest(t, app, token, http.MethodPost, "/v1/workspaces/"+workspaceID+"/program-types/"+sourceID+"/delete", map[string]any{"strategy": "move", "replacement_type_id": targetID})
	if moved.Code != http.StatusOK {
		t.Fatalf("move type = %d: %s", moved.Code, moved.Body.String())
	}
	detail := authedRequest(t, app, token, http.MethodGet, "/v1/workspaces/"+workspaceID+"/programs/"+programID, nil)
	if detail.Code != http.StatusOK || !strings.Contains(detail.Body.String(), `"program_type_id":"`+targetID+`"`) {
		t.Fatalf("moved program = %d: %s", detail.Code, detail.Body.String())
	}
	typesAfterMove, _ := decodeResourceList(t, authedRequest(t, app, token, http.MethodGet, "/v1/workspaces/"+workspaceID+"/program-types", nil).Body.Bytes())
	for _, item := range typesAfterMove {
		if item["id"] == sourceID {
			t.Fatalf("moved source type still listed: %#v", item)
		}
	}

	noReferenceID := types[3]["id"].(string)
	deleted := authedRequest(t, app, token, http.MethodPost, "/v1/workspaces/"+workspaceID+"/program-types/"+noReferenceID+"/delete", map[string]any{"strategy": "delete"})
	if deleted.Code != http.StatusOK {
		t.Fatalf("delete unused type = %d: %s", deleted.Code, deleted.Body.String())
	}
	remainingAfterDelete, _ := decodeResourceList(t, authedRequest(t, app, token, http.MethodGet, "/v1/workspaces/"+workspaceID+"/program-types", nil).Body.Bytes())
	for _, item := range remainingAfterDelete {
		if item["id"] == noReferenceID {
			t.Fatalf("soft-deleted unused type still listed: %#v", item)
		}
	}

	// Explicit null clears an assignment, while a disabled type remains valid
	// for existing programs but cannot be selected for a new one.
	secondSource := types[2]["id"].(string)
	secondProgram := authedRequest(t, app, token, http.MethodPost, "/v1/workspaces/"+workspaceID+"/programs", map[string]any{"name": "未分配迁移节目", "program_type_id": secondSource})
	secondProgramID := resourceID(t, secondProgram.Body.Bytes())
	if deactivate := authedRequest(t, app, token, http.MethodPatch, "/v1/workspaces/"+workspaceID+"/program-types/"+secondSource, map[string]any{"is_active": false}); deactivate.Code != http.StatusOK {
		t.Fatalf("deactivate type = %d: %s", deactivate.Code, deactivate.Body.String())
	}
	if rejected := authedRequest(t, app, token, http.MethodPost, "/v1/workspaces/"+workspaceID+"/programs", map[string]any{"name": "停用类型新节目", "program_type_id": secondSource}); rejected.Code != http.StatusBadRequest {
		t.Fatalf("create with inactive type = %d, want 400: %s", rejected.Code, rejected.Body.String())
	}
	cleared := authedRequest(t, app, token, http.MethodPatch, "/v1/workspaces/"+workspaceID+"/programs/"+secondProgramID, map[string]any{"program_type_id": nil})
	if cleared.Code != http.StatusOK || !strings.Contains(cleared.Body.String(), `"program_type_id":null`) {
		t.Fatalf("clear program type = %d: %s", cleared.Code, cleared.Body.String())
	}

	badMove := authedRequest(t, app, token, http.MethodPost, "/v1/workspaces/"+workspaceID+"/program-types/"+secondSource+"/delete", map[string]any{"strategy": "move", "replacement_type_id": "missing-type"})
	if badMove.Code != http.StatusBadRequest {
		t.Fatalf("move to missing type = %d, want 400: %s", badMove.Code, badMove.Body.String())
	}
	stillThere := authedRequest(t, app, token, http.MethodGet, "/v1/workspaces/"+workspaceID+"/program-types/"+secondSource, nil)
	if stillThere.Code != http.StatusNotFound && stillThere.Code != http.StatusMethodNotAllowed {
		// There is intentionally no type detail route. Verify rollback through
		// the list and the existing program instead.
		t.Fatalf("unexpected type detail route status = %d", stillThere.Code)
	}
	programAfterRollback := authedRequest(t, app, token, http.MethodGet, "/v1/workspaces/"+workspaceID+"/programs/"+secondProgramID, nil)
	if programAfterRollback.Code != http.StatusOK || !strings.Contains(programAfterRollback.Body.String(), `"program_type_id":null`) {
		t.Fatalf("rollback changed program assignment = %d: %s", programAfterRollback.Code, programAfterRollback.Body.String())
	}

	unassignSource := types[4]["id"].(string)
	unassignedProgram := authedRequest(t, app, token, http.MethodPost, "/v1/workspaces/"+workspaceID+"/programs", map[string]any{"name": "删除后未分配", "program_type_id": unassignSource})
	unassignedProgramID := resourceID(t, unassignedProgram.Body.Bytes())
	unassigned := authedRequest(t, app, token, http.MethodPost, "/v1/workspaces/"+workspaceID+"/program-types/"+unassignSource+"/delete", map[string]any{"strategy": "unassign"})
	if unassigned.Code != http.StatusOK {
		t.Fatalf("unassign type = %d: %s", unassigned.Code, unassigned.Body.String())
	}
	unassignedDetail := authedRequest(t, app, token, http.MethodGet, "/v1/workspaces/"+workspaceID+"/programs/"+unassignedProgramID, nil)
	if unassignedDetail.Code != http.StatusOK || !strings.Contains(unassignedDetail.Body.String(), `"program_type_id":null`) {
		t.Fatalf("unassigned program = %d: %s", unassignedDetail.Code, unassignedDetail.Body.String())
	}

	noStrategy := authedRequest(t, app, token, http.MethodPost, "/v1/workspaces/"+workspaceID+"/program-types/"+secondSource+"/delete", map[string]any{})
	if noStrategy.Code != http.StatusBadRequest {
		t.Fatalf("missing delete strategy = %d, want 400", noStrategy.Code)
	}
}

func TestProgramTypeOrderAndCrossWorkspaceIsolation(t *testing.T) {
	app := newIntegrationApp(t)
	owner := createTestUser(t, app, "program-type-order-"+newID()+"@example.test")
	other := createTestUser(t, app, "program-type-other-"+newID()+"@example.test")
	ownerToken, otherToken := issueTestToken(t, app, owner), issueTestToken(t, app, other)
	workspaceID := createWorkspaceFor(t, app, ownerToken, "排序隔离 A")["id"].(string)
	otherWorkspaceID := createWorkspaceFor(t, app, otherToken, "排序隔离 B")["id"].(string)
	items, _ := decodeResourceList(t, authedRequest(t, app, ownerToken, http.MethodGet, "/v1/workspaces/"+workspaceID+"/program-types", nil).Body.Bytes())
	badDuplicate := []map[string]any{{"id": items[0]["id"], "sort_order": 0}, {"id": items[0]["id"], "sort_order": 1}}
	if response := authedRequest(t, app, ownerToken, http.MethodPatch, "/v1/workspaces/"+workspaceID+"/program-types/order", map[string]any{"items": badDuplicate}); response.Code != http.StatusBadRequest {
		t.Fatalf("duplicate order ids = %d, want 400", response.Code)
	}
	missingType := make([]map[string]any, len(items)-1)
	for index := range missingType {
		missingType[index] = map[string]any{"id": items[index]["id"], "sort_order": index}
	}
	if response := authedRequest(t, app, ownerToken, http.MethodPatch, "/v1/workspaces/"+workspaceID+"/program-types/order", map[string]any{"items": missingType}); response.Code != http.StatusBadRequest {
		t.Fatalf("incomplete order list = %d, want 400", response.Code)
	}
	crossItems, _ := decodeResourceList(t, authedRequest(t, app, otherToken, http.MethodGet, "/v1/workspaces/"+otherWorkspaceID+"/program-types", nil).Body.Bytes())
	crossOrder := make([]map[string]any, len(items))
	for index, item := range items {
		crossOrder[index] = map[string]any{"id": item["id"], "sort_order": index}
	}
	if len(crossItems) > 0 {
		crossOrder[0]["id"] = crossItems[0]["id"]
	}
	if response := authedRequest(t, app, ownerToken, http.MethodPatch, "/v1/workspaces/"+workspaceID+"/program-types/order", map[string]any{"items": crossOrder}); response.Code != http.StatusBadRequest {
		t.Fatalf("cross workspace order ids = %d, want 400", response.Code)
	}
	if response := authedRequest(t, app, otherToken, http.MethodGet, "/v1/workspaces/"+workspaceID+"/program-types", nil); response.Code != http.StatusForbidden {
		t.Fatalf("cross workspace type list = %d, want 403", response.Code)
	}
}
