package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/argon2"
)

const accessLifetime = 15 * time.Minute
const refreshLifetime = 30 * 24 * time.Hour

type application struct {
	db                      *pgxpool.Pool
	logger                  *slog.Logger
	jwtSecret               []byte
	invitationHashKey       []byte
	invitationEncryptionKey []byte
	exposeDevTokens         bool
	rateMu                  sync.Mutex
	rate                    map[string]rateEntry
	storage                 *objectStorage
}
type rateEntry struct {
	started time.Time
	count   int
}
type authClaims struct {
	SessionID string `json:"sid"`
	jwt.RegisteredClaims
}
type contextKey string

const claimsKey contextKey = "stagepilot.auth.claims"

type user struct {
	ID            string    `json:"id"`
	Email         string    `json:"email"`
	EmailVerified bool      `json:"email_verified"`
	DisplayName   string    `json:"display_name"`
	Username      *string   `json:"username,omitempty"`
	AvatarURL     string    `json:"avatar_url"`
	Status        string    `json:"status"`
	CreatedAt     time.Time `json:"created_at"`
}
type credentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}
type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
	User         user   `json:"user"`
	DebugToken   string `json:"debug_token,omitempty"`
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	databaseURL := envOrDefault("DATABASE_URL", "postgres://stagepilot:stagepilot@localhost:15432/stagepilot?sslmode=disable")
	port := envOrDefault("PORT", "8080")
	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		logger.Error("create database pool", "error", err)
		os.Exit(1)
	}
	defer pool.Close()
	storage, storageErr := newObjectStorage(context.Background())
	if storageErr != nil {
		logger.Warn("object storage unavailable", "error", storageErr)
	}
	jwtSecret := []byte(envOrDefault("AUTH_JWT_SECRET", "stagepilot-development-secret-change-me"))
	hashKey := []byte(envOrDefault("INVITATION_CODE_HASH_KEY", string(jwtSecret)))
	encryptionKey := []byte(envOrDefault("INVITATION_CODE_ENCRYPTION_KEY", string(jwtSecret)))
	if len(hashKey) < 32 || len(encryptionKey) < 32 {
		logger.Error("invitation code keys must be at least 32 bytes")
		os.Exit(1)
	}
	app := application{db: pool, logger: logger, jwtSecret: jwtSecret, invitationHashKey: hashKey, invitationEncryptionKey: encryptionKey, exposeDevTokens: os.Getenv("AUTH_EXPOSE_DEV_TOKENS") == "true", rate: make(map[string]rateEntry), storage: storage}
	server := &http.Server{Addr: ":" + port, Handler: requestLogger(logger, corsMiddleware(allowedOrigins())(app.routes())), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second}
	shutdownContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-shutdownContext.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}()
	logger.Info("api listening", "address", server.Addr)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Error("serve api", "error", err)
		os.Exit(1)
	}
}

