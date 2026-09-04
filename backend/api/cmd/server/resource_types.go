package main

// Resource type management is shared by workspace programs and venues.  The
// public HTTP endpoints intentionally retain their resource-specific paths and
// response contracts; the definitions below are the only source for SQL
// identifiers used by the shared helpers.

import (
	"context"
	"net/http"

	"github.com/jackc/pgx/v5"
)

// ResourceTypeDefinition describes one workspace-scoped type collection.  It
// is deliberately composed only of server-owned constants, never request
// input, so it is safe to use when constructing SQL statements.
type ResourceTypeDefinition struct {
	Key                string
	TableName          string
	TemplateTableName  string
	ResourceLabel      string
	UsageColumn        string
	UsageJSONKey       string
	SupportsUsageQuery bool
	ProtectSystemName  bool
	DefaultColor       string
}

var (
	programResourceTypeDefinition = ResourceTypeDefinition{
		Key:                "programs",
		TableName:          "program_types",
		TemplateTableName:  "program_type_templates",
		ResourceLabel:      "节目",
		UsageColumn:        "program_count",
		UsageJSONKey:       "program_count",
		SupportsUsageQuery: true,
		ProtectSystemName:  true,
		DefaultColor:       "#2563eb",
	}
	venueResourceTypeDefinition = ResourceTypeDefinition{
		Key:               "venues",
		TableName:         "venue_types",
		TemplateTableName: "venue_type_templates",
		ResourceLabel:     "场地",
		UsageColumn:       "venue_count",
		UsageJSONKey:      "venue_count",
		DefaultColor:      "#64748b",
	}
)

func resourceTypeExists(ctx context.Context, query resourceQueryRower, definition ResourceTypeDefinition, workspaceID, typeID string, activeOnly bool) (bool, error) {
	definition, ok := canonicalResourceTypeDefinition(definition)
	if !ok {
		return false, nil
	}
	condition := "deleted_at IS NULL"
	if activeOnly {
		condition += " AND is_active=TRUE"
	}
	var exists bool
	err := query.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM "+definition.TableName+" WHERE id=$1 AND workspace_id=$2 AND "+condition+")", typeID, workspaceID).Scan(&exists)
	return exists, err
}

func canonicalResourceTypeDefinition(definition ResourceTypeDefinition) (ResourceTypeDefinition, bool) {
	switch definition.Key {
	case programResourceTypeDefinition.Key:
		return programResourceTypeDefinition, true
	case venueResourceTypeDefinition.Key:
		return venueResourceTypeDefinition, true
	default:
		return ResourceTypeDefinition{}, false
	}
}

func validResourceTypeDefinition(definition ResourceTypeDefinition) bool {
	_, ok := canonicalResourceTypeDefinition(definition)
	return ok
}

// The specific handlers below remain the compatibility boundary for the
// existing JSON contracts and policy differences (program migration versus
// venue delete protection).  All routes enter through these shared methods.
func (app *application) listResourceTypes(w http.ResponseWriter, r *http.Request, definition ResourceTypeDefinition) {
	if !validResourceTypeDefinition(definition) {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "资源类型无效")
		return
	}
	if definition.Key == programResourceTypeDefinition.Key {
		app.legacyListProgramTypes(w, r)
		return
	}
	app.legacyListVenueTypes(w, r)
}

func (app *application) createResourceType(w http.ResponseWriter, r *http.Request, definition ResourceTypeDefinition) {
	if !validResourceTypeDefinition(definition) {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "资源类型无效")
		return
	}
	if definition.Key == programResourceTypeDefinition.Key {
		app.legacyCreateProgramType(w, r)
		return
	}
	app.legacyCreateVenueType(w, r)
}

func (app *application) updateResourceType(w http.ResponseWriter, r *http.Request, definition ResourceTypeDefinition) {
	if !validResourceTypeDefinition(definition) {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "资源类型无效")
		return
	}
	if definition.Key == programResourceTypeDefinition.Key {
		app.legacyUpdateProgramType(w, r)
		return
	}
	app.legacyUpdateVenueType(w, r)
}

func (app *application) reorderResourceTypes(w http.ResponseWriter, r *http.Request, definition ResourceTypeDefinition) {
	if !validResourceTypeDefinition(definition) {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "资源类型无效")
		return
	}
	if definition.Key == programResourceTypeDefinition.Key {
		app.legacyReorderProgramTypes(w, r)
		return
	}
	app.legacyReorderVenueTypes(w, r)
}

func (app *application) deleteResourceType(w http.ResponseWriter, r *http.Request, definition ResourceTypeDefinition) {
	if !validResourceTypeDefinition(definition) {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "资源类型无效")
		return
	}
	if definition.Key == programResourceTypeDefinition.Key {
		app.legacyDeleteProgramType(w, r)
		return
	}
	app.legacyDeleteVenueType(w, r)
}

// Public route handlers are intentionally thin.  Keeping these names means
// old clients and integration tests continue to use the same endpoint paths.
func (app *application) listProgramTypes(w http.ResponseWriter, r *http.Request) {
	app.listResourceTypes(w, r, programResourceTypeDefinition)
}
func (app *application) createProgramType(w http.ResponseWriter, r *http.Request) {
	app.createResourceType(w, r, programResourceTypeDefinition)
}
func (app *application) updateProgramType(w http.ResponseWriter, r *http.Request) {
	app.updateResourceType(w, r, programResourceTypeDefinition)
}
func (app *application) reorderProgramTypes(w http.ResponseWriter, r *http.Request) {
	app.reorderResourceTypes(w, r, programResourceTypeDefinition)
}
func (app *application) deleteProgramType(w http.ResponseWriter, r *http.Request) {
	app.deleteResourceType(w, r, programResourceTypeDefinition)
}

func (app *application) listVenueTypes(w http.ResponseWriter, r *http.Request) {
	app.listResourceTypes(w, r, venueResourceTypeDefinition)
}
func (app *application) createVenueType(w http.ResponseWriter, r *http.Request) {
	app.createResourceType(w, r, venueResourceTypeDefinition)
}
func (app *application) updateVenueType(w http.ResponseWriter, r *http.Request) {
	app.updateResourceType(w, r, venueResourceTypeDefinition)
}
func (app *application) reorderVenueTypes(w http.ResponseWriter, r *http.Request) {
	app.reorderResourceTypes(w, r, venueResourceTypeDefinition)
}
func (app *application) deleteVenueType(w http.ResponseWriter, r *http.Request) {
	app.deleteResourceType(w, r, venueResourceTypeDefinition)
}

// seedResourceTypes is idempotent and deliberately does not update existing
// rows.  This makes platform template changes non-destructive for workspaces
// that have customized a system type's name, color, order, or active state.
func seedResourceTypes(ctx context.Context, tx pgx.Tx, workspaceID, createdBy string) error {
	for _, definition := range []ResourceTypeDefinition{programResourceTypeDefinition, venueResourceTypeDefinition} {
		_, err := tx.Exec(ctx, `INSERT INTO `+definition.TableName+` (id,workspace_id,system_key,name,color,sort_order,is_system_default,is_active,created_by)
			SELECT md5($1 || ':' || t.key), $1, t.key, t.name, t.color, t.sort_order, TRUE, t.is_active, $2
			FROM `+definition.TemplateTableName+` t
			WHERE NOT EXISTS (SELECT 1 FROM `+definition.TableName+` existing WHERE existing.workspace_id=$1 AND existing.system_key=t.key AND existing.deleted_at IS NULL)`, workspaceID, createdBy)
		if err != nil {
			return err
		}
	}
	return nil
}
