package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/minio/minio-go/v7"
)

func TestNormalizeAvatarResizesAndReencodes(t *testing.T) {
	large := image.NewRGBA(image.Rect(0, 0, 1024, 256))
	for y := 0; y < 256; y++ {
		for x := 0; x < 1024; x++ {
			large.Set(x, y, color.RGBA{R: uint8(x % 255), G: uint8(y % 255), A: 255})
		}
	}
	var jpegInput bytes.Buffer
	if err := jpeg.Encode(&jpegInput, large, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatal(err)
	}
	jpegOutput, contentType, extension, err := normalizeAvatar(jpegInput.Bytes())
	if err != nil {
		t.Fatalf("normalize JPEG: %v", err)
	}
	if contentType != "image/jpeg" || extension != "jpg" {
		t.Fatalf("JPEG output type = %q / %q", contentType, extension)
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(jpegOutput))
	if err != nil || format != "jpeg" || config.Width != 512 || config.Height != 128 {
		t.Fatalf("JPEG output config = %#v format=%q err=%v", config, format, err)
	}

	var pngInput bytes.Buffer
	if err := png.Encode(&pngInput, image.NewNRGBA(image.Rect(0, 0, 64, 32))); err != nil {
		t.Fatal(err)
	}
	pngOutput, contentType, extension, err := normalizeAvatar(pngInput.Bytes())
	if err != nil {
		t.Fatalf("normalize PNG: %v", err)
	}
	if contentType != "image/png" || extension != "png" {
		t.Fatalf("PNG output type = %q / %q", contentType, extension)
	}
	if _, format, err := image.Decode(bytes.NewReader(pngOutput)); err != nil || format != "png" {
		t.Fatalf("PNG output decode format=%q err=%v", format, err)
	}
}

func TestNormalizeAvatarAcceptsStaticWebP(t *testing.T) {
	data, err := base64.StdEncoding.DecodeString("UklGRhwAAABXRUJQVlA4TA8AAAAvA8AAAAcQ9Y/+ByKi/wEA")
	if err != nil {
		t.Fatal(err)
	}
	output, contentType, extension, err := normalizeAvatar(data)
	if err != nil {
		t.Fatalf("normalize WebP: %v", err)
	}
	if contentType != "image/png" || extension != "png" {
		t.Fatalf("WebP normalized type = %q / %q", contentType, extension)
	}
	if _, format, err := image.Decode(bytes.NewReader(output)); err != nil || format != "png" {
		t.Fatalf("normalized WebP output format=%q err=%v", format, err)
	}
}

