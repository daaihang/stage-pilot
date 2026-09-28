package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"testing"
	"time"
)

func attachmentResponse(t *testing.T, body []byte) map[string]any {
	t.Helper()
	var result map[string]any
	if err := json.Unmarshal(body, &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func signedFilePut(t *testing.T, rawURL, contents string) {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), http.MethodPut, rawURL, bytes.NewBufferString(contents))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "text/plain")
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatalf("signed PUT = %d", response.StatusCode)
	}
}

func signedFileRead(t *testing.T, rawURL string) string {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, rawURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatalf("signed GET = %d", response.StatusCode)
	}
	data, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestProgramAttachmentsVersioningAndCopyAuthorization(t *testing.T) {
	if os.Getenv("S3_ENDPOINT") == "" {
		t.Skip("S3_ENDPOINT not set")
	}
	app := newIntegrationApp(t)
	storage, err := newObjectStorage(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	app.storage = storage
	owner := createTestUser(t, app, "attach-owner-"+newID()+"@example.test")
	member := createTestUser(t, app, "attach-member-"+newID()+"@example.test")
	producer := createTestUser(t, app, "attach-producer-"+newID()+"@example.test")
	editor := createTestUser(t, app, "attach-editor-"+newID()+"@example.test")
	ownerToken := issueTestToken(t, app, owner)
	memberToken := issueTestToken(t, app, member)
	producerToken := issueTestToken(t, app, producer)
	editorToken := issueTestToken(t, app, editor)
	workspaceID := createWorkspaceFor(t, app, ownerToken, "附件节目测试")["id"].(string)
	productionA := createProductionFor(t, app, ownerToken, workspaceID, "附件活动A", "", "")["id"].(string)
	productionB := createProductionFor(t, app, ownerToken, workspaceID, "附件活动B", "", "")["id"].(string)
	programID, activityA, activityB := newID(), newID(), newID()
	var programTypeID string
	if err := app.db.QueryRow(t.Context(), `SELECT id FROM program_types WHERE workspace_id=$1 ORDER BY sort_order LIMIT 1`, workspaceID).Scan(&programTypeID); err != nil {
		t.Fatal(err)
	}
	if _, err := app.db.Exec(t.Context(), `INSERT INTO programs(id,workspace_id,name,program_type_id,created_by) VALUES($1,$2,'附件节目',$3,$4)`, programID, workspaceID, programTypeID, owner); err != nil {
		t.Fatal(err)
	}
	for _, p := range []struct{ id, production string }{{activityA, productionA}, {activityB, productionB}} {
		if _, err := app.db.Exec(t.Context(), `INSERT INTO production_programs(id,workspace_id,production_id,workspace_program_id,name,created_by) VALUES($1,$2,$3,$4,'活动节目',$5)`, p.id, workspaceID, p.production, programID, owner); err != nil {
			t.Fatal(err)
		}
	}
	for _, m := range []struct{ user, role string }{{producer, "producer"}, {editor, "editor"}} {
		if _, err := app.db.Exec(t.Context(), `INSERT INTO production_memberships(id,production_id,user_id,role_key,status) VALUES($1,$2,$3,$4,'active')`, newID(), productionA, m.user, m.role); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := app.db.Exec(t.Context(), `INSERT INTO workspace_memberships(id,workspace_id,user_id,role,status) VALUES($1,$2,$3,'member','active')`, newID(), workspaceID, member); err != nil {
		t.Fatal(err)
	}
	var rightsID string
	if err := app.db.QueryRow(t.Context(), `SELECT id FROM file_types WHERE workspace_id=$1 AND template_key='program.rights' AND deleted_at IS NULL`, workspaceID).Scan(&rightsID); err != nil {
		t.Fatal(err)
	}
	programURL := "/v1/workspaces/" + workspaceID + "/programs/" + programID + "/attachments"
	otherWorkspace := createWorkspaceFor(t, app, ownerToken, "其他工作空间")
	if response := authedRequest(t, app, ownerToken, http.MethodGet, "/v1/workspaces/"+otherWorkspace["id"].(string)+"/programs/"+programID+"/attachments", nil); response.Code != 404 {
		t.Fatalf("cross-workspace parent spoofing = %d", response.Code)
	}
	if response := authedRequest(t, app, ownerToken, http.MethodGet, "/v1/productions/"+productionB+"/programs/"+activityA+"/attachments", nil); response.Code != 404 {
		t.Fatalf("cross-production parent spoofing = %d", response.Code)
	}
	created := authedRequest(t, app, ownerToken, http.MethodPost, programURL, map[string]any{"filename": "rights.txt", "content_type": "text/plain", "size_bytes": 5, "file_type_id": rightsID})
	if created.Code != 201 {
		t.Fatalf("create rights attachment = %d: %s", created.Code, created.Body.String())
	}
	creation := attachmentResponse(t, created.Body.Bytes())
	attachmentID := creation["attachment_id"].(string)
	fileID := creation["file_id"].(string)
	upload := creation["upload"].(map[string]any)
	signedFilePut(t, upload["url"].(string), "first")
	completeURL := "/v1/file-upload-sessions/" + upload["upload_id"].(string) + "/complete"
	if response := authedRequest(t, app, memberToken, http.MethodPost, completeURL, nil); response.Code != 404 {
		t.Fatalf("non-uploader completed upload = %d", response.Code)
	}
	completed := authedRequest(t, app, ownerToken, http.MethodPost, completeURL, nil)
	if completed.Code != http.StatusAccepted {
		t.Fatalf("complete rights attachment = %d: %s", completed.Code, completed.Body.String())
	}
	firstVersion := attachmentResponse(t, completed.Body.Bytes())["version_id"].(string)
	if response := authedRequest(t, app, ownerToken, http.MethodPost, completeURL, nil); response.Code != http.StatusAccepted {
		t.Fatalf("idempotent complete = %d", response.Code)
	}
	if response := authedRequest(t, app, memberToken, http.MethodGet, programURL, nil); response.Code != 200 || bytes.Contains(response.Body.Bytes(), []byte(attachmentID)) {
		t.Fatalf("member saw restricted attachment: %d %s", response.Code, response.Body.String())
	}
	if response := authedRequest(t, app, memberToken, http.MethodGet, "/v1/workspaces/"+workspaceID+"/files?production_id=workspace", nil); response.Code != 200 || bytes.Contains(response.Body.Bytes(), []byte(fileID)) {
		t.Fatalf("library leaked attached file: %d %s", response.Code, response.Body.String())
	}
	if response := authedRequest(t, app, ownerToken, http.MethodGet, "/v1/workspaces/"+workspaceID+"/files/"+fileID+"/download", nil); response.Code != 404 {
		t.Fatalf("old file URL reached attachment = %d", response.Code)
	}
	if response := authedRequest(t, app, memberToken, http.MethodGet, "/v1/attachments/"+attachmentID+"/download", nil); response.Code != 404 {
		t.Fatalf("member rights download = %d", response.Code)
	}
	if response := authedRequest(t, app, ownerToken, http.MethodGet, "/v1/attachments/"+attachmentID+"/download?version_id="+newID(), nil); response.Code != 404 {
		t.Fatalf("unrelated historical version = %d", response.Code)
	}
	if response := authedRequest(t, app, ownerToken, http.MethodGet, "/v1/attachments/"+attachmentID+"/download?version_id="+firstVersion, nil); response.Code != 404 {
		t.Fatalf("unscanned attachment version download = %d", response.Code)
	}
	markFileVersionClean(t, app, fileID, firstVersion)
	firstDownload := authedRequest(t, app, ownerToken, http.MethodGet, "/v1/attachments/"+attachmentID+"/download?version_id="+firstVersion, nil)
	if firstDownload.Code != 200 {
		t.Fatalf("version download = %d", firstDownload.Code)
	}
	firstURL := attachmentResponse(t, firstDownload.Body.Bytes())["url"].(string)
	signedFilePut(t, upload["url"].(string), "later")
	if got := signedFileRead(t, firstURL); got != "first" {
		t.Fatalf("staging overwrite changed committed version: %q", got)
	}
	newVersion := authedRequest(t, app, ownerToken, http.MethodPost, "/v1/attachments/"+attachmentID+"/versions", map[string]any{"filename": "rights-v2.txt", "content_type": "text/plain", "size_bytes": 6})
	if newVersion.Code != 201 {
		t.Fatalf("start version = %d: %s", newVersion.Code, newVersion.Body.String())
	}
	newUpload := attachmentResponse(t, newVersion.Body.Bytes())["upload"].(map[string]any)
	signedFilePut(t, newUpload["url"].(string), "second")
	v2Complete := authedRequest(t, app, ownerToken, http.MethodPost, "/v1/file-upload-sessions/"+newUpload["upload_id"].(string)+"/complete", nil)
	if v2Complete.Code != http.StatusAccepted {
		t.Fatalf("complete v2 = %d: %s", v2Complete.Code, v2Complete.Body.String())
	}
	v2 := attachmentResponse(t, v2Complete.Body.Bytes())["version_id"].(string)
	if response := authedRequest(t, app, ownerToken, http.MethodGet, "/v1/attachments/"+attachmentID+"/download", nil); response.Code != 200 {
		t.Fatalf("previous clean attachment unavailable during scan = %d", response.Code)
	}
	if response := authedRequest(t, app, ownerToken, http.MethodGet, "/v1/attachments/"+attachmentID+"/download?version_id="+v2, nil); response.Code != 404 {
		t.Fatalf("unscanned v2 download = %d", response.Code)
	}
	markFileVersionClean(t, app, fileID, v2)
	if response := authedRequest(t, app, ownerToken, http.MethodGet, "/v1/attachments/"+attachmentID+"/versions", nil); response.Code != 200 || !bytes.Contains(response.Body.Bytes(), []byte(`"version_no":2`)) {
		t.Fatalf("history missing v2: %d %s", response.Code, response.Body.String())
	}
	standard := authedRequest(t, app, ownerToken, http.MethodPost, programURL, map[string]any{"filename": "notes.txt", "content_type": "text/plain", "size_bytes": 5})
	if standard.Code != 201 {
		t.Fatalf("create ordinary attachment = %d: %s", standard.Code, standard.Body.String())
	}
	standardUpload := attachmentResponse(t, standard.Body.Bytes())["upload"].(map[string]any)
	signedFilePut(t, standardUpload["url"].(string), "notes")
	standardComplete := authedRequest(t, app, ownerToken, http.MethodPost, "/v1/file-upload-sessions/"+standardUpload["upload_id"].(string)+"/complete", nil)
	if standardComplete.Code != http.StatusAccepted {
		t.Fatalf("complete ordinary attachment = %d", standardComplete.Code)
	}
	standardBody := attachmentResponse(t, standard.Body.Bytes())
	standardID := standardBody["attachment_id"].(string)
	markFileVersionClean(t, app, standardBody["file_id"].(string), attachmentResponse(t, standardComplete.Body.Bytes())["version_id"].(string))
	if response := authedRequest(t, app, memberToken, http.MethodGet, programURL, nil); response.Code != 200 || !bytes.Contains(response.Body.Bytes(), []byte(standardID)) {
		t.Fatalf("workspace member could not see ordinary attachment: %d %s", response.Code, response.Body.String())
	}
	copyURLA := "/v1/productions/" + productionA + "/programs/" + activityA + "/attachments/copy"
	if response := authedRequest(t, app, memberToken, http.MethodPost, copyURLA, map[string]any{"attachment_id": standardID}); response.Code != 404 {
		t.Fatalf("missing target write restriction did not block copy = %d", response.Code)
	}
	if response := authedRequest(t, app, editorToken, http.MethodPost, copyURLA, map[string]any{"attachment_id": attachmentID, "version_id": firstVersion}); response.Code != 404 {
		t.Fatalf("source read restriction did not block copy = %d", response.Code)
	}
	copyA := authedRequest(t, app, ownerToken, http.MethodPost, copyURLA, map[string]any{"attachment_id": attachmentID, "version_id": firstVersion})
	if copyA.Code != http.StatusAccepted {
		t.Fatalf("copy activity A = %d: %s", copyA.Code, copyA.Body.String())
	}
	copyABody := attachmentResponse(t, copyA.Body.Bytes())
	copyAttachmentID := copyABody["attachment_id"].(string)
	if response := authedRequest(t, app, producerToken, http.MethodGet, "/v1/attachments/"+copyAttachmentID+"/download", nil); response.Code != 404 {
		t.Fatalf("unscanned copied attachment download = %d", response.Code)
	}
	markFileVersionClean(t, app, copyABody["file_id"].(string), copyABody["version_id"].(string))
	if response := authedRequest(t, app, producerToken, http.MethodGet, "/v1/attachments/"+copyAttachmentID+"/download", nil); response.Code != 200 {
		t.Fatalf("direct producer rights download = %d", response.Code)
	}
	if response := authedRequest(t, app, editorToken, http.MethodGet, "/v1/attachments/"+copyAttachmentID+"/download", nil); response.Code != 404 {
		t.Fatalf("editor rights download = %d", response.Code)
	}
	if response := authedRequest(t, app, editorToken, http.MethodGet, "/v1/productions/"+productionA+"/programs/"+activityA+"/attachments", nil); response.Code != 200 || bytes.Contains(response.Body.Bytes(), []byte(copyAttachmentID)) {
		t.Fatalf("editor saw sensitive metadata: %d %s", response.Code, response.Body.String())
	}
	copyURLB := "/v1/productions/" + productionB + "/programs/" + activityB + "/attachments/copy"
	copyB := authedRequest(t, app, ownerToken, http.MethodPost, copyURLB, map[string]any{"attachment_id": attachmentID, "version_id": firstVersion})
	if copyB.Code != http.StatusAccepted {
		t.Fatalf("copy activity B = %d: %s", copyB.Code, copyB.Body.String())
	}
	copyBBody := attachmentResponse(t, copyB.Body.Bytes())
	copyBID := copyBBody["attachment_id"].(string)
	markFileVersionClean(t, app, copyBBody["file_id"].(string), copyBBody["version_id"].(string))
	if response := authedRequest(t, app, producerToken, http.MethodGet, "/v1/attachments/"+copyBID+"/download", nil); response.Code != 404 {
		t.Fatalf("activity A producer accessed activity B copy = %d", response.Code)
	}
	if _, err := app.db.Exec(t.Context(), `UPDATE production_memberships SET status='suspended' WHERE production_id=$1 AND user_id=$2`, productionA, producer); err != nil {
		t.Fatal(err)
	}
	if response := authedRequest(t, app, producerToken, http.MethodGet, "/v1/attachments/"+copyAttachmentID+"/download", nil); response.Code != 404 {
		t.Fatalf("suspended producer accessed rights = %d", response.Code)
	}
	if _, err := app.db.Exec(t.Context(), `UPDATE production_memberships SET status='active',expires_at=$3 WHERE production_id=$1 AND user_id=$2`, productionA, producer, time.Now().Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	if response := authedRequest(t, app, producerToken, http.MethodGet, "/v1/attachments/"+copyAttachmentID+"/download", nil); response.Code != 404 {
		t.Fatalf("expired producer accessed rights = %d", response.Code)
	}
	if _, err := app.db.Exec(t.Context(), `UPDATE production_memberships SET expires_at=NULL WHERE production_id=$1 AND user_id=$2`, productionA, producer); err != nil {
		t.Fatal(err)
	}
	copyDownload := authedRequest(t, app, ownerToken, http.MethodGet, "/v1/attachments/"+copyAttachmentID+"/download", nil)
	if got := signedFileRead(t, attachmentResponse(t, copyDownload.Body.Bytes())["url"].(string)); got != "first" {
		t.Fatalf("activity copy followed source latest: %q", got)
	}
	if response := authedRequest(t, app, ownerToken, http.MethodDelete, "/v1/attachments/"+attachmentID, nil); response.Code != 200 {
		t.Fatalf("detach source = %d", response.Code)
	}
	if response := authedRequest(t, app, ownerToken, http.MethodGet, "/v1/attachments/"+attachmentID+"/download", nil); response.Code != 404 {
		t.Fatalf("detached source still downloadable = %d", response.Code)
	}
	if response := authedRequest(t, app, producerToken, http.MethodGet, "/v1/attachments/"+copyAttachmentID+"/download", nil); response.Code != 200 {
		t.Fatalf("activity copy lost after source detach = %d", response.Code)
	}
}
