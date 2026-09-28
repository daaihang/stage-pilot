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

func markFileVersionClean(t *testing.T, app *application, fileID, versionID string) {
	t.Helper()
	if _, err := app.db.Exec(t.Context(), `UPDATE file_versions SET security_status='clean',sha256=repeat('a',64),scan_engine='test',scan_signature='test',scanned_at=NOW()
		WHERE id=$1 AND file_id=$2`, versionID, fileID); err != nil {
		t.Fatalf("mark version clean: %v", err)
	}
	if _, err := app.db.Exec(t.Context(), `UPDATE files f SET current_version_id=v.id,status='uploaded',bucket=v.bucket,object_key=v.object_key,
		filename=v.filename,content_type=v.content_type,size_bytes=v.size_bytes,etag=v.etag
		FROM file_versions v WHERE f.id=$1 AND v.id=$2 AND v.file_id=f.id`, fileID, versionID); err != nil {
		t.Fatalf("publish test version: %v", err)
	}
	if _, err := app.db.Exec(t.Context(), `UPDATE file_scan_tasks SET status='completed',outcome='clean',completed_at=NOW(),lease_owner='',lease_until=NULL
		WHERE version_id=$1`, versionID); err != nil {
		t.Fatalf("complete test scan job: %v", err)
	}
}