func TestNormalizeAvatarRejectsUnsafeImages(t *testing.T) {
	if _, _, _, err := normalizeAvatar([]byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`)); err == nil {
		t.Fatal("SVG should be rejected")
	}
	animatedPNG := append([]byte{137, 80, 78, 71, 13, 10, 26, 10}, 0, 0, 0, 0, 'a', 'c', 'T', 'L', 0, 0, 0, 0)
	if _, _, _, err := normalizeAvatar(animatedPNG); err == nil || !strings.Contains(err.Error(), "动画") {
		t.Fatalf("animated PNG error = %v", err)
	}
	animatedWebP := []byte{'R', 'I', 'F', 'F', 16, 0, 0, 0, 'W', 'E', 'B', 'P', 'A', 'N', 'I', 'M', 0, 0, 0, 0}
	if _, _, _, err := normalizeAvatar(animatedWebP); err == nil || !strings.Contains(err.Error(), "动画") {
		t.Fatalf("animated WebP error = %v", err)
	}
}

func TestManagedAvatarURLPrefersPrivateRouteAndKeepsLegacy(t *testing.T) {
	if got := managedAvatarURL("user-1", "user-avatars/user-1/a.png", "revision-1", "https://legacy.example/avatar.png"); got != "/v1/users/user-1/avatar?v=revision-1" {
		t.Fatalf("managed avatar URL = %q", got)
	}
	if got := managedAvatarURL("user-1", "", "", "https://legacy.example/avatar.png"); got != "https://legacy.example/avatar.png" {
		t.Fatalf("legacy avatar URL = %q", got)
	}
}

func TestProfileAvatarAuthorizationAndCompatibility(t *testing.T) {
	app := newIntegrationApp(t)
	owner := createTestUser(t, app, "avatar-owner-"+newID()+"@example.test")
	member := createTestUser(t, app, "avatar-member-"+newID()+"@example.test")
	outsider := createTestUser(t, app, "avatar-outsider-"+newID()+"@example.test")
	editor := createTestUser(t, app, "avatar-editor-"+newID()+"@example.test")
	ownerToken := issueTestToken(t, app, owner)
	memberToken := issueTestToken(t, app, member)
	outsiderToken := issueTestToken(t, app, outsider)
	editorToken := issueTestToken(t, app, editor)
	workspaceID := createWorkspaceFor(t, app, ownerToken, "头像访问工作空间")["id"].(string)
	if _, err := app.db.Exec(t.Context(), `INSERT INTO workspace_memberships(id,workspace_id,user_id,role,status) VALUES($1,$2,$3,'member','active')`, newID(), workspaceID, member); err != nil {
		t.Fatal(err)
	}
	productionID := createProductionFor(t, app, ownerToken, workspaceID, "头像访问活动", "", "")["id"].(string)
	if _, err := app.db.Exec(t.Context(), `INSERT INTO production_memberships(id,production_id,user_id,role_key,status) VALUES($1,$2,$3,'editor','active')`, newID(), productionID, editor); err != nil {
		t.Fatal(err)
	}
	if _, err := app.db.Exec(t.Context(), `UPDATE users SET avatar_url='https://legacy.example/avatar.png',avatar_object_key='',avatar_revision='' WHERE id=$1`, owner); err != nil {
		t.Fatal(err)
	}
	me := authedRequest(t, app, ownerToken, http.MethodGet, "/me", nil)
	if me.Code != http.StatusOK || !strings.Contains(me.Body.String(), `"avatar_url":"https://legacy.example/avatar.png"`) {
		t.Fatalf("legacy /me avatar = %d %s", me.Code, me.Body.String())
	}
	patchAvatar := authedRequest(t, app, ownerToken, http.MethodPatch, "/me", map[string]string{"avatar_url": "https://attacker.example/avatar.png"})
	if patchAvatar.Code != http.StatusBadRequest {
		t.Fatalf("PATCH /me avatar_url = %d, want 400: %s", patchAvatar.Code, patchAvatar.Body.String())
	}
	if _, err := app.db.Exec(t.Context(), `UPDATE users SET avatar_object_key=$1,avatar_revision='revision-1' WHERE id=$2`, "user-avatars/"+owner+"/revision-1.png", owner); err != nil {
		t.Fatal(err)
	}
	managedMe := authedRequest(t, app, ownerToken, http.MethodGet, "/me", nil)
	var meBody map[string]any
	if err := json.Unmarshal(managedMe.Body.Bytes(), &meBody); err != nil {
		t.Fatal(err)
	}
	avatarPath, ok := meBody["avatar_url"].(string)
	if !ok || avatarPath != "/v1/users/"+owner+"/avatar?v=revision-1" {
		t.Fatalf("managed /me avatar_url = %#v", meBody["avatar_url"])
	}

	// With storage deliberately absent, authorized requests reach the storage
	// check (503); unrelated users receive 404 before storage is consulted.
	for _, fixture := range []struct {
		name  string
		token string
		want  int
	}{{"self", ownerToken, http.StatusServiceUnavailable}, {"workspace member", memberToken, http.StatusServiceUnavailable}, {"production roster editor", editorToken, http.StatusServiceUnavailable}, {"unrelated user", outsiderToken, http.StatusNotFound}} {
		t.Run(fixture.name, func(t *testing.T) {
			response := authedRequest(t, app, fixture.token, http.MethodGet, avatarPath, nil)
			if response.Code != fixture.want {
				t.Fatalf("avatar read status = %d, want %d: %s", response.Code, fixture.want, response.Body.String())
			}
		})
	}

	listed := authedRequest(t, app, ownerToken, http.MethodGet, "/v1/workspaces/"+workspaceID+"/members", nil)
	if listed.Code != http.StatusOK || !strings.Contains(listed.Body.String(), avatarPath) {
		t.Fatalf("workspace member avatar path = %d %s", listed.Code, listed.Body.String())
	}
	productionMembers := authedRequest(t, app, editorToken, http.MethodGet, "/v1/productions/"+productionID+"/members", nil)
	if productionMembers.Code != http.StatusOK || !strings.Contains(productionMembers.Body.String(), avatarPath) {
		t.Fatalf("production member avatar path = %d %s", productionMembers.Code, productionMembers.Body.String())
	}
}

func TestGetUserAvatarRequiresAuthentication(t *testing.T) {
	app := newIntegrationApp(t)
	response := httptest.NewRecorder()
	app.routes().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/users/some-user/avatar", nil))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous avatar read = %d, want 401", response.Code)
	}
}

func TestProfileAvatarUploadReplaceAndRemove(t *testing.T) {
	if os.Getenv("S3_ENDPOINT") == "" {
		t.Skip("S3_ENDPOINT not set; skipping avatar object-storage integration test")
	}
	app := newIntegrationApp(t)
	storage, err := newObjectStorage(t.Context())
	if err != nil {
		t.Fatalf("create object storage client: %v", err)
	}
	app.storage = storage
	userID := createTestUser(t, app, "avatar-storage-"+newID()+"@example.test")
	token := issueTestToken(t, app, userID)

	firstImage := testAvatarPNG(t, 96, 64)
	first := avatarUploadRequest(t, app, token, firstImage, "first.png")
	if first.Code != http.StatusOK {
		t.Fatalf("upload avatar = %d: %s", first.Code, first.Body.String())
	}
	var firstUser user
	if err := json.Unmarshal(first.Body.Bytes(), &firstUser); err != nil {
		t.Fatalf("decode uploaded user: %v", err)
	}
	if firstUser.AvatarURL == "" || !strings.Contains(firstUser.AvatarURL, "/v1/users/"+userID+"/avatar?v=") {
		t.Fatalf("uploaded avatar URL = %q", firstUser.AvatarURL)
	}
	var firstKey string
	if err := app.db.QueryRow(t.Context(), `SELECT avatar_object_key FROM users WHERE id=$1`, userID).Scan(&firstKey); err != nil {
		t.Fatal(err)
	}
	readFirst := authedRequest(t, app, token, http.MethodGet, firstUser.AvatarURL, nil)
	if readFirst.Code != http.StatusOK || readFirst.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("read uploaded avatar = %d, content-type=%q body=%q", readFirst.Code, readFirst.Header().Get("Content-Type"), readFirst.Body.String())
	}
	if _, format, err := image.Decode(bytes.NewReader(readFirst.Body.Bytes())); err != nil || format != "png" {
		t.Fatalf("stored avatar decode format=%q err=%v", format, err)
	}

	secondImage := testAvatarJPEG(t, 80, 80)
	second := avatarUploadRequest(t, app, token, secondImage, "second.jpg")
	if second.Code != http.StatusOK {
		t.Fatalf("replace avatar = %d: %s", second.Code, second.Body.String())
	}
	var secondUser user
	if err := json.Unmarshal(second.Body.Bytes(), &secondUser); err != nil {
		t.Fatalf("decode replaced user: %v", err)
	}
	var secondKey string
	if err := app.db.QueryRow(t.Context(), `SELECT avatar_object_key FROM users WHERE id=$1`, userID).Scan(&secondKey); err != nil {
		t.Fatal(err)
	}
	if firstKey == secondKey || !strings.Contains(secondUser.AvatarURL, "v=") {
		t.Fatalf("avatar replacement keys/url = %q / %q", secondKey, secondUser.AvatarURL)
	}
	if _, err := storage.client.StatObject(t.Context(), storage.bucket, firstKey, minio.StatObjectOptions{}); minio.ToErrorResponse(err).Code != "NoSuchKey" {
		t.Fatalf("old avatar object should be removed, stat error = %v", err)
	}

	invalid := avatarUploadRequest(t, app, token, []byte(`<svg/>`), "bad.svg")
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("invalid avatar upload = %d, want 400: %s", invalid.Code, invalid.Body.String())
	}
	var keyAfterInvalid string
	if err := app.db.QueryRow(t.Context(), `SELECT avatar_object_key FROM users WHERE id=$1`, userID).Scan(&keyAfterInvalid); err != nil || keyAfterInvalid != secondKey {
		t.Fatalf("invalid upload changed current avatar key to %q: %v", keyAfterInvalid, err)
	}

	removed := authedRequest(t, app, token, http.MethodDelete, "/v1/me/avatar", nil)
	if removed.Code != http.StatusOK || !strings.Contains(removed.Body.String(), `"avatar_url":""`) {
		t.Fatalf("remove avatar = %d: %s", removed.Code, removed.Body.String())
	}
	if _, err := storage.client.StatObject(t.Context(), storage.bucket, secondKey, minio.StatObjectOptions{}); minio.ToErrorResponse(err).Code != "NoSuchKey" {
		t.Fatalf("removed avatar object should be deleted, stat error = %v", err)
	}
	if response := authedRequest(t, app, token, http.MethodGet, secondUser.AvatarURL, nil); response.Code != http.StatusNotFound {
		t.Fatalf("read removed avatar = %d, want 404", response.Code)
	}
}

func avatarUploadRequest(t *testing.T, app *application, token string, data []byte, filename string) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("avatar", filename)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPut, "/v1/me/avatar", &body)
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	recorder := httptest.NewRecorder()
	app.routes().ServeHTTP(recorder, request)
	return recorder
}

func testAvatarPNG(t *testing.T, width, height int) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, color.NRGBA{R: uint8(x), G: uint8(y), B: 170, A: 255})
		}
	}
	var data bytes.Buffer
	if err := png.Encode(&data, img); err != nil {
		t.Fatal(err)
	}
	return data.Bytes()
}

func testAvatarJPEG(t *testing.T, width, height int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x), G: uint8(y), B: 90, A: 255})
		}
	}
	var data bytes.Buffer
	if err := jpeg.Encode(&data, img, nil); err != nil {
		t.Fatal(err)
	}
	return data.Bytes()
}
