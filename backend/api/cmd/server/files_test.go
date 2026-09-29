package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"testing"
	"time"

	objectstore "github.com/daaihang/stagepilot/backend/storage"
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

func TestValidateBucketVersioningDisabled(t *testing.T) {
	for _, test := range []struct {
		name, status string
		wantError    bool
	}{{name: "unversioned"}, {name: "enabled", status: "Enabled", wantError: true}, {name: "suspended", status: "Suspended", wantError: true}} {
		t.Run(test.name, func(t *testing.T) {
			err := validateBucketVersioningDisabled("files", test.status)
			if (err != nil) != test.wantError {
				t.Fatalf("validate versioning status %q error = %v", test.status, err)
			}
		})
	}
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
	if _, err := app.db.Exec(t.Context(), `INSERT INTO file_event_outbox(event_id,event_type,schema_version,aggregate_type,aggregate_id,
		workspace_id,file_id,version_id,occurred_at,payload)
		SELECT 'file.version.safe_available:'||v.id,'file.version.safe_available',1,'file_version',v.id,
			v.workspace_id,v.file_id,v.id,COALESCE(v.scanned_at,v.created_at),
			jsonb_build_object('event_id','file.version.safe_available:'||v.id,'event_type','file.version.safe_available',
			'schema_version',1,'workspace_id',v.workspace_id,'file_id',v.file_id,'version_id',v.id,
			'occurred_at',COALESCE(v.scanned_at,v.created_at),'size_bytes',v.size_bytes,'sha256',NULLIF(v.sha256,''),'content_type',v.content_type)
		FROM file_versions v WHERE v.id=$1 ON CONFLICT(event_type,version_id) DO NOTHING`, versionID); err != nil {
		t.Fatalf("write test safe-available event: %v", err)
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
			signedFilePut(t, upload, sample.content)
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
					Status       string `json:"status"`
					Phase        string `json:"phase"`
					FileID       string `json:"file_id"`
					VersionID    string `json:"version_id"`
					ExpectedSize int64  `json:"expected_size"`
				}
				if err := json.Unmarshal(statusResponse.Body.Bytes(), &status); err != nil {
					t.Fatal(err)
				}
				if status.Status != "processing" {
					if status.Status != sample.want {
						t.Fatalf("scan status = %q, want %q", status.Status, sample.want)
					}
					if status.FileID != fileID || status.VersionID == "" || status.ExpectedSize != int64(len(sample.content)) {
						t.Fatalf("incomplete resumable upload status: %+v", status)
					}
					if status.Status == "rejected" && status.Phase != "scan_rejected" {
						t.Fatalf("rejected upload phase = %q", status.Phase)
					}
					if status.Status == "ready" {
						if status.Phase != "ready" {
							t.Fatalf("ready phase = %q", status.Phase)
						}
						download := authedRequest(t, app, token, http.MethodGet, base+"/"+fileID+"/download", nil)
						if download.Code != http.StatusOK {
							t.Fatalf("download descriptor = %d: %s", download.Code, download.Body.String())
						}
						var descriptor struct {
							VersionID string `json:"version_id"`
							Filename  string `json:"filename"`
							SizeBytes int64  `json:"size_bytes"`
							SHA256    string `json:"sha256"`
							ETag      string `json:"etag"`
						}
						if err := json.Unmarshal(download.Body.Bytes(), &descriptor); err != nil {
							t.Fatal(err)
						}
						sha := sha256.Sum256([]byte(sample.content))
						if descriptor.VersionID != status.VersionID || descriptor.Filename != sample.name+".txt" || descriptor.SizeBytes != int64(len(sample.content)) || descriptor.SHA256 != hex.EncodeToString(sha[:]) || descriptor.ETag == "" {
							t.Fatalf("incomplete download descriptor: %+v", descriptor)
						}
					}
					var events int
					var eventType, eventID, eventHash string
					var leaksStorageLocation bool
					if err := app.db.QueryRow(t.Context(), `SELECT COUNT(*),COALESCE(MAX(event_type),''),COALESCE(MAX(event_id),''),
						COALESCE(MAX(payload->>'sha256'),''),COALESCE(BOOL_OR(payload ? 'object_key' OR payload ? 'bucket'),FALSE)
						FROM file_event_outbox WHERE version_id=$1`, status.VersionID).Scan(&events, &eventType, &eventID, &eventHash, &leaksStorageLocation); err != nil {
						t.Fatal(err)
					}
					if status.Status == "ready" {
						sha := sha256.Sum256([]byte(sample.content))
						if events != 1 || eventType != "file.version.safe_available" || eventID != "file.version.safe_available:"+status.VersionID || eventHash != hex.EncodeToString(sha[:]) || leaksStorageLocation {
							t.Fatalf("safe-available outbox event = count %d type %q id %q sha %q leaks location=%v", events, eventType, eventID, eventHash, leaksStorageLocation)
						}
					} else if events != 0 {
						t.Fatalf("rejected version emitted %d safe-available events", events)
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
	memberStorage := authedRequest(t, app, memberToken, http.MethodGet, "/v1/me/workspace-storage", nil)
	if memberStorage.Code != http.StatusOK || !bytes.Contains(memberStorage.Body.Bytes(), []byte(workspaceID)) || bytes.Contains(memberStorage.Body.Bytes(), []byte("filename")) {
		t.Fatalf("workspace member storage summary = %d: %s", memberStorage.Code, memberStorage.Body.String())
	}
	directProductionStorage := authedRequest(t, app, editorToken, http.MethodGet, "/v1/me/workspace-storage", nil)
	if directProductionStorage.Code != http.StatusOK || !bytes.Contains(directProductionStorage.Body.Bytes(), []byte(`"total":0`)) {
		t.Fatalf("direct Production member appeared in Workspace storage summary = %d: %s", directProductionStorage.Code, directProductionStorage.Body.String())
	}
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
	workspaceUpload := workspaceBody["upload"].(map[string]any)
	if workspaceUpload["transport"] != "post" {
		t.Fatalf("small upload transport = %v, want post", workspaceUpload["transport"])
	}
	signedFilePut(t, workspaceUpload, "hello")
	var workspaceUploadID string
	if err := app.db.QueryRow(t.Context(), `SELECT id FROM file_upload_sessions WHERE file_id=$1`, workspaceFileID).Scan(&workspaceUploadID); err != nil {
		t.Fatalf("read Workspace upload session: %v", err)
	}
	var reservationStatus string
	var reservedBytes, reservedPhysical int64
	if err := app.db.QueryRow(t.Context(), `SELECT status,quota_reserved_bytes,physical_reserved_bytes FROM workspace_storage_reservations WHERE upload_session_id=$1`, workspaceUploadID).
		Scan(&reservationStatus, &reservedBytes, &reservedPhysical); err != nil || reservationStatus != "reserved" || reservedBytes != 5 || reservedPhysical != 10 {
		t.Fatalf("upload reservation = (%q,%d,%d), error=%v", reservationStatus, reservedBytes, reservedPhysical, err)
	}
	completeWorkspaceSession := authedRequest(t, app, memberToken, http.MethodPost, "/v1/file-upload-sessions/"+workspaceUploadID+"/complete", nil)
	if completeWorkspaceSession.Code != http.StatusAccepted {
		t.Fatalf("complete Workspace upload session = %d: %s", completeWorkspaceSession.Code, completeWorkspaceSession.Body.String())
	}
	var committedQuota, committedPhysical int64
	if err := app.db.QueryRow(t.Context(), `SELECT status,quota_reserved_bytes,quota_committed_bytes,physical_reserved_bytes
		FROM workspace_storage_reservations WHERE upload_session_id=$1`, workspaceUploadID).
		Scan(&reservationStatus, &reservedBytes, &committedQuota, &committedPhysical); err != nil || reservationStatus != "committed" || reservedBytes != 0 || committedQuota != 5 || committedPhysical != 5 {
		t.Fatalf("committed upload ledger = (%q,%d,%d,%d), error=%v", reservationStatus, reservedBytes, committedQuota, committedPhysical, err)
	}
	if _, err := app.db.Exec(t.Context(), `UPDATE workspace_storage_accounts SET quota_limit_bytes=quota_used_bytes+quota_reserved_bytes WHERE workspace_id=$1`, workspaceID); err != nil {
		t.Fatalf("set tight Workspace quota: %v", err)
	}
	quotaDenied := authedRequest(t, app, memberToken, http.MethodPost, base, map[string]any{"filename": "quota.txt", "content_type": "text/plain", "size_bytes": 1})
	if quotaDenied.Code != http.StatusConflict || !bytes.Contains(quotaDenied.Body.Bytes(), []byte("workspace_quota_exceeded")) {
		t.Fatalf("upload beyond Workspace quota = %d: %s", quotaDenied.Code, quotaDenied.Body.String())
	}
	if _, err := app.db.Exec(t.Context(), `UPDATE workspace_storage_accounts SET quota_limit_bytes=NULL WHERE workspace_id=$1`, workspaceID); err != nil {
		t.Fatalf("restore unlimited Workspace quota: %v", err)
	}
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
	var workspaceQuotaUsed int64
	if err := app.db.QueryRow(t.Context(), `SELECT quota_used_bytes FROM workspace_storage_accounts WHERE workspace_id=$1`, workspaceID).Scan(&workspaceQuotaUsed); err != nil || workspaceQuotaUsed != 0 {
		t.Fatalf("soft delete did not release quota: used=%d err=%v", workspaceQuotaUsed, err)
	}
	if _, err := app.db.Exec(t.Context(), `UPDATE workspace_storage_accounts SET quota_limit_bytes=0 WHERE workspace_id=$1`, workspaceID); err != nil {
		t.Fatalf("set zero Workspace quota: %v", err)
	}
	if response := authedRequest(t, app, adminToken, http.MethodPost, base+"/"+workspaceFileID+"/restore", nil); response.Code != http.StatusConflict || !bytes.Contains(response.Body.Bytes(), []byte("restore_quota_exceeded")) {
		t.Fatalf("restore beyond Workspace quota = %d: %s", response.Code, response.Body.String())
	}
	if _, err := app.db.Exec(t.Context(), `UPDATE workspace_storage_accounts SET quota_limit_bytes=NULL WHERE workspace_id=$1`, workspaceID); err != nil {
		t.Fatalf("clear Workspace quota: %v", err)
	}
	if response := authedRequest(t, app, adminToken, http.MethodPost, base+"/"+workspaceFileID+"/restore", nil); response.Code != http.StatusOK {
		t.Fatalf("restore Workspace file = %d: %s", response.Code, response.Body.String())
	}
	if err := app.db.QueryRow(t.Context(), `SELECT quota_used_bytes FROM workspace_storage_accounts WHERE workspace_id=$1`, workspaceID).Scan(&workspaceQuotaUsed); err != nil || workspaceQuotaUsed != 5 {
		t.Fatalf("restore did not recharge quota: used=%d err=%v", workspaceQuotaUsed, err)
	}
	if response := authedRequest(t, app, adminToken, http.MethodDelete, base+"/"+workspaceFileID, nil); response.Code != http.StatusOK {
		t.Fatalf("re-delete Workspace file = %d: %s", response.Code, response.Body.String())
	}
	if response := authedRequest(t, app, memberToken, http.MethodGet, base+"/trash?production_id=workspace", nil); response.Code != http.StatusForbidden {
		t.Fatalf("member workspace trash = %d, want 403", response.Code)
	}
	workspaceTrash := authedRequest(t, app, adminToken, http.MethodGet, base+"/trash?production_id=workspace", nil)
	if workspaceTrash.Code != http.StatusOK || !bytes.Contains(workspaceTrash.Body.Bytes(), []byte(workspaceFileID)) {
		t.Fatalf("admin workspace trash = %d: %s", workspaceTrash.Code, workspaceTrash.Body.String())
	}

	upload := productionBody["upload"].(map[string]any)
	signedFilePut(t, upload, "hello")
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
	signedFilePut(t, upload, "later")
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
	signedFilePut(t, versionUpload, "second")
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
	if _, err := storage.client.StatObject(t.Context(), objectstore.ObjectRef{Bucket: storage.bucket, Key: objectKey}); err != nil {
		t.Fatalf("soft-deleted object removed: %v", err)
	}
	t.Cleanup(func() {
		_ = storage.client.RemoveObject(context.Background(), objectstore.ObjectRef{Bucket: storage.bucket, Key: objectKey})
	})
	productionTrash := authedRequest(t, app, editorToken, http.MethodGet, base+"/trash?production_id="+productionID, nil)
	if productionTrash.Code != http.StatusOK || !bytes.Contains(productionTrash.Body.Bytes(), []byte(productionFileID)) {
		t.Fatalf("editor production trash = %d: %s", productionTrash.Code, productionTrash.Body.String())
	}
	if restored := authedRequest(t, app, editorToken, http.MethodPost, base+"/"+productionFileID+"/restore", nil); restored.Code != http.StatusOK {
		t.Fatalf("editor restore production file = %d: %s", restored.Code, restored.Body.String())
	}
	if deletedAgain := authedRequest(t, app, editorToken, http.MethodDelete, base+"/"+productionFileID, nil); deletedAgain.Code != http.StatusOK {
		t.Fatalf("editor re-delete production file = %d: %s", deletedAgain.Code, deletedAgain.Body.String())
	}
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

func TestMultipartUploadMinIOEnforcesPartChecksumsAndSettlesLedger(t *testing.T) {
	if os.Getenv("S3_ENDPOINT") == "" {
		t.Skip("S3_ENDPOINT not set; skipping MinIO multipart integration test")
	}
	app := newIntegrationApp(t)
	storage, err := newObjectStorage(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	app.storage = storage
	owner := createTestUser(t, app, "multipart-e2e-"+newID()+"@example.test")
	token := issueTestToken(t, app, owner)
	workspaceID := createWorkspaceFor(t, app, token, "分段上传集成测试")["id"].(string)
	base := "/v1/workspaces/" + workspaceID + "/files"
	const fileSize = 100_000_001
	created := authedRequest(t, app, token, http.MethodPost, base, map[string]any{
		"filename": "multipart.bin", "content_type": "application/octet-stream", "size_bytes": fileSize,
	})
	if created.Code != http.StatusCreated {
		t.Fatalf("create multipart session = %d: %s", created.Code, created.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(created.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	fileID := fileTestID(t, body)
	upload := body["upload"].(map[string]any)
	if upload["transport"] != "multipart" {
		t.Fatalf("upload transport = %v, want multipart", upload["transport"])
	}
	uploadID := upload["upload_id"].(string)
	var versionID string
	t.Cleanup(func() {
		cleanupCtx := context.Background()
		_, _ = app.db.Exec(cleanupCtx, `UPDATE file_scan_tasks SET status='completed',lease_owner='',lease_until=NULL,
			outcome='test_cleanup',completed_at=NOW(),updated_at=NOW() WHERE version_id IN (SELECT id FROM file_versions WHERE file_id=$1)`, fileID)
		for _, bucket := range []string{storage.bucket, storage.stagingBucket} {
			_ = storage.client.WalkObjects(cleanupCtx, bucket, "ws/"+workspaceID+"/", func(object objectstore.ObjectInfo) error {
				return storage.client.RemoveObject(cleanupCtx, objectstore.ObjectRef{Bucket: bucket, Key: object.Key})
			})
		}
		_, _ = app.db.Exec(cleanupCtx, `UPDATE file_versions SET object_purged_at=COALESCE(object_purged_at,NOW()),quota_charged=FALSE WHERE file_id=$1`, fileID)
		_, _ = app.db.Exec(cleanupCtx, `UPDATE file_upload_sessions SET object_purged_at=COALESCE(object_purged_at,NOW()) WHERE id=$1`, uploadID)
		_, _ = app.db.Exec(cleanupCtx, `UPDATE workspace_storage_reservations SET status='released',quota_reserved_bytes=0,quota_committed_bytes=0,physical_reserved_bytes=0 WHERE workspace_id=$1`, workspaceID)
		_, _ = app.db.Exec(cleanupCtx, `UPDATE workspace_storage_accounts SET quota_used_bytes=0,quota_reserved_bytes=0,physical_used_bytes=0,physical_reserved_bytes=0,physical_observed_bytes=NULL,physical_observed_at=NULL WHERE workspace_id=$1`, workspaceID)
	})
	partSize := int(upload["part_size"].(float64))
	payload := bytes.Repeat([]byte("A"), fileSize)
	shortPayload := []byte("too short")
	shortDigest := sha256.Sum256(shortPayload)
	shortSigned := authedRequest(t, app, token, http.MethodPost,
		"/v1/file-upload-sessions/"+uploadID+"/parts/1/url", map[string]any{"sha256": base64.StdEncoding.EncodeToString(shortDigest[:])})
	if shortSigned.Code != http.StatusOK {
		t.Fatalf("sign undersized part = %d: %s", shortSigned.Code, shortSigned.Body.String())
	}
	var shortDescriptor map[string]any
	if err := json.Unmarshal(shortSigned.Body.Bytes(), &shortDescriptor); err != nil {
		t.Fatal(err)
	}
	shortRequest, err := http.NewRequestWithContext(t.Context(), http.MethodPut, shortDescriptor["url"].(string), bytes.NewReader(shortPayload))
	if err != nil {
		t.Fatal(err)
	}
	for name, value := range shortDescriptor["headers"].(map[string]any) {
		shortRequest.Header.Set(name, value.(string))
	}
	shortResponse, err := http.DefaultClient.Do(shortRequest)
	if err != nil {
		t.Fatal(err)
	}
	shortResponse.Body.Close()
	if shortResponse.StatusCode >= 200 && shortResponse.StatusCode < 300 {
		t.Fatalf("undersized signed part unexpectedly accepted: %d", shortResponse.StatusCode)
	}
	for partNumber, start := 1, 0; start < len(payload); partNumber, start = partNumber+1, start+partSize {
		end := min(start+partSize, len(payload))
		chunk := payload[start:end]
		digest := sha256.Sum256(chunk)
		checksum := base64.StdEncoding.EncodeToString(digest[:])
		signed := authedRequest(t, app, token, http.MethodPost,
			"/v1/file-upload-sessions/"+uploadID+"/parts/"+strconv.Itoa(partNumber)+"/url", map[string]any{"sha256": checksum})
		if signed.Code != http.StatusOK {
			t.Fatalf("sign part %d = %d: %s", partNumber, signed.Code, signed.Body.String())
		}
		var descriptor map[string]any
		if err := json.Unmarshal(signed.Body.Bytes(), &descriptor); err != nil {
			t.Fatal(err)
		}
		req, err := http.NewRequestWithContext(t.Context(), http.MethodPut, descriptor["url"].(string), bytes.NewReader(chunk))
		if err != nil {
			t.Fatal(err)
		}
		for name, value := range descriptor["headers"].(map[string]any) {
			req.Header.Set(name, value.(string))
		}
		req.Header.Set("Content-Type", "application/octet-stream")
		response, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("upload part %d: %v", partNumber, err)
		}
		response.Body.Close()
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			t.Fatalf("upload part %d = %d", partNumber, response.StatusCode)
		}
	}
	parts := authedRequest(t, app, token, http.MethodGet, "/v1/file-upload-sessions/"+uploadID+"/parts", nil)
	if parts.Code != http.StatusOK || !bytes.Contains(parts.Body.Bytes(), []byte(`"total":2`)) {
		t.Fatalf("verified multipart parts = %d: %s", parts.Code, parts.Body.String())
	}
	completed := authedRequest(t, app, token, http.MethodPost, "/v1/file-upload-sessions/"+uploadID+"/complete", nil)
	if completed.Code != http.StatusAccepted {
		t.Fatalf("complete multipart upload = %d: %s", completed.Code, completed.Body.String())
	}
	versionID = attachmentResponse(t, completed.Body.Bytes())["version_id"].(string)
	var committedSize int64
	if err := app.db.QueryRow(t.Context(), `SELECT size_bytes FROM file_versions WHERE id=$1`, versionID).Scan(&committedSize); err != nil {
		t.Fatal(err)
	}
	var used, reserved, physicalReserved int64
	if err := app.db.QueryRow(t.Context(), `SELECT a.quota_used_bytes,a.quota_reserved_bytes,a.physical_reserved_bytes
		FROM workspace_storage_accounts a WHERE a.workspace_id=$1`, workspaceID).Scan(&used, &reserved, &physicalReserved); err != nil {
		t.Fatal(err)
	}
	if committedSize != fileSize || used != fileSize || reserved != 0 || physicalReserved != fileSize {
		t.Fatalf("settled storage ledger = used %d, quota reserved %d, physical reserved %d", used, reserved, physicalReserved)
	}
}