func (app *application) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", app.health)
	mux.HandleFunc("GET /readyz", app.ready)
	mux.HandleFunc("POST /internal/storage/audit", app.ingestStorageAuditEvent)
	mux.HandleFunc("POST /auth/register", app.register)
	mux.HandleFunc("POST /auth/login", app.login)
	mux.HandleFunc("POST /auth/refresh", app.refresh)
	mux.HandleFunc("POST /auth/logout", app.logout)
	mux.Handle("POST /auth/logout-all", app.auth(http.HandlerFunc(app.logoutAll)))
	mux.HandleFunc("POST /auth/email/verify", app.verifyEmail)
	mux.HandleFunc("POST /auth/password/forgot", app.forgotPassword)
	mux.HandleFunc("POST /auth/password/reset", app.resetPassword)
	mux.Handle("GET /me", app.auth(http.HandlerFunc(app.me)))
	mux.Handle("PATCH /me", app.auth(http.HandlerFunc(app.updateMe)))
	mux.Handle("PUT /v1/me/avatar", app.auth(http.HandlerFunc(app.updateMyAvatar)))
	mux.Handle("DELETE /v1/me/avatar", app.auth(http.HandlerFunc(app.deleteMyAvatar)))
	mux.Handle("GET /v1/users/{userId}/avatar", app.auth(http.HandlerFunc(app.getUserAvatar)))
	mux.Handle("GET /v1/me/workspace-storage", app.auth(http.HandlerFunc(app.listMyWorkspaceStorage)))
	mux.Handle("PATCH /me/password", app.auth(http.HandlerFunc(app.changePassword)))
	mux.Handle("GET /me/preferences", app.auth(http.HandlerFunc(app.preferences)))
	mux.Handle("PATCH /me/preferences", app.auth(http.HandlerFunc(app.updatePreferences)))
	// Workspace / Tenant Foundation：所有 workspace 作用域操作都要求
	// authenticated user + active workspace membership，禁止仅信 URL 参数。
	mux.Handle("POST /v1/workspaces", app.auth(http.HandlerFunc(app.createWorkspace)))
	mux.Handle("GET /v1/workspaces", app.auth(http.HandlerFunc(app.listWorkspaces)))
	mux.Handle("GET /v1/workspaces/{id}", app.auth(app.requireWorkspaceRole(workspaceRoleMember, http.HandlerFunc(app.getWorkspace))))
	mux.Handle("PATCH /v1/workspaces/{id}", app.auth(app.requireWorkspaceRole(workspaceRoleAdmin, http.HandlerFunc(app.updateWorkspace))))
	mux.Handle("GET /v1/workspaces/{id}/members", app.auth(app.requireWorkspaceRole(workspaceRoleMember, http.HandlerFunc(app.listWorkspaceMembers))))
	mux.Handle("PATCH /v1/workspaces/{id}/members/{memberId}", app.auth(app.requireWorkspaceRole(workspaceRoleAdmin, http.HandlerFunc(app.updateWorkspaceMember))))
	mux.Handle("DELETE /v1/workspaces/{id}/members/{memberId}", app.auth(app.requireWorkspaceRole(workspaceRoleAdmin, http.HandlerFunc(app.revokeWorkspaceMember))))
	mux.Handle("GET /v1/workspaces/{id}/invitations", app.auth(app.requireWorkspaceRole(workspaceRoleAdmin, http.HandlerFunc(app.listWorkspaceInvitations))))
	mux.Handle("POST /v1/workspaces/{id}/invitations", app.auth(app.requireWorkspaceRole(workspaceRoleAdmin, http.HandlerFunc(app.createWorkspaceInvitation))))
	mux.Handle("DELETE /v1/workspaces/{id}/invitations/{invitationId}", app.auth(app.requireWorkspaceRole(workspaceRoleAdmin, http.HandlerFunc(app.revokeWorkspaceInvitation))))
	mux.Handle("GET /v1/workspaces/{id}/invitations/{invitationId}/credential", app.auth(app.requireWorkspaceRole(workspaceRoleAdmin, http.HandlerFunc(app.getWorkspaceInvitationCredential))))
	mux.Handle("POST /v1/workspaces/{id}/invitations/{invitationId}/rotate", app.auth(app.requireWorkspaceRole(workspaceRoleAdmin, http.HandlerFunc(app.rotateWorkspaceInvitation))))
	mux.Handle("PUT /me/last-workspace", app.auth(http.HandlerFunc(app.putLastWorkspace)))
	mux.Handle("GET /me/last-workspace", app.auth(http.HandlerFunc(app.getLastWorkspace)))
	// Workspace resources. Read operations are available to every active
	// member; mutations require ADMIN or OWNER through the same workspace
	// membership boundary used by the workspace endpoints above.
	mux.Handle("GET /v1/workspaces/{id}/resource-types/{resourceType}", app.auth(app.requireWorkspaceRole(workspaceRoleMember, http.HandlerFunc(app.listResourceTypes))))
	mux.Handle("POST /v1/workspaces/{id}/resource-types/{resourceType}", app.auth(app.requireWorkspaceRole(workspaceRoleAdmin, http.HandlerFunc(app.createResourceType))))
	mux.Handle("PATCH /v1/workspaces/{id}/resource-types/{resourceType}/order", app.auth(app.requireWorkspaceRole(workspaceRoleAdmin, http.HandlerFunc(app.reorderResourceTypes))))
	mux.Handle("POST /v1/workspaces/{id}/resource-types/{resourceType}/restore", app.auth(app.requireWorkspaceRole(workspaceRoleAdmin, http.HandlerFunc(app.restoreResourceTypes))))
	mux.Handle("PATCH /v1/workspaces/{id}/resource-types/{resourceType}/{typeId}", app.auth(app.requireWorkspaceRole(workspaceRoleAdmin, http.HandlerFunc(app.updateResourceType))))
	mux.Handle("POST /v1/workspaces/{id}/resource-types/{resourceType}/{typeId}/delete", app.auth(app.requireWorkspaceRole(workspaceRoleAdmin, http.HandlerFunc(app.deleteResourceType))))
	mux.Handle("GET /v1/workspaces/{id}/file-types", app.auth(app.requireWorkspaceRole(workspaceRoleMember, http.HandlerFunc(app.listFileTypes))))
	mux.Handle("POST /v1/workspaces/{id}/file-types", app.auth(app.requireWorkspaceRole(workspaceRoleAdmin, http.HandlerFunc(app.createFileType))))
	mux.Handle("PATCH /v1/workspaces/{id}/file-types/{fileTypeId}", app.auth(app.requireWorkspaceRole(workspaceRoleAdmin, http.HandlerFunc(app.updateFileType))))
	mux.Handle("PATCH /v1/workspaces/{id}/file-types/order", app.auth(app.requireWorkspaceRole(workspaceRoleAdmin, http.HandlerFunc(app.reorderFileTypes))))
	mux.Handle("POST /v1/workspaces/{id}/file-types/{fileTypeId}/delete", app.auth(app.requireWorkspaceRole(workspaceRoleAdmin, http.HandlerFunc(app.deleteFileType))))
	mux.Handle("POST /v1/workspaces/{id}/file-types/restore", app.auth(app.requireWorkspaceRole(workspaceRoleAdmin, http.HandlerFunc(app.restoreFileTypes))))
	mux.Handle("POST /v1/workspaces/{id}/file-types/migrate", app.auth(app.requireWorkspaceRole(workspaceRoleAdmin, http.HandlerFunc(app.migrateFileTypes))))
	mux.Handle("GET /v1/workspaces/{id}/program-sheet-segment-types", app.auth(app.requireWorkspaceRole(workspaceRoleMember, http.HandlerFunc(app.listProgramSheetSegmentTypes))))
	mux.Handle("POST /v1/workspaces/{id}/program-sheet-segment-types", app.auth(app.requireWorkspaceRole(workspaceRoleAdmin, http.HandlerFunc(app.createProgramSheetSegmentType))))
	mux.Handle("PATCH /v1/workspaces/{id}/program-sheet-segment-types/{typeId}", app.auth(app.requireWorkspaceRole(workspaceRoleAdmin, http.HandlerFunc(app.updateProgramSheetSegmentType))))
	mux.Handle("PATCH /v1/workspaces/{id}/program-sheet-segment-types/order", app.auth(app.requireWorkspaceRole(workspaceRoleAdmin, http.HandlerFunc(app.reorderProgramSheetSegmentTypes))))
	mux.Handle("POST /v1/workspaces/{id}/program-sheet-segment-types/{typeId}/delete", app.auth(app.requireWorkspaceRole(workspaceRoleAdmin, http.HandlerFunc(app.deleteProgramSheetSegmentType))))
	mux.Handle("POST /v1/workspaces/{id}/program-sheet-segment-types/restore", app.auth(app.requireWorkspaceRole(workspaceRoleAdmin, http.HandlerFunc(app.restoreProgramSheetSegmentTypes))))
	mux.Handle("POST /v1/workspaces/{id}/program-sheet-segment-types/migrate", app.auth(app.requireWorkspaceRole(workspaceRoleAdmin, http.HandlerFunc(app.migrateProgramSheetSegmentTypes))))
	mux.Handle("GET /v1/workspaces/{id}/programs", app.auth(app.requireWorkspaceRole(workspaceRoleMember, http.HandlerFunc(app.listPrograms))))
	mux.Handle("POST /v1/workspaces/{id}/programs", app.auth(app.requireWorkspaceRole(workspaceRoleAdmin, http.HandlerFunc(app.createProgram))))
	mux.Handle("GET /v1/workspaces/{id}/programs/{programId}", app.auth(app.requireWorkspaceRole(workspaceRoleMember, http.HandlerFunc(app.getProgram))))
	mux.Handle("PATCH /v1/workspaces/{id}/programs/{programId}", app.auth(app.requireWorkspaceRole(workspaceRoleAdmin, http.HandlerFunc(app.updateProgram))))
	mux.Handle("DELETE /v1/workspaces/{id}/programs/{programId}", app.auth(app.requireWorkspaceRole(workspaceRoleAdmin, http.HandlerFunc(app.deleteProgram))))
	// The remaining resource handlers use the same workspace-scoped policy.
	for _, route := range []struct {
		method string
		path   string
		role   string
		handle http.HandlerFunc
	}{
		{"GET", "/v1/workspaces/{id}/people", workspaceRoleMember, app.listPeople},
		{"POST", "/v1/workspaces/{id}/people", workspaceRoleAdmin, app.createPerson},
		{"GET", "/v1/workspaces/{id}/people/{personId}", workspaceRoleMember, app.getPerson},
		{"PATCH", "/v1/workspaces/{id}/people/{personId}", workspaceRoleAdmin, app.updatePerson},
		{"DELETE", "/v1/workspaces/{id}/people/{personId}", workspaceRoleAdmin, app.deletePerson},
		{"GET", "/v1/workspaces/{id}/organizations", workspaceRoleMember, app.listOrganizations},
		{"POST", "/v1/workspaces/{id}/organizations", workspaceRoleAdmin, app.createOrganization},
		{"GET", "/v1/workspaces/{id}/organizations/{organizationId}", workspaceRoleMember, app.getOrganization},
		{"PATCH", "/v1/workspaces/{id}/organizations/{organizationId}", workspaceRoleAdmin, app.updateOrganization},
		{"DELETE", "/v1/workspaces/{id}/organizations/{organizationId}", workspaceRoleAdmin, app.deleteOrganization},
		{"GET", "/v1/workspaces/{id}/organizations/{organizationId}/contacts", workspaceRoleMember, app.listOrganizationContacts},
		{"POST", "/v1/workspaces/{id}/organizations/{organizationId}/contacts", workspaceRoleAdmin, app.createOrganizationContact},
		{"DELETE", "/v1/workspaces/{id}/organizations/{organizationId}/contacts/{contactId}", workspaceRoleAdmin, app.deleteOrganizationContact},
		{"GET", "/v1/workspaces/{id}/venues", workspaceRoleMember, app.listVenues},
		{"POST", "/v1/workspaces/{id}/venues", workspaceRoleAdmin, app.createVenue},
		{"GET", "/v1/workspaces/{id}/venues/{venueId}", workspaceRoleMember, app.getVenue},
		{"PATCH", "/v1/workspaces/{id}/venues/{venueId}", workspaceRoleAdmin, app.updateVenue},
		{"DELETE", "/v1/workspaces/{id}/venues/{venueId}", workspaceRoleAdmin, app.deleteVenue},
		{"GET", "/v1/workspaces/{id}/venues/{venueId}/spaces", workspaceRoleMember, app.listVenueSpaces},
		{"POST", "/v1/workspaces/{id}/venues/{venueId}/spaces", workspaceRoleAdmin, app.createVenueSpace},
		{"PATCH", "/v1/workspaces/{id}/venues/{venueId}/spaces/{spaceId}", workspaceRoleAdmin, app.updateVenueSpace},
		{"DELETE", "/v1/workspaces/{id}/venues/{venueId}/spaces/{spaceId}", workspaceRoleAdmin, app.deleteVenueSpace},
		{"GET", "/v1/workspaces/{id}/equipment", workspaceRoleMember, app.listEquipment},
		{"POST", "/v1/workspaces/{id}/equipment", workspaceRoleAdmin, app.createEquipment},
		{"GET", "/v1/workspaces/{id}/equipment/{equipmentId}", workspaceRoleMember, app.getEquipment},
		{"PATCH", "/v1/workspaces/{id}/equipment/{equipmentId}", workspaceRoleAdmin, app.updateEquipment},
		{"DELETE", "/v1/workspaces/{id}/equipment/{equipmentId}", workspaceRoleAdmin, app.deleteEquipment},
	} {
		wrapped := app.auth(app.requireWorkspaceRole(route.role, http.HandlerFunc(route.handle)))
		mux.Handle(route.method+" "+route.path, wrapped)
	}
	// Production Foundation：production 路由挂载在 workspace 下，
	// requireProductionAccess 同时验证 membership 与父子关系。
	mux.Handle("GET /v1/workspaces/{id}/productions", app.auth(app.requireWorkspaceRole(workspaceRoleMember, http.HandlerFunc(app.listProductions))))
	mux.Handle("POST /v1/workspaces/{id}/productions", app.auth(app.requireWorkspaceRole(workspaceRoleAdmin, http.HandlerFunc(app.createProduction))))
	mux.Handle("GET /v1/workspaces/{id}/productions/{productionId}", app.auth(app.requireProductionAccess(workspaceRoleMember, http.HandlerFunc(app.getProduction))))
	mux.Handle("PATCH /v1/workspaces/{id}/productions/{productionId}", app.auth(app.requireProductionAccess(workspaceRoleAdmin, http.HandlerFunc(app.updateProduction))))
	mux.Handle("GET /v1/workspaces/{id}/settings", app.auth(app.requireWorkspaceRole(workspaceRoleMember, http.HandlerFunc(app.getWorkspacePlanningSettings))))
	mux.Handle("PATCH /v1/workspaces/{id}/settings", app.auth(app.requireWorkspaceRole(workspaceRoleAdmin, http.HandlerFunc(app.updateWorkspacePlanningSettings))))
	mux.Handle("GET /v1/workspaces/{id}/review-catalog", app.auth(app.requireWorkspaceRole(workspaceRoleMember, http.HandlerFunc(app.getWorkspaceReviewCatalog))))
	// Canonical Production-scoped API. These routes deliberately do not require a
	// navigable Workspace: direct collaborators operate only within a Production.
	mux.Handle("GET /v1/productions", app.auth(http.HandlerFunc(app.listAccessibleProductions)))
	mux.Handle("GET /v1/productions/{productionId}", app.auth(app.requireProductionPermission(productionView, http.HandlerFunc(app.getAccessibleProduction))))
	mux.Handle("PATCH /v1/productions/{productionId}", app.auth(app.requireProductionPermission(productionEdit, http.HandlerFunc(app.updateProduction))))
	// Campaign intake: templates are authenticated read-only; Campaign and
	// revision mutations reuse the Production permission boundary.
	mux.Handle("GET /v1/review-recipes", app.auth(http.HandlerFunc(app.listReviewRecipes)))
	mux.Handle("GET /v1/review-recipes/{recipeId}", app.auth(http.HandlerFunc(app.getReviewRecipe)))
	mux.Handle("GET /v1/review-recipes/{recipeId}/versions", app.auth(http.HandlerFunc(app.listReviewRecipeVersions)))
	mux.Handle("GET /v1/review-recipes/{recipeId}/versions/{versionId}", app.auth(http.HandlerFunc(app.getReviewRecipeVersion)))
	mux.Handle("GET /v1/campaign-templates", app.auth(http.HandlerFunc(app.listCampaignTemplates)))
	mux.Handle("GET /v1/workspaces/{id}/campaign-templates", app.auth(app.requireWorkspaceRole(workspaceRoleMember, http.HandlerFunc(app.listWorkspaceCampaignTemplates))))
	mux.Handle("GET /v1/campaign-templates/{templateId}", app.auth(http.HandlerFunc(app.getCampaignTemplate)))
	mux.Handle("GET /v1/campaign-templates/{templateId}/versions", app.auth(http.HandlerFunc(app.listCampaignTemplateVersions)))
	mux.Handle("POST /v1/workspaces/{id}/campaign-templates", app.auth(app.requireWorkspaceRole(workspaceRoleAdmin, http.HandlerFunc(app.createWorkspaceCampaignTemplate))))
	mux.Handle("PATCH /v1/campaign-templates/{templateId}", app.auth(http.HandlerFunc(app.updateCampaignTemplate)))
	mux.Handle("POST /v1/campaign-templates/{templateId}/versions", app.auth(http.HandlerFunc(app.createCampaignTemplateVersion)))
	mux.Handle("PATCH /v1/campaign-templates/{templateId}/versions/{versionId}", app.auth(http.HandlerFunc(app.updateCampaignTemplateVersion)))
	mux.Handle("POST /v1/campaign-templates/{templateId}/versions/{versionId}/validate", app.auth(http.HandlerFunc(app.validateCampaignTemplateVersion)))
	mux.Handle("POST /v1/campaign-templates/{templateId}/versions/{versionId}/publish", app.auth(http.HandlerFunc(app.publishCampaignTemplateVersion)))
	mux.Handle("GET /v1/productions/{productionId}/campaigns", app.auth(app.requireProductionPermission(productionView, http.HandlerFunc(app.listCampaigns))))
	mux.Handle("POST /v1/productions/{productionId}/campaigns", app.auth(app.requireProductionPermission(productionEdit, http.HandlerFunc(app.createCampaign))))
	mux.Handle("GET /v1/campaigns/{campaignId}", app.auth(http.HandlerFunc(app.getCampaign)))
	mux.Handle("PATCH /v1/campaigns/{campaignId}", app.auth(http.HandlerFunc(app.updateCampaign)))
	mux.Handle("GET /v1/campaigns/{campaignId}/revisions", app.auth(http.HandlerFunc(app.listCampaignRevisions)))
	mux.Handle("POST /v1/campaigns/{campaignId}/revisions", app.auth(http.HandlerFunc(app.createCampaignRevision)))
	mux.Handle("GET /v1/campaigns/{campaignId}/revisions/{revisionId}", app.auth(http.HandlerFunc(app.getCampaignRevision)))
	mux.Handle("PATCH /v1/campaigns/{campaignId}/revisions/{revisionId}", app.auth(http.HandlerFunc(app.updateCampaignRevision)))
	mux.Handle("POST /v1/campaigns/{campaignId}/revisions/{revisionId}/validate", app.auth(http.HandlerFunc(app.validateCampaignRevision)))
	mux.Handle("POST /v1/campaigns/{campaignId}/revisions/{revisionId}/publish", app.auth(http.HandlerFunc(app.publishCampaignRevision)))
	mux.Handle("POST /v1/campaigns/{campaignId}/save-as-template", app.auth(http.HandlerFunc(app.saveCampaignAsTemplate)))
	mux.Handle("GET /v1/campaigns/{campaignId}/entries", app.auth(http.HandlerFunc(app.listCampaignEntries)))
	mux.Handle("GET /v1/entries/{entryId}", app.auth(http.HandlerFunc(app.getEntry)))
	mux.Handle("GET /v1/entries/{entryId}/revisions", app.auth(http.HandlerFunc(app.listEntryRevisions)))
	mux.Handle("POST /v1/entries/{entryId}/decisions", app.auth(http.HandlerFunc(app.createEntryDecision)))
	mux.Handle("POST /v1/entries/{entryId}/review-tasks", app.auth(http.HandlerFunc(app.assignEntryReviewTask)))
	mux.Handle("GET /v1/me/review-tasks", app.auth(http.HandlerFunc(app.listMyReviewTasks)))
	mux.Handle("GET /v1/review-tasks/{taskId}", app.auth(http.HandlerFunc(app.getReviewTask)))
	mux.Handle("POST /v1/review-tasks/{taskId}/feedback", app.auth(http.HandlerFunc(app.createReviewTaskFeedback)))
	mux.Handle("PATCH /v1/entries/{entryId}/inbox-state", app.auth(http.HandlerFunc(app.updateEntryInboxState)))
	mux.Handle("GET /v1/campaigns/{campaignId}/share-links", app.auth(http.HandlerFunc(app.listCampaignShareLinks)))
	mux.Handle("POST /v1/campaigns/{campaignId}/share-links", app.auth(http.HandlerFunc(app.createCampaignShareLink)))
	mux.Handle("POST /v1/campaign-share-links/{linkId}/rotate", app.auth(http.HandlerFunc(app.rotateCampaignShareLink)))
	mux.Handle("POST /v1/campaign-share-links/{linkId}/revoke", app.auth(http.HandlerFunc(app.revokeCampaignShareLink)))
	mux.Handle("POST /v1/productions/{productionId}/timezone-preview", app.auth(app.requireProductionPermission(productionEdit, http.HandlerFunc(app.previewProductionTimezone))))
	mux.Handle("GET /v1/productions/{productionId}/settings", app.auth(app.requireProductionPermission(productionView, http.HandlerFunc(app.getProductionPlanningSettings))))
	mux.Handle("PATCH /v1/productions/{productionId}/settings", app.auth(app.requireProductionPermission(productionEdit, http.HandlerFunc(app.updateProductionPlanningSettings))))
	mux.Handle("GET /v1/productions/{productionId}/members", app.auth(app.requireProductionPermission(productionMembersView, http.HandlerFunc(app.listProductionMembers))))
	mux.Handle("POST /v1/productions/{productionId}/members", app.auth(app.requireProductionPermission(productionMembersManage, http.HandlerFunc(app.createProductionMember))))
	mux.Handle("PATCH /v1/productions/{productionId}/members/{memberId}", app.auth(app.requireProductionPermission(productionMembersManage, http.HandlerFunc(app.updateProductionMember))))
	mux.Handle("DELETE /v1/productions/{productionId}/members/{memberId}", app.auth(app.requireProductionPermission(productionMembersManage, http.HandlerFunc(app.revokeProductionMember))))
	mux.Handle("GET /v1/productions/{productionId}/invitations", app.auth(app.requireProductionPermission(productionMembersManage, http.HandlerFunc(app.listProductionInvitations))))
	mux.Handle("POST /v1/productions/{productionId}/invitations", app.auth(app.requireProductionPermission(productionMembersManage, http.HandlerFunc(app.createProductionInvitation))))
	mux.Handle("DELETE /v1/productions/{productionId}/invitations/{invitationId}", app.auth(app.requireProductionPermission(productionMembersManage, http.HandlerFunc(app.revokeProductionInvitation))))
	mux.Handle("GET /v1/productions/{productionId}/invitations/{invitationId}/credential", app.auth(app.requireProductionPermission(productionMembersManage, http.HandlerFunc(app.getProductionInvitationCredential))))
	mux.Handle("POST /v1/productions/{productionId}/invitations/{invitationId}/rotate", app.auth(app.requireProductionPermission(productionMembersManage, http.HandlerFunc(app.rotateProductionInvitation))))
	mux.Handle("POST /v1/production-invitations/accept", app.auth(http.HandlerFunc(app.acceptProductionInvitation)))
	mux.Handle("POST /v1/invitations/accept", app.auth(http.HandlerFunc(app.acceptInvitation)))
	mux.Handle("GET /v1/productions/{productionId}/locations", app.auth(app.requireProductionPermission(productionView, http.HandlerFunc(app.listProductionLocations))))
	mux.Handle("POST /v1/productions/{productionId}/locations", app.auth(app.requireProductionPermission(productionEdit, http.HandlerFunc(app.createProductionLocation))))
	mux.Handle("PATCH /v1/productions/{productionId}/locations/order", app.auth(app.requireProductionPermission(productionEdit, http.HandlerFunc(app.reorderProductionLocations))))
	mux.Handle("PATCH /v1/productions/{productionId}/locations/{locationId}", app.auth(app.requireProductionPermission(productionEdit, http.HandlerFunc(app.updateProductionLocation))))
	mux.Handle("DELETE /v1/productions/{productionId}/locations/{locationId}", app.auth(app.requireProductionPermission(productionEdit, http.HandlerFunc(app.deleteProductionLocation))))
	// Production programs and program-sheet versions are server-owned. Publish/share
	// are deliberately separate permissions from ordinary editing.
	mux.Handle("GET /v1/productions/{productionId}/programs", app.auth(app.requireProductionPermission(productionView, http.HandlerFunc(app.listProductionPrograms))))
	mux.Handle("POST /v1/productions/{productionId}/programs", app.auth(app.requireProductionPermission(productionEdit, http.HandlerFunc(app.createProductionProgram))))
	mux.Handle("PATCH /v1/productions/{productionId}/programs/{programId}", app.auth(app.requireProductionPermission(productionEdit, http.HandlerFunc(app.updateProductionProgram))))
	mux.Handle("POST /v1/productions/{productionId}/programs/{programId}/archive", app.auth(app.requireProductionPermission(productionEdit, http.HandlerFunc(app.archiveProductionProgram))))
	mux.Handle("POST /v1/productions/{productionId}/programs/{programId}/restore", app.auth(app.requireProductionPermission(productionEdit, http.HandlerFunc(app.restoreProductionProgram))))
	mux.Handle("GET /v1/productions/{productionId}/program-sheets", app.auth(app.requireProductionPermission(productionView, http.HandlerFunc(app.listProgramSheets))))
	mux.Handle("POST /v1/productions/{productionId}/program-sheets", app.auth(app.requireProductionPermission(productionEdit, http.HandlerFunc(app.createProgramSheet))))
	mux.Handle("POST /v1/productions/{productionId}/program-sheets/migrate", app.auth(app.requireProductionPermission(productionEdit, http.HandlerFunc(app.migrateProgramSheets))))
	mux.Handle("GET /v1/program-sheets/{sheetId}", app.auth(http.HandlerFunc(app.getProgramSheet)))
	mux.Handle("PATCH /v1/program-sheets/{sheetId}", app.auth(app.requireProgramSheetPermission(productionEdit, http.HandlerFunc(app.updateProgramSheet))))
	mux.Handle("PATCH /v1/program-sheets/{sheetId}/items/order", app.auth(app.requireProgramSheetPermission(productionEdit, http.HandlerFunc(app.orderProgramSheetItems))))
	mux.Handle("POST /v1/program-sheets/{sheetId}/copy", app.auth(app.requireProgramSheetPermission(productionEdit, http.HandlerFunc(app.copyProgramSheet))))
	mux.Handle("POST /v1/program-sheets/{sheetId}/archive", app.auth(app.requireProgramSheetPermission(productionEdit, http.HandlerFunc(app.archiveProgramSheet))))
	mux.Handle("GET /v1/program-sheets/{sheetId}/occurrences", app.auth(app.requireProgramSheetPermission(productionView, http.HandlerFunc(app.getProgramSheetOccurrences))))
	mux.Handle("PUT /v1/program-sheets/{sheetId}/occurrences", app.auth(app.requireProgramSheetPermission(productionEdit, http.HandlerFunc(app.putProgramSheetOccurrences))))
	mux.Handle("POST /v1/program-sheets/{sheetId}/publish", app.auth(app.requireProgramSheetPermission(productionPublish, http.HandlerFunc(app.publishProgramSheet))))
	mux.Handle("POST /v1/program-sheets/{sheetId}/publish/preview", app.auth(app.requireProgramSheetPermission(productionPublish, http.HandlerFunc(app.previewPublishProgramSheet))))
	mux.Handle("POST /v1/program-sheets/{sheetId}/revise", app.auth(app.requireProgramSheetPermission(productionEdit, http.HandlerFunc(app.reviseProgramSheet))))
	mux.Handle("GET /v1/program-sheets/{sheetId}/releases", app.auth(app.requireProgramSheetPermission(productionView, http.HandlerFunc(app.listProgramReleases))))
	mux.Handle("GET /v1/program-sheet-releases/{releaseId}", app.auth(http.HandlerFunc(app.getProgramRelease)))
	mux.Handle("POST /v1/program-sheet-releases/{releaseId}/retract", app.auth(http.HandlerFunc(app.retractProgramRelease)))
	mux.Handle("GET /v1/program-sheet-releases/{releaseId}/diff", app.auth(http.HandlerFunc(app.diffProgramRelease)))
	mux.Handle("GET /v1/program-sheet-releases/{releaseId}/share-links", app.auth(http.HandlerFunc(app.listShareLinks)))
	mux.Handle("POST /v1/program-sheet-releases/{releaseId}/share-links", app.auth(http.HandlerFunc(app.createShareLink)))
	mux.Handle("POST /v1/program-sheet-share-links/{linkId}/rotate", app.auth(http.HandlerFunc(app.rotateShareLink)))
	mux.Handle("POST /v1/program-sheet-share-links/{linkId}/revoke", app.auth(http.HandlerFunc(app.revokeShareLink)))
	mux.HandleFunc("GET /v1/public/program-sheet-shares/{token}", app.publicProgramSheetShare)
	mux.HandleFunc("GET /v1/public/program-sheet-shares/short/{shortCode}", app.publicProgramSheetShare)
	mux.HandleFunc("GET /v1/public/campaign-shares/{token}", app.publicCampaign)
	mux.HandleFunc("GET /v1/public/campaign-shares/short/{shortCode}", app.publicCampaign)
	mux.HandleFunc("POST /v1/public/campaign-shares/{token}/entries", app.publicCampaignSubmit)
	mux.HandleFunc("POST /v1/public/campaign-shares/short/{shortCode}/entries", app.publicCampaignSubmit)
	mux.Handle("GET /v1/productions/{productionId}/occurrences", app.auth(app.requireProductionPermission(productionView, http.HandlerFunc(app.listPlanning))))
	mux.Handle("POST /v1/productions/{productionId}/occurrences", app.auth(app.requireProductionPermission(productionEdit, http.HandlerFunc(app.createPlanning))))
	mux.Handle("GET /v1/productions/{productionId}/occurrences/{occurrenceId}", app.auth(app.requireProductionPermission(productionView, http.HandlerFunc(app.getPlanning))))
	mux.Handle("PATCH /v1/productions/{productionId}/occurrences/{occurrenceId}", app.auth(app.requireProductionPermission(productionEdit, http.HandlerFunc(app.updatePlanning))))
	mux.Handle("GET /v1/productions/{productionId}/rehearsals", app.auth(app.requireProductionPermission(productionView, http.HandlerFunc(app.listPlanning))))
	mux.Handle("POST /v1/productions/{productionId}/rehearsals", app.auth(app.requireProductionPermission(productionEdit, http.HandlerFunc(app.createPlanning))))
	mux.Handle("GET /v1/productions/{productionId}/rehearsals/{sessionId}", app.auth(app.requireProductionPermission(productionView, http.HandlerFunc(app.getPlanning))))
	mux.Handle("PATCH /v1/productions/{productionId}/rehearsals/{sessionId}", app.auth(app.requireProductionPermission(productionEdit, http.HandlerFunc(app.updatePlanning))))
	mux.Handle("GET /v1/productions/{productionId}/schedule-items", app.auth(app.requireProductionPermission(productionView, http.HandlerFunc(app.listScheduleItems))))
	mux.Handle("POST /v1/productions/{productionId}/schedule-items", app.auth(app.requireProductionPermission(productionEdit, http.HandlerFunc(app.createScheduleItem))))
	mux.Handle("GET /v1/productions/{productionId}/schedule-items/{itemId}", app.auth(app.requireProductionPermission(productionView, http.HandlerFunc(app.getScheduleItem))))
	mux.Handle("PATCH /v1/productions/{productionId}/schedule-items/{itemId}", app.auth(app.requireProductionPermission(productionEdit, http.HandlerFunc(app.updateScheduleItem))))
	mux.Handle("DELETE /v1/productions/{productionId}/schedule-items/{itemId}", app.auth(app.requireProductionPermission(productionEdit, http.HandlerFunc(app.deleteScheduleItem))))
	registerFileRoutes(app, mux)
	return mux
}

