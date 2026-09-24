package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/minio/minio-go/v7"
)

func fileTestID(t *testing.T, response map[string]any) string {
	t.Helper()
	file, ok := response["file"].(map[string]any)
	if !ok {
		t.Fatalf("missing file response: %#v", response)
	}
	id, ok := file["id"].(string)
	if !ok || id == "" {
		t.Fatalf("missing file id: %#v", response)
	}
	return id
}

func TestFileWorkspaceAndProductionAuthorization(t *testing.T) {
	if os.Getenv("S3_ENDPOINT") == "" {
		t.Skip("S3_ENDPOINT not set; skipping file storage integration test")
	}
	app := newIntegrationApp(t)
	storage, err := newObjectStorage(t.Context())
	if err != nil {
		t.Fatalf("create storage client: %v", err)
	}
	app.storage = storage

	owner := createTestUser(t, app, "file-owner-"+newID()+"@example.test")
	admin := createTestUser(t, app, "file-admin-"+newID()+"@example.test")
	member := createTestUser(t, app, "file-member-"+newID()+"@example.test")
	editor := createTestUser(t, app, "file-editor-"+newID()+"@example.test")
	viewer := createTestUser(t, app, "file-viewer-"+newID()+"@example.test")
	suspended := createTestUser(t, app, "file-suspended-"+newID()+"@example.test")
	ownerToken := issueTestToken(t, app, owner)
	adminToken := issueTestToken(t, app, admin)
	memberToken := issueTestToken(t, app, member)
	editorToken := issueTestToken(t, app, editor)
	viewerToken := issueTestToken(t, app, viewer)
	suspendedToken := issueTestToken(t, app, suspended)
	workspaceID := createWorkspaceFor(t, app, ownerToken, "文件权限测试")["id"].(string)
	productionID := createProductionFor(t, app, ownerToken, workspaceID, "文件活动", "", "")["id"].(string)
	otherProduction := createProductionFor(t, app, ownerToken, workspaceID, "其他文件活动", "", "")["id"].(string)
	otherWorkspace := createWorkspaceFor(t, app, ownerToken, "其他文件空间")["id"].(string)
	for _, fixture := range []struct{ user, role, status string }{
		{admin, "admin", "active"}, {member, "member", "active"}, {suspended, "member", "suspended"},
	} {
		if _, err := app.db.Exec(t.Context(), `INSERT INTO workspace_memberships(id,workspace_id,user_id,role,status) VALUES($1,$2,$3,$4,$5)`, newID(), workspaceID, fixture.user, fixture.role, fixture.status); err != nil {
			t.Fatalf("insert workspace membership: %v", err)
		}
	}
	for _, fixture := range []struct{ user, role string }{{editor, "editor"}, {viewer, "viewer"}} {
		if _, err := app.db.Exec(t.Context(), `INSERT INTO production_memberships(id,production_id,user_id,role_key,status) VALUES($1,$2,$3,$4,'active')`, newID(), productionID, fixture.user, fixture.role); err != nil {
			t.Fatalf("insert direct production membership: %v", err)
		}
	}

	base := "/v1/workspaces/" + workspaceID + "/files"
	workspaceFile := map[string]any{"filename": "workspace.txt", "content_type": "text/plain", "size_bytes": 5}
	productionFile := map[string]any{"filename": "production.txt", "content_type": "text/plain", "size_bytes": 5, "production_id": productionID}
	if response := authedRequest(t, app, viewerToken, http.MethodPost, base, workspaceFile); response.Code != 403 {
		t.Fatalf("direct viewer workspace upload = %d, want 403", response.Code)
	}
	if response := authedRequest(t, app, memberToken, http.MethodPost, base, productionFile); response.Code != 404 {
		t.Fatalf("workspace member production upload = %d, want 404", response.Code)
	}
	if response := authedRequest(t, app, viewerToken, http.MethodPost, base, productionFile); response.Code != 404 {
		t.Fatalf("direct viewer production upload = %d, want 404", response.Code)
	}
	if response := authedRequest(t, app, editorToken, http.MethodPost, "/v1/workspaces/"+otherWorkspace+"/files", productionFile); response.Code != 404 {
		t.Fatalf("cross-workspace production upload = %d, want 404", response.Code)
	}
	workspaceCreated := authedRequest(t, app, memberToken, http.MethodPost, base, workspaceFile)
	if workspaceCreated.Code != 201 {
		t.Fatalf("member workspace upload = %d: %s", workspaceCreated.Code, workspaceCreated.Body.String())
	}
	var workspaceBody map[string]any
	_ = json.Unmarshal(workspaceCreated.Body.Bytes(), &workspaceBody)
	workspaceFileID := fileTestID(t, workspaceBody)
	productionCreated := authedRequest(t, app, editorToken, http.MethodPost, base, productionFile)
	if productionCreated.Code != 201 {
		t.Fatalf("direct editor production upload = %d: %s", productionCreated.Code, productionCreated.Body.String())
	}
	var productionBody map[string]any
	_ = json.Unmarshal(productionCreated.Body.Bytes(), &productionBody)
	productionFileID := fileTestID(t, productionBody)
	otherCreated := authedRequest(t, app, ownerToken, http.MethodPost, base, map[string]any{"filename": "other.txt", "content_type": "text/plain", "size_bytes": 5, "production_id": otherProduction})
	if otherCreated.Code != 201 {
		t.Fatalf("owner other-production upload = %d: %s", otherCreated.Code, otherCreated.Body.String())
	}
	var otherBody map[string]any
	_ = json.Unmarshal(otherCreated.Body.Bytes(), &otherBody)
	otherFileID := fileTestID(t, otherBody)
	if response := authedRequest(t, app, ownerToken, http.MethodPost, base+"/"+productionFileID+"/complete", nil); response.Code != 403 {
		t.Fatalf("non-uploader completion = %d, want 403", response.Code)
	}

	for _, query := range []string{"", "?production_id=workspace"} {
		response := authedRequest(t, app, memberToken, http.MethodGet, base+query, nil)
		if response.Code != 200 {
			t.Fatalf("workspace list %q = %d", query, response.Code)
		}
		var body struct {
			Items []storedFile `json:"items"`
		}
		_ = json.Unmarshal(response.Body.Bytes(), &body)
		for _, item := range body.Items {
			if item.ID == productionFileID || item.ProductionID != nil {
				t.Fatalf("workspace list leaked production file: %#v", item)
			}
		}
	}
	if response := authedRequest(t, app, editorToken, http.MethodGet, base+"?production_id="+productionID, nil); response.Code != 200 {
		t.Fatalf("direct editor production list = %d", response.Code)
	}
	if response := authedRequest(t, app, viewerToken, http.MethodGet, base+"?production_id="+productionID, nil); response.Code != 200 {
		t.Fatalf("direct viewer production list = %d", response.Code)
	}
	if response := authedRequest(t, app, editorToken, http.MethodGet, base+"?production_id="+otherProduction, nil); response.Code != 404 {
		t.Fatalf("cross-production list = %d, want 404", response.Code)
	}
	if response := authedRequest(t, app, editorToken, http.MethodDelete, base+"/"+otherFileID, nil); response.Code != 404 {
		t.Fatalf("cross-production file id = %d, want 404", response.Code)
	}
	if response := authedRequest(t, app, editorToken, http.MethodGet, base+"/"+workspaceFileID+"/download", nil); response.Code != 403 {
		t.Fatalf("direct editor workspace download = %d, want 403", response.Code)
	}
	if response := authedRequest(t, app, suspendedToken, http.MethodGet, base+"?production_id="+productionID, nil); response.Code != 404 {
		t.Fatalf("suspended workspace member production list = %d, want 404", response.Code)
	}
	if response := authedRequest(t, app, memberToken, http.MethodDelete, base+"/"+workspaceFileID, nil); response.Code != 403 {
		t.Fatalf("member workspace delete = %d, want 403", response.Code)
	}
	if response := authedRequest(t, app, adminToken, http.MethodDelete, base+"/"+workspaceFileID, nil); response.Code != 200 {
		t.Fatalf("admin workspace delete = %d", response.Code)
	}

	upload := productionBody["upload"].(map[string]any)
	put, err := http.NewRequestWithContext(t.Context(), http.MethodPut, upload["url"].(string), bytes.NewBufferString("hello"))
	if err != nil {
		t.Fatalf("build signed upload: %v", err)
	}
	put.Header.Set("Content-Type", "text/plain")
	putResponse, err := http.DefaultClient.Do(put)
	if err != nil {
		t.Fatalf("send signed upload: %v", err)
	}
	putResponse.Body.Close()
	if putResponse.StatusCode != 200 {
		t.Fatalf("signed upload = %d", putResponse.StatusCode)
	}
	if response := authedRequest(t, app, editorToken, http.MethodPost, base+"/"+productionFileID+"/complete", nil); response.Code != 200 {
		t.Fatalf("editor complete = %d: %s", response.Code, response.Body.String())
	}
	if response := authedRequest(t, app, viewerToken, http.MethodGet, base+"/"+productionFileID+"/download", nil); response.Code != 200 {
		t.Fatalf("direct viewer download = %d: %s", response.Code, response.Body.String())
	}
	if response := authedRequest(t, app, memberToken, http.MethodGet, base+"/"+productionFileID+"/download", nil); response.Code != 200 {
		t.Fatalf("inherited workspace member download = %d: %s", response.Code, response.Body.String())
	}
	if response := authedRequest(t, app, adminToken, http.MethodGet, base+"/"+productionFileID+"/download", nil); response.Code != 200 {
		t.Fatalf("inherited workspace admin download = %d: %s", response.Code, response.Body.String())
	}
	if response := authedRequest(t, app, editorToken, http.MethodDelete, "/v1/workspaces/"+otherWorkspace+"/files/"+productionFileID, nil); response.Code != 404 {
		t.Fatalf("cross-workspace file id = %d, want 404", response.Code)
	}
	if response := authedRequest(t, app, editorToken, http.MethodDelete, base+"/"+productionFileID, nil); response.Code != 200 {
		t.Fatalf("editor production delete = %d: %s", response.Code, response.Body.String())
	}
	if response := authedRequest(t, app, ownerToken, http.MethodGet, base+"/"+productionFileID+"/download", nil); response.Code != 404 {
		t.Fatalf("soft-deleted download = %d, want 404", response.Code)
	}
	var objectKey string
	if err := app.db.QueryRow(t.Context(), `SELECT object_key FROM files WHERE id=$1 AND deleted_at IS NOT NULL`, productionFileID).Scan(&objectKey); err != nil {
		t.Fatalf("soft-deleted file row missing: %v", err)
	}
	if _, err := storage.client.StatObject(t.Context(), storage.bucket, objectKey, minio.StatObjectOptions{}); err != nil {
		t.Fatalf("soft-deleted object removed: %v", err)
	}
	t.Cleanup(func() {
		_ = storage.client.RemoveObject(context.Background(), storage.bucket, objectKey, minio.RemoveObjectOptions{})
	})
	if _, err := app.db.Exec(t.Context(), `UPDATE production_memberships SET status='suspended' WHERE production_id=$1 AND user_id=$2`, productionID, viewer); err != nil {
		t.Fatalf("suspend viewer: %v", err)
	}
	if response := authedRequest(t, app, viewerToken, http.MethodGet, base+"?production_id="+productionID, nil); response.Code != 404 {
		t.Fatalf("suspended direct viewer list = %d, want 404", response.Code)
	}
	if _, err := app.db.Exec(t.Context(), `UPDATE production_memberships SET status='active',expires_at=$1 WHERE production_id=$2 AND user_id=$3`, time.Now().Add(-time.Minute), productionID, viewer); err != nil {
		t.Fatalf("expire viewer: %v", err)
	}
	if response := authedRequest(t, app, viewerToken, http.MethodGet, base+"?production_id="+productionID, nil); response.Code != 404 {
		t.Fatalf("expired direct viewer list = %d, want 404", response.Code)
	}
	if _, err := app.db.Exec(t.Context(), `UPDATE production_memberships SET status='revoked',revoked_at=NOW() WHERE production_id=$1 AND user_id=$2`, productionID, viewer); err != nil {
		t.Fatalf("revoke viewer: %v", err)
	}
	if response := authedRequest(t, app, viewerToken, http.MethodGet, base+"?production_id="+productionID, nil); response.Code != 404 {
		t.Fatalf("revoked direct viewer list = %d, want 404", response.Code)
	}
}
