package main

import (
	"encoding/json"
	"net/http"
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

type resourceTypeTestCase struct {
	key, resourcePath, typeField, usageField string
	createBody                               func(string) map[string]any
}

var resourceTypeTestCases = []resourceTypeTestCase{
	{"programs", "programs", "program_type_id", "program_count", func(typeID string) map[string]any {
		return map[string]any{"name": "测试节目", "program_type_id": typeID}
	}},
	{"venues", "venues", "venue_type_id", "venue_count", func(typeID string) map[string]any {
		return map[string]any{"name": "测试场地", "venue_type_id": typeID}
	}},
	{"people", "people", "person_type_id", "person_count", func(typeID string) map[string]any {
		return map[string]any{"display_name": "测试人员", "person_type_id": typeID}
	}},
	{"organizations", "organizations", "organization_type_id", "organization_count", func(typeID string) map[string]any {
		return map[string]any{"name": "测试机构", "organization_type_id": typeID}
	}},
	{"equipment", "equipment", "equipment_type_id", "equipment_count", func(typeID string) map[string]any {
		return map[string]any{"name": "测试设备", "equipment_type_id": typeID, "quantity_total": 1, "ownership": "owned"}
	}},
}

func resourceTypePath(workspaceID, resourceType string) string {
	return "/v1/workspaces/" + workspaceID + "/resource-types/" + resourceType
}

func findResourceType(t *testing.T, items []map[string]any, key string) map[string]any {
	t.Helper()
	for _, item := range items {
		if item["system_key"] == key {
			return item
		}
	}
	t.Fatalf("missing %q type in %#v", key, items)
	return nil
}

func TestUnifiedResourceTypeRoutesAndSystemDefaults(t *testing.T) {
	app := newIntegrationApp(t)
	owner := createTestUser(t, app, "resource-type-owner-"+newID()+"@example.test")
	token := issueTestToken(t, app, owner)
	workspaceID := createWorkspaceFor(t, app, token, "统一资源类型")["id"].(string)

	for _, test := range resourceTypeTestCases {
		path := resourceTypePath(workspaceID, test.key)
		listed := authedRequest(t, app, token, http.MethodGet, path, nil)
		if listed.Code != http.StatusOK {
			t.Fatalf("list %s = %d: %s", test.key, listed.Code, listed.Body.String())
		}
		items, total := decodeResourceList(t, listed.Body.Bytes())
		if len(items) == 0 || total != len(items) {
			t.Fatalf("seeded %s types = %#v / %d", test.key, items, total)
		}
		other := findResourceType(t, items, "other")
		if other["is_system_default"] != true || other["is_active"] != true {
			t.Fatalf("%s other type is not an active system default: %#v", test.key, other)
		}

		// A system type may only change activation state.
		if response := authedRequest(t, app, token, http.MethodPatch, path+"/"+other["id"].(string), map[string]any{"is_active": false}); response.Code != http.StatusOK {
			t.Fatalf("deactivate system %s type = %d: %s", test.key, response.Code, response.Body.String())
		}
		if response := authedRequest(t, app, token, http.MethodPatch, path+"/"+other["id"].(string), map[string]any{"name": "不可修改"}); response.Code != http.StatusConflict {
			t.Fatalf("rename system %s type = %d, want 409: %s", test.key, response.Code, response.Body.String())
		}
		if response := authedRequest(t, app, token, http.MethodPatch, path+"/"+other["id"].(string), map[string]any{"is_active": true}); response.Code != http.StatusOK {
			t.Fatalf("reactivate system %s type = %d: %s", test.key, response.Code, response.Body.String())
		}
		if response := authedRequest(t, app, token, http.MethodPost, path+"/"+other["id"].(string)+"/delete", map[string]any{"strategy": "delete"}); response.Code != http.StatusConflict {
			t.Fatalf("delete system %s type = %d, want 409: %s", test.key, response.Code, response.Body.String())
		}
	}

	for _, legacy := range []string{"program-types", "venue-types", "person-types", "organization-types", "equipment-types"} {
		if response := authedRequest(t, app, token, http.MethodGet, "/v1/workspaces/"+workspaceID+"/"+legacy, nil); response.Code != http.StatusNotFound {
			t.Fatalf("legacy %s route = %d, want 404", legacy, response.Code)
		}
	}
	if response := authedRequest(t, app, token, http.MethodGet, resourceTypePath(workspaceID, "files"), nil); response.Code != http.StatusNotFound {
		t.Fatalf("files resource types route = %d, want 404", response.Code)
	}
}

func TestUnifiedResourceTypeDeletionStrategiesAndAssignments(t *testing.T) {
	app := newIntegrationApp(t)
	owner := createTestUser(t, app, "resource-type-delete-"+newID()+"@example.test")
	token := issueTestToken(t, app, owner)
	workspaceID := createWorkspaceFor(t, app, token, "资源类型处理")["id"].(string)

	for _, test := range resourceTypeTestCases {
		path := resourceTypePath(workspaceID, test.key)
		items, _ := decodeResourceList(t, authedRequest(t, app, token, http.MethodGet, path, nil).Body.Bytes())
		otherID := findResourceType(t, items, "other")["id"].(string)
		custom := authedRequest(t, app, token, http.MethodPost, path, map[string]any{"name": "可迁移" + test.key, "color": "#123456"})
		if custom.Code != http.StatusCreated {
			t.Fatalf("create %s custom type = %d: %s", test.key, custom.Code, custom.Body.String())
		}
		sourceID := resourceID(t, custom.Body.Bytes())
		resource := authedRequest(t, app, token, http.MethodPost, "/v1/workspaces/"+workspaceID+"/"+test.resourcePath, test.createBody(sourceID))
		if resource.Code != http.StatusCreated {
			t.Fatalf("create %s resource = %d: %s", test.key, resource.Code, resource.Body.String())
		}
		createdResourceID := resourceID(t, resource.Body.Bytes())

		blocked := authedRequest(t, app, token, http.MethodPost, path+"/"+sourceID+"/delete", map[string]any{"strategy": "delete"})
		if blocked.Code != http.StatusConflict || errorFields(t, blocked.Body.Bytes())[test.usageField] != float64(1) {
			t.Fatalf("delete in-use %s type = %d: %s", test.key, blocked.Code, blocked.Body.String())
		}
		moved := authedRequest(t, app, token, http.MethodPost, path+"/"+sourceID+"/delete", map[string]any{"strategy": "move", "replacement_type_id": otherID})
		if moved.Code != http.StatusOK {
			t.Fatalf("move %s type = %d: %s", test.key, moved.Code, moved.Body.String())
		}
		read := authedRequest(t, app, token, http.MethodGet, "/v1/workspaces/"+workspaceID+"/"+test.resourcePath+"/"+createdResourceID, nil)
		var saved map[string]any
		if read.Code != http.StatusOK || json.Unmarshal(read.Body.Bytes(), &saved) != nil || saved[test.typeField] != otherID {
			t.Fatalf("moved %s resource = %d: %s", test.key, read.Code, read.Body.String())
		}

		fallbackSource := authedRequest(t, app, token, http.MethodPost, path, map[string]any{"name": "改为其他" + test.key, "color": "#234567"})
		fallbackID := resourceID(t, fallbackSource.Body.Bytes())
		fallbackResource := authedRequest(t, app, token, http.MethodPost, "/v1/workspaces/"+workspaceID+"/"+test.resourcePath, test.createBody(fallbackID))
		if response := authedRequest(t, app, token, http.MethodPost, path+"/"+fallbackID+"/delete", map[string]any{"strategy": "other"}); response.Code != http.StatusOK {
			t.Fatalf("move %s type to other = %d: %s", test.key, response.Code, response.Body.String())
		}
		fallbackRead := authedRequest(t, app, token, http.MethodGet, "/v1/workspaces/"+workspaceID+"/"+test.resourcePath+"/"+resourceID(t, fallbackResource.Body.Bytes()), nil)
		if fallbackRead.Code != http.StatusOK || !containsTypeID(t, fallbackRead.Body.Bytes(), test.typeField, otherID) {
			t.Fatalf("other fallback for %s = %d: %s", test.key, fallbackRead.Code, fallbackRead.Body.String())
		}

		inactiveSource := authedRequest(t, app, token, http.MethodPost, path, map[string]any{"name": "仅停用" + test.key, "color": "#345678"})
		inactiveID := resourceID(t, inactiveSource.Body.Bytes())
		inactiveResource := authedRequest(t, app, token, http.MethodPost, "/v1/workspaces/"+workspaceID+"/"+test.resourcePath, test.createBody(inactiveID))
		inactiveResourceID := resourceID(t, inactiveResource.Body.Bytes())
		if response := authedRequest(t, app, token, http.MethodPost, path+"/"+inactiveID+"/delete", map[string]any{"strategy": "deactivate"}); response.Code != http.StatusOK {
			t.Fatalf("deactivate %s type = %d: %s", test.key, response.Code, response.Body.String())
		}
		if response := authedRequest(t, app, token, http.MethodGet, "/v1/workspaces/"+workspaceID+"/"+test.resourcePath+"/"+inactiveResourceID, nil); response.Code != http.StatusOK || !containsTypeID(t, response.Body.Bytes(), test.typeField, inactiveID) {
			t.Fatalf("deactivate must preserve %s assignment = %d: %s", test.key, response.Code, response.Body.String())
		}
		if response := authedRequest(t, app, token, http.MethodPost, "/v1/workspaces/"+workspaceID+"/"+test.resourcePath, test.createBody(inactiveID)); response.Code != http.StatusBadRequest {
			t.Fatalf("create %s with inactive type = %d, want 400", test.key, response.Code)
		}
		unused := authedRequest(t, app, token, http.MethodPost, path, map[string]any{"name": "直接删除" + test.key, "color": "#456789"})
		unusedID := resourceID(t, unused.Body.Bytes())
		if response := authedRequest(t, app, token, http.MethodPost, path+"/"+unusedID+"/delete", map[string]any{"strategy": "delete"}); response.Code != http.StatusOK {
			t.Fatalf("delete unused %s type = %d: %s", test.key, response.Code, response.Body.String())
		}
	}
}

func containsTypeID(t *testing.T, body []byte, field, id string) bool {
	t.Helper()
	var value map[string]any
	return json.Unmarshal(body, &value) == nil && value[field] == id
}

func TestResourceTypesRejectNullAndCrossWorkspaceAssignments(t *testing.T) {
	app := newIntegrationApp(t)
	owner := createTestUser(t, app, "resource-type-validation-"+newID()+"@example.test")
	other := createTestUser(t, app, "resource-type-validation-other-"+newID()+"@example.test")
	token, otherToken := issueTestToken(t, app, owner), issueTestToken(t, app, other)
	workspaceID := createWorkspaceFor(t, app, token, "类型校验")["id"].(string)
	otherWorkspaceID := createWorkspaceFor(t, app, otherToken, "其他类型校验")["id"].(string)

	for _, test := range resourceTypeTestCases {
		path := resourceTypePath(workspaceID, test.key)
		items, _ := decodeResourceList(t, authedRequest(t, app, token, http.MethodGet, path, nil).Body.Bytes())
		typeID := findResourceType(t, items, "other")["id"].(string)
		withoutType := test.createBody("")
		delete(withoutType, test.typeField)
		if response := authedRequest(t, app, token, http.MethodPost, "/v1/workspaces/"+workspaceID+"/"+test.resourcePath, withoutType); response.Code != http.StatusBadRequest {
			t.Fatalf("create %s without type = %d, want 400", test.key, response.Code)
		}
		resource := authedRequest(t, app, token, http.MethodPost, "/v1/workspaces/"+workspaceID+"/"+test.resourcePath, test.createBody(typeID))
		id := resourceID(t, resource.Body.Bytes())
		if response := authedRequest(t, app, token, http.MethodPatch, "/v1/workspaces/"+workspaceID+"/"+test.resourcePath+"/"+id, map[string]any{test.typeField: nil}); response.Code != http.StatusBadRequest {
			t.Fatalf("clear %s type = %d, want 400", test.key, response.Code)
		}
		otherItems, _ := decodeResourceList(t, authedRequest(t, app, otherToken, http.MethodGet, resourceTypePath(otherWorkspaceID, test.key), nil).Body.Bytes())
		foreignID := findResourceType(t, otherItems, "other")["id"].(string)
		if response := authedRequest(t, app, token, http.MethodPatch, "/v1/workspaces/"+workspaceID+"/"+test.resourcePath+"/"+id, map[string]any{test.typeField: foreignID}); response.Code != http.StatusBadRequest {
			t.Fatalf("cross workspace %s type = %d, want 400", test.key, response.Code)
		}
	}
}