func (app *application) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, 200, map[string]string{"status": "ok", "service": "stagepilot-api"})
}
func (app *application) ready(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := app.db.Ping(ctx); err != nil {
		writeJSON(w, 503, map[string]string{"status": "unavailable"})
		return
	}
	writeJSON(w, 200, map[string]string{"status": "ready"})
}

func (app *application) register(w http.ResponseWriter, r *http.Request) {
	if !app.allow(r, "register") {
		errorJSON(w, 429, "too_many_requests", "请求过于频繁")
		return
	}
	var in credentials
	if !decodeJSON(w, r, &in) {
		return
	}
	email := normalizeEmail(in.Email)
	if !validEmail(email) || len(in.Password) < 8 {
		errorJSON(w, 400, "invalid_input", "邮箱或密码格式无效")
		return
	}
	ctx := r.Context()
	tx, err := app.db.Begin(ctx)
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(ctx)
	var exists bool
	if err = tx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM user_identities WHERE provider='email' AND provider_subject=$1)", email).Scan(&exists); err != nil {
		serverError(w, err)
		return
	}
	if exists {
		errorJSON(w, 409, "account_exists", "无法完成注册")
		return
	}
	uid, identityID := newID(), newID()
	hash, err := hashPassword(in.Password)
	if err != nil {
		serverError(w, err)
		return
	}
	if _, err = tx.Exec(ctx, "INSERT INTO users (id,display_name) VALUES ($1,$2)", uid, strings.Split(email, "@")[0]); err != nil {
		serverError(w, err)
		return
	}
	if _, err = tx.Exec(ctx, "INSERT INTO user_identities (id,user_id,provider,provider_subject) VALUES ($1,$2,'email',$3)", identityID, uid, email); err != nil {
		serverError(w, err)
		return
	}
	if _, err = tx.Exec(ctx, "INSERT INTO password_credentials (user_id,password_hash) VALUES ($1,$2)", uid, hash); err != nil {
		serverError(w, err)
		return
	}
	if _, err = tx.Exec(ctx, "INSERT INTO user_preferences (user_id) VALUES ($1)", uid); err != nil {
		serverError(w, err)
		return
	}
	verification, err := app.createTokenRow(ctx, tx, "email_verifications", "user_id", uid)
	if err != nil {
		serverError(w, err)
		return
	}
	if err = tx.Commit(ctx); err != nil {
		serverError(w, err)
		return
	}
	app.logger.Info("email verification requested", "email", email, "debug_token", app.devToken(verification))
	usr, err := app.findUser(ctx, uid)
	if err != nil {
		serverError(w, err)
		return
	}
	response, err := app.issueSession(ctx, uid, newID(), usr, "desktop")
	if err != nil {
		serverError(w, err)
		return
	}
	response.DebugToken = app.devToken(verification)
	writeJSON(w, 201, response)
}
func (app *application) login(w http.ResponseWriter, r *http.Request) {
	if !app.allow(r, "login") {
		errorJSON(w, 429, "too_many_requests", "请求过于频繁")
		return
	}
	var in credentials
	if !decodeJSON(w, r, &in) {
		return
	}
	email := normalizeEmail(in.Email)
	var uid, stored string
	err := app.db.QueryRow(r.Context(), "SELECT i.user_id,p.password_hash FROM user_identities i JOIN password_credentials p ON p.user_id=i.user_id WHERE i.provider='email' AND i.provider_subject=$1", email).Scan(&uid, &stored)
	if err != nil || !verifyPassword(stored, in.Password) {
		errorJSON(w, 401, "invalid_credentials", "邮箱或密码错误")
		return
	}
	usr, err := app.findUser(r.Context(), uid)
	if err != nil || usr.Status != "active" {
		errorJSON(w, 401, "invalid_credentials", "邮箱或密码错误")
		return
	}
	response, err := app.issueSession(r.Context(), uid, newID(), usr, r.UserAgent())
	if err != nil {
		serverError(w, err)
		return
	}
	_, _ = app.db.Exec(r.Context(), "UPDATE user_identities SET last_used_at=NOW() WHERE user_id=$1 AND provider='email'", uid)
	writeJSON(w, 200, response)
}
func (app *application) refresh(w http.ResponseWriter, r *http.Request) {
	var in struct {
		RefreshToken string `json:"refresh_token"`
	}
	if !decodeJSON(w, r, &in) || in.RefreshToken == "" {
		errorJSON(w, 400, "invalid_input", "refresh token 无效")
		return
	}
	previousHash := tokenHash(in.RefreshToken)
	var sid, uid string
	err := app.db.QueryRow(r.Context(), "SELECT id,user_id FROM user_sessions WHERE refresh_token_hash=$1 AND revoked_at IS NULL AND expires_at>NOW()", previousHash).Scan(&sid, &uid)
	if err != nil {
		errorJSON(w, 401, "invalid_session", "会话已失效")
		return
	}
	refresh := randomToken()
	tag, err := app.db.Exec(r.Context(), "UPDATE user_sessions SET refresh_token_hash=$1,last_seen_at=NOW(),device_name=COALESCE(NULLIF($2,''),device_name) WHERE id=$3 AND user_id=$4 AND refresh_token_hash=$5 AND revoked_at IS NULL AND expires_at>NOW()", tokenHash(refresh), r.UserAgent(), sid, uid, previousHash)
	if err != nil {
		serverError(w, err)
		return
	}
	if tag.RowsAffected() != 1 {
		errorJSON(w, 401, "invalid_session", "会话已失效")
		return
	}
	usr, err := app.findUser(r.Context(), uid)
	if err != nil {
		serverError(w, err)
		return
	}
	access, err := app.issueAccessToken(uid, sid)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, tokenResponse{AccessToken: access, RefreshToken: refresh, ExpiresIn: int64(accessLifetime.Seconds()), User: usr})
}
func (app *application) logout(w http.ResponseWriter, r *http.Request) {
	var in struct {
		RefreshToken string `json:"refresh_token"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.RefreshToken == "" {
		errorJSON(w, 400, "invalid_input", "refresh token 无效")
		return
	}
	result, err := app.db.Exec(r.Context(), "UPDATE user_sessions SET revoked_at=NOW() WHERE refresh_token_hash=$1 AND revoked_at IS NULL", tokenHash(in.RefreshToken))
	if err != nil {
		serverError(w, err)
		return
	}
	if result.RowsAffected() != 1 {
		errorJSON(w, 401, "invalid_session", "会话已失效")
		return
	}
	writeJSON(w, 200, map[string]string{"status": "ok"})
}
func (app *application) logoutAll(w http.ResponseWriter, r *http.Request) {
	_, _ = app.db.Exec(r.Context(), "UPDATE user_sessions SET revoked_at=NOW() WHERE user_id=$1", claims(r).Subject)
	writeJSON(w, 200, map[string]string{"status": "ok"})
}
func (app *application) me(w http.ResponseWriter, r *http.Request) {
	usr, err := app.findUser(r.Context(), claims(r).Subject)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, usr)
}
func (app *application) updateMe(w http.ResponseWriter, r *http.Request) {
	var in struct {
		DisplayName *string `json:"display_name"`
		Username    *string `json:"username"`
		AvatarURL   *string `json:"avatar_url"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.AvatarURL != nil {
		errorJSON(w, http.StatusBadRequest, "avatar_managed", "头像请通过头像上传或移除接口修改")
		return
	}
	_, err := app.db.Exec(r.Context(), "UPDATE users SET display_name=COALESCE($1,display_name),username=COALESCE($2,username),updated_at=NOW() WHERE id=$3", in.DisplayName, in.Username, claims(r).Subject)
	if err != nil {
		serverError(w, err)
		return
	}
	app.me(w, r)
}
func (app *application) changePassword(w http.ResponseWriter, r *http.Request) {
	var in struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if len(in.NewPassword) < 8 {
		errorJSON(w, 400, "invalid_input", "密码至少需要 8 位")
		return
	}
	var old string
	if err := app.db.QueryRow(r.Context(), "SELECT password_hash FROM password_credentials WHERE user_id=$1", claims(r).Subject).Scan(&old); err != nil || !verifyPassword(old, in.CurrentPassword) {
		errorJSON(w, 400, "invalid_password", "当前密码错误")
		return
	}
	h, err := hashPassword(in.NewPassword)
	if err != nil {
		serverError(w, err)
		return
	}
	if _, err = app.db.Exec(r.Context(), "UPDATE password_credentials SET password_hash=$1,updated_at=NOW() WHERE user_id=$2", h, claims(r).Subject); err != nil {
		serverError(w, err)
		return
	}
	_, _ = app.db.Exec(r.Context(), "UPDATE user_sessions SET revoked_at=NOW() WHERE user_id=$1", claims(r).Subject)
	writeJSON(w, 200, map[string]string{"status": "ok"})
}
func (app *application) preferences(w http.ResponseWriter, r *http.Request) {
	var raw []byte
	err := app.db.QueryRow(r.Context(), "SELECT json_build_object('theme',theme,'language',language,'timezone',timezone,'notifications_enabled',notifications_enabled,'titlebar_title_mode',titlebar_title_mode,'detail_open_mode',detail_open_mode,'show_titlebar_title',show_titlebar_title,'content_width',content_width,'sidebar_rail_enabled',sidebar_rail_enabled,'category_tabs_pinned',category_tabs_pinned,'floating_action_expand_at_end',floating_action_expand_at_end)::text FROM user_preferences WHERE user_id=$1", claims(r).Subject).Scan(&raw)
	if err != nil {
		serverError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(raw)
	_, _ = w.Write([]byte("\n"))
}
func (app *application) updatePreferences(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Theme                string `json:"theme"`
		Language             string `json:"language"`
		Timezone             string `json:"timezone"`
		NotificationsEnabled *bool  `json:"notifications_enabled"`
		TitlebarTitleMode    string `json:"titlebar_title_mode"`
		DetailOpenMode       string `json:"detail_open_mode"`
		ShowTitlebarTitle    *bool  `json:"show_titlebar_title"`
		ContentWidth         string `json:"content_width"`
		SidebarRailEnabled   *bool  `json:"sidebar_rail_enabled"`
		CategoryTabsPinned   *bool  `json:"category_tabs_pinned"`
		FloatingActionExpand *bool  `json:"floating_action_expand_at_end"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.Theme != "" && in.Theme != "light" && in.Theme != "dark" && in.Theme != "system" {
		errorJSON(w, 400, "invalid_input", "主题无效")
		return
	}
	if in.TitlebarTitleMode != "" && in.TitlebarTitleMode != "page" && in.TitlebarTitleMode != "app" {
		errorJSON(w, 400, "invalid_input", "标题栏模式无效")
		return
	}
	if in.DetailOpenMode != "" && in.DetailOpenMode != "inline" && in.DetailOpenMode != "exclusive" {
		errorJSON(w, 400, "invalid_input", "详情打开方式无效，需要 inline 或 exclusive")
		return
	}
	if in.ContentWidth != "" && in.ContentWidth != "standard" && in.ContentWidth != "wide" && in.ContentWidth != "full" {
		errorJSON(w, 400, "invalid_input", "页面内容宽度无效")
		return
	}
	if in.Timezone != "" && !validProductionTimezone(in.Timezone) {
		errorJSON(w, 400, "invalid_input", "时区无效，需要 IANA 时区名称，例如 Asia/Shanghai")
		return
	}
	_, err := app.db.Exec(r.Context(), "UPDATE user_preferences SET theme=COALESCE(NULLIF($1,''),theme),language=COALESCE(NULLIF($2,''),language),timezone=COALESCE(NULLIF($3,''),timezone),notifications_enabled=COALESCE($4,notifications_enabled),titlebar_title_mode=COALESCE(NULLIF($5,''),titlebar_title_mode),detail_open_mode=COALESCE(NULLIF($6,''),detail_open_mode),content_width=COALESCE(NULLIF($7,''),content_width),show_titlebar_title=COALESCE($8,show_titlebar_title),sidebar_rail_enabled=COALESCE($9,sidebar_rail_enabled),category_tabs_pinned=COALESCE($10,category_tabs_pinned),floating_action_expand_at_end=COALESCE($11,floating_action_expand_at_end),updated_at=NOW() WHERE user_id=$12", in.Theme, in.Language, in.Timezone, in.NotificationsEnabled, in.TitlebarTitleMode, in.DetailOpenMode, in.ContentWidth, in.ShowTitlebarTitle, in.SidebarRailEnabled, in.CategoryTabsPinned, in.FloatingActionExpand, claims(r).Subject)
	if err != nil {
		serverError(w, err)
		return
	}
	app.preferences(w, r)
}
func (app *application) verifyEmail(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Token string `json:"token"`
	}
	if !decodeJSON(w, r, &in) || in.Token == "" {
		errorJSON(w, 400, "invalid_input", "验证 token 无效")
		return
	}
	var uid string
	err := app.db.QueryRow(r.Context(), "UPDATE email_verifications SET used_at=NOW() WHERE token_hash=$1 AND used_at IS NULL AND expires_at>NOW() RETURNING user_id", tokenHash(in.Token)).Scan(&uid)
	if err != nil {
		errorJSON(w, 400, "invalid_token", "验证链接已失效")
		return
	}
	writeJSON(w, 200, map[string]string{"status": "verified", "user_id": uid})
}
func (app *application) forgotPassword(w http.ResponseWriter, r *http.Request) {
	if !app.allow(r, "forgot") {
		errorJSON(w, 429, "too_many_requests", "请求过于频繁")
		return
	}
	var in struct {
		Email string `json:"email"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	var uid string
	err := app.db.QueryRow(r.Context(), "SELECT user_id FROM user_identities WHERE provider='email' AND provider_subject=$1", normalizeEmail(in.Email)).Scan(&uid)
	response := map[string]any{"status": "ok"}
	if err == nil {
		token, tokenErr := app.createTokenRow(r.Context(), app.db, "password_resets", "user_id", uid)
		if tokenErr == nil {
			app.logger.Info("password reset requested", "email", normalizeEmail(in.Email), "debug_token", app.devToken(token))
			if app.exposeDevTokens {
				response["debug_token"] = token
			}
		}
	}
	writeJSON(w, 200, response)
}
func (app *application) resetPassword(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Token    string `json:"token"`
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.Token == "" || len(in.Password) < 8 {
		errorJSON(w, 400, "invalid_input", "密码至少需要 8 位且 token 不能为空")
		return
	}
	var uid string
	if err := app.db.QueryRow(r.Context(), "UPDATE password_resets SET used_at=NOW() WHERE token_hash=$1 AND used_at IS NULL AND expires_at>NOW() RETURNING user_id", tokenHash(in.Token)).Scan(&uid); err != nil {
		errorJSON(w, 400, "invalid_token", "重置链接已失效")
		return
	}
	h, err := hashPassword(in.Password)
	if err != nil {
		serverError(w, err)
		return
	}
	if _, err = app.db.Exec(r.Context(), "UPDATE password_credentials SET password_hash=$1,updated_at=NOW() WHERE user_id=$2", h, uid); err != nil {
		serverError(w, err)
		return
	}
	_, _ = app.db.Exec(r.Context(), "UPDATE user_sessions SET revoked_at=NOW() WHERE user_id=$1", uid)
	writeJSON(w, 200, map[string]string{"status": "ok"})
}

func (app *application) issueSession(ctx context.Context, uid, sid string, usr user, device string) (tokenResponse, error) {
	refresh := randomToken()
	_, err := app.db.Exec(ctx, "INSERT INTO user_sessions (id,user_id,refresh_token_hash,device_name,expires_at) VALUES ($1,$2,$3,$4,$5)", sid, uid, tokenHash(refresh), device, time.Now().Add(refreshLifetime))
	if err != nil {
		return tokenResponse{}, err
	}
	signed, err := app.issueAccessToken(uid, sid)
	return tokenResponse{AccessToken: signed, RefreshToken: refresh, ExpiresIn: int64(accessLifetime.Seconds()), User: usr}, err
}
func (app *application) issueAccessToken(uid, sid string) (string, error) {
	c := authClaims{SessionID: sid, RegisteredClaims: jwt.RegisteredClaims{Subject: uid, ExpiresAt: jwt.NewNumericDate(time.Now().Add(accessLifetime)), IssuedAt: jwt.NewNumericDate(time.Now())}}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString(app.jwtSecret)
}
func (app *application) auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		var c authClaims
		t, err := jwt.ParseWithClaims(raw, &c, func(t *jwt.Token) (any, error) {
			if t.Method != jwt.SigningMethodHS256 {
				return nil, errors.New("bad signing method")
			}
			return app.jwtSecret, nil
		})
		if err != nil || !t.Valid || c.Subject == "" {
			errorJSON(w, 401, "unauthorized", "需要登录")
			return
		}
		var ok bool
		if err = app.db.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM user_sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>NOW())", c.SessionID, c.Subject).Scan(&ok); err != nil || !ok {
			errorJSON(w, 401, "invalid_session", "会话已失效")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), claimsKey, c)))
	})
}
func claims(r *http.Request) authClaims { return r.Context().Value(claimsKey).(authClaims) }
func (app *application) findUser(ctx context.Context, id string) (user, error) {
	var u user
	var legacyAvatar, avatarKey, avatarRevision string
	err := app.db.QueryRow(ctx, "SELECT u.id,COALESCE((SELECT provider_subject FROM user_identities WHERE user_id=u.id AND provider='email' LIMIT 1),''),EXISTS(SELECT 1 FROM email_verifications v WHERE v.user_id=u.id AND v.used_at IS NOT NULL),u.display_name,u.username,u.avatar_url,u.avatar_object_key,u.avatar_revision,u.status,u.created_at FROM users u WHERE u.id=$1", id).Scan(&u.ID, &u.Email, &u.EmailVerified, &u.DisplayName, &u.Username, &legacyAvatar, &avatarKey, &avatarRevision, &u.Status, &u.CreatedAt)
	u.AvatarURL = managedAvatarURL(id, avatarKey, avatarRevision, legacyAvatar)
	return u, err
}
func (app *application) createTokenRow(ctx context.Context, exec interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}, table, column, uid string) (string, error) {
	token := randomToken()
	query := fmt.Sprintf("INSERT INTO %s (id,%s,token_hash,expires_at) VALUES ($1,$2,$3,$4)", table, column)
	_, err := exec.Exec(ctx, query, newID(), uid, tokenHash(token), time.Now().Add(24*time.Hour))
	return token, err
}
func (app *application) devToken(t string) string {
	if app.exposeDevTokens {
		return t
	}
	return ""
}
func (app *application) allow(r *http.Request, key string) bool {
	return app.allowWindow(r, key+":"+requestClientIP(r), 20, time.Minute)
}
func (app *application) allowWindow(r *http.Request, key string, limit int, window time.Duration) bool {
	now := time.Now()
	k := key
	app.rateMu.Lock()
	defer app.rateMu.Unlock()
	v := app.rate[k]
	if v.started.IsZero() || now.Sub(v.started) > window {
		v = rateEntry{started: now}
	}
	v.count++
	app.rate[k] = v
	return v.count <= limit
}
func (app *application) resetRate(key string) {
	app.rateMu.Lock()
	delete(app.rate, key)
	app.rateMu.Unlock()
}
func requestClientIP(r *http.Request) string {
	if host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr)); err == nil && host != "" {
		return host
	}
	return strings.TrimSpace(r.RemoteAddr)
}
func normalizeEmail(v string) string { return strings.ToLower(strings.TrimSpace(v)) }
func validEmail(v string) bool       { return strings.Contains(v, "@") && len(v) >= 5 }
func newID() string                  { return randomToken() }
func randomToken() string            { b := make([]byte, 32); _, _ = rand.Read(b); return hex.EncodeToString(b) }
func tokenHash(v string) string      { h := sha256.Sum256([]byte(v)); return hex.EncodeToString(h[:]) }
func hashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	sum := argon2.IDKey([]byte(password), salt, 3, 64*1024, 4, 32)
	return fmt.Sprintf("$argon2id$v=19$m=65536,t=3,p=4$%s$%s", hex.EncodeToString(salt), hex.EncodeToString(sum)), nil
}
func verifyPassword(encoded, password string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" || parts[2] != "v=19" {
		return false
	}
	var m, t, p int
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &m, &t, &p); err != nil {
		return false
	}
	saltHex, sumHex := parts[4], parts[5]
	salt, e1 := hex.DecodeString(saltHex)
	expected, e2 := hex.DecodeString(sumHex)
	if e1 != nil || e2 != nil {
		return false
	}
	actual := argon2.IDKey([]byte(password), salt, uint32(t), uint32(m), uint8(p), uint32(len(expected)))
	return string(actual) == string(expected)
}
func decodeJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		errorJSON(w, 400, "invalid_json", "请求格式无效")
		return false
	}
	return true
}
func errorJSON(w http.ResponseWriter, status int, code, message string) {
	errorJSONWithFields(w, status, code, message, nil)
}
func errorJSONWithFields(w http.ResponseWriter, status int, code, message string, fields map[string]any) {
	error := map[string]any{"code": code, "message": message}
	for key, value := range fields {
		error[key] = value
	}
	writeJSON(w, status, map[string]any{"error": error})
}
func serverError(w http.ResponseWriter, err error) {
	slog.Default().Error("request failed", "error", err)
	errorJSON(w, 500, "internal_error", "服务器暂时无法处理请求")
}
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func requestLogger(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		next.ServeHTTP(w, r)
		logger.Info("request", "method", r.Method, "path", r.URL.Path, "duration", time.Since(started))
	})
}
func allowedOrigins() map[string]struct{} {
	configured := envOrDefault("CORS_ALLOWED_ORIGINS", "http://localhost:1420,http://127.0.0.1:1420,http://[::1]:1420,http://tauri.localhost,tauri://localhost,https://tauri.localhost")
	origins := make(map[string]struct{})
	for _, origin := range strings.Split(configured, ",") {
		if origin = strings.TrimSpace(origin); origin != "" {
			origins[origin] = struct{}{}
		}
	}
	return origins
}
func corsMiddleware(origins map[string]struct{}) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin != "" {
				if _, ok := origins[origin]; !ok {
					errorJSON(w, http.StatusForbidden, "origin_not_allowed", "不允许此来源访问 API")
					return
				}
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
			}
			if r.Method == http.MethodOptions {
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key, If-Match")
				w.Header().Set("Access-Control-Max-Age", "600")
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
func envOrDefault(k, f string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return f
}