func TestFileScanWorkerEndToEnd(t *testing.T) {
	if os.Getenv("FILE_SCAN_E2E") != "1" || os.Getenv("S3_ENDPOINT") == "" {
		t.Skip("set FILE_SCAN_E2E=1 with the local Worker, ClamAV, database, and MinIO stack")
	}
	app := newIntegrationApp(t)
	storage, err := newObjectStorage(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	app.storage = storage
	owner := createTestUser(t, app, "file-scan-e2e-"+newID()+"@example.test")
	token := issueTestToken(t, app, owner)
	workspaceID := createWorkspaceFor(t, app, token, "文件扫描端到端")["id"].(string)
	base := "/v1/workspaces/" + workspaceID + "/files"
	const eicar = `X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`
	for _, sample := range []struct {
		name, content, want string
	}{
		{name: "clean", content: "stagepilot harmless file", want: "ready"},
		{name: "eicar", content: eicar, want: "rejected"},
	} {
		t.Run(sample.name, func(t *testing.T) {
			created := authedRequest(t, app, token, http.MethodPost, base, map[string]any{
				"filename": sample.name + ".txt", "content_type": "application/octet-stream",
				"size_bytes": len(sample.content),
			})
			if created.Code != http.StatusCreated {
				t.Fatalf("create upload = %d: %s", created.Code, created.Body.String())
			}
			var body map[string]any
			if err := json.Unmarshal(created.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			fileID := fileTestID(t, body)
			upload := body["upload"].(map[string]any)
			signedFilePut(t, upload["url"].(string), sample.content)
			completed := authedRequest(t, app, token, http.MethodPost, base+"/"+fileID+"/complete", nil)
			if completed.Code != http.StatusAccepted {
				t.Fatalf("complete upload = %d: %s", completed.Code, completed.Body.String())
			}
			uploadID := upload["upload_id"].(string)
			deadline := time.Now().Add(90 * time.Second)
			for time.Now().Before(deadline) {
				statusResponse := authedRequest(t, app, token, http.MethodGet, "/v1/file-upload-sessions/"+uploadID, nil)
				if statusResponse.Code != http.StatusOK {
					t.Fatalf("read upload status = %d: %s", statusResponse.Code, statusResponse.Body.String())
				}
				var status struct {
					Status string `json:"status"`
				}
				if err := json.Unmarshal(statusResponse.Body.Bytes(), &status); err != nil {
					t.Fatal(err)
				}
				if status.Status != "processing" {
					if status.Status != sample.want {
						t.Fatalf("scan status = %q, want %q", status.Status, sample.want)
					}
					return
				}
				time.Sleep(time.Second)
			}
			t.Fatal("Worker did not finish the file scan within 90 seconds")
		})
	}
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
	completed := authedRequest(t, app, editorToken, http.MethodPost, base+"/"+productionFileID+"/complete", nil)
	if completed.Code != http.StatusAccepted {
		t.Fatalf("editor complete = %d: %s", completed.Code, completed.Body.String())
	}
	completedBody := attachmentResponse(t, completed.Body.Bytes())
	firstVersionID := completedBody["version_id"].(string)
	var originalKey, committedKey string
	var currentVersion *string
	if err := app.db.QueryRow(t.Context(), `SELECT object_key,current_version_id FROM files WHERE id=$1`, productionFileID).Scan(&committedKey, &currentVersion); err != nil {
		t.Fatal(err)
	}
	if err := app.db.QueryRow(t.Context(), `SELECT object_key FROM file_versions WHERE id=$1 AND file_id=$2 AND version_no=1`, firstVersionID, productionFileID).Scan(&originalKey); err != nil {
		t.Fatal(err)
	}
	if committedKey != originalKey || committedKey == "" || currentVersion != nil {
		t.Fatalf("unscanned v1 was published or not made immutable: key=%q version=%v", committedKey, currentVersion)
	}
	if response := authedRequest(t, app, editorToken, http.MethodGet, "/v1/file-upload-sessions/"+upload["id"].(string), nil); response.Code != 200 || !bytes.Contains(response.Body.Bytes(), []byte(`"status":"processing"`)) {
		t.Fatalf("upload scan status = %d %s", response.Code, response.Body.String())
	}
	if response := authedRequest(t, app, ownerToken, http.MethodGet, "/v1/file-upload-sessions/"+upload["id"].(string), nil); response.Code != 404 {
		t.Fatalf("non-uploader read scan status = %d", response.Code)
	}
	if response := authedRequest(t, app, viewerToken, http.MethodGet, base+"/"+productionFileID+"/download", nil); response.Code != 404 {
		t.Fatalf("unscanned file download = %d, want 404", response.Code)
	}
	signedFilePut(t, upload["url"].(string), "later")
	markFileVersionClean(t, app, productionFileID, firstVersionID)
	versionDownload := authedRequest(t, app, viewerToken, http.MethodGet, base+"/"+productionFileID+"/versions/"+firstVersionID+"/download", nil)
	if versionDownload.Code != 200 {
		t.Fatalf("direct viewer v1 download = %d", versionDownload.Code)
	}
	if got := signedFileRead(t, attachmentResponse(t, versionDownload.Body.Bytes())["url"].(string)); got != "hello" {
		t.Fatalf("old signed PUT changed committed library v1: %q", got)
	}
	versionStart := authedRequest(t, app, editorToken, http.MethodPost, base+"/"+productionFileID+"/versions", map[string]any{"filename": "production-v2.txt", "content_type": "text/plain", "size_bytes": 6})
	if versionStart.Code != 201 {
		t.Fatalf("start library v2 = %d: %s", versionStart.Code, versionStart.Body.String())
	}
	versionUpload := attachmentResponse(t, versionStart.Body.Bytes())["upload"].(map[string]any)
	signedFilePut(t, versionUpload["url"].(string), "second")
	versionComplete := authedRequest(t, app, editorToken, http.MethodPost, "/v1/file-upload-sessions/"+versionUpload["upload_id"].(string)+"/complete", nil)
	if versionComplete.Code != http.StatusAccepted {
		t.Fatalf("complete library v2 = %d: %s", versionComplete.Code, versionComplete.Body.String())
	}
	v2 := attachmentResponse(t, versionComplete.Body.Bytes())["version_id"].(string)
	if response := authedRequest(t, app, viewerToken, http.MethodGet, base+"/"+productionFileID+"/download", nil); response.Code != 200 {
		t.Fatalf("previous clean version unavailable during new scan = %d", response.Code)
	}
	if response := authedRequest(t, app, viewerToken, http.MethodGet, base+"/"+productionFileID+"/versions/"+v2+"/download", nil); response.Code != 404 {
		t.Fatalf("unscanned new version download = %d", response.Code)
	}
	markFileVersionClean(t, app, productionFileID, v2)
	if response := authedRequest(t, app, viewerToken, http.MethodGet, base+"/"+productionFileID+"/versions", nil); response.Code != 200 || !bytes.Contains(response.Body.Bytes(), []byte(`"version_no":2`)) {
		t.Fatalf("library version history = %d %s", response.Code, response.Body.String())
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
