import { useMemo } from "react";
import { CampaignRevisionDraftProvider, RevisionEditorShell } from "@/components/campaign-revision-draft-context";
import {
  listCampaignTemplateVersions,
  publishCampaignTemplateVersion,
  updateCampaignTemplateVersion,
  listReviewRecipeVersions,
  publishReviewRecipeVersion,
  updateReviewRecipeVersion,
} from "@/lib/campaign-api";
import { emptyFormVersion } from "@/lib/campaign-form-model";

function definitionForVersion(version) {
  const definition = version?.definition && typeof version.definition === "object" ? version.definition : {};
  return {
    formVersion: definition.form || emptyFormVersion(),
    availabilityPolicy: definition.availability_policy || {},
    reviewWorkflow: definition.review_workflow || (version?.definition || {}),
    materializationPlan: definition.materialization_plan || {},
  };
}

function revisionForVersion(template, version, mode) {
  const definition = definitionForVersion(version);
  return {
    id: version?.id || "",
    revisionNo: version?.version || 0,
    status: version?.status || (version?.publishedAt ? "published" : "draft"),
    etag: version?.etag || "",
    formVersion: definition.formVersion,
    availabilityPolicy: definition.availabilityPolicy,
    reviewWorkflow: mode === "recipe" ? (version?.definition || {}) : definition.reviewWorkflow,
    materializationPlan: definition.materializationPlan,
    reviewRecipeVersionId: mode === "campaign" ? version?.reviewRecipeVersionId || "" : "",
    campaignId: template?.id,
  };
}

function templateDefinition(snapshot) {
  return {
    form: snapshot.form,
    availability_policy: snapshot.policy,
    review_workflow: snapshot.reviewWorkflow,
    materialization_plan: snapshot.materializationPlan,
  };
}

/**
 * Adapts a template or recipe version to the same draft contract used by the
 * Campaign editor. The editor components therefore keep one source of truth
 * for form, rules, review and result editing while the adapter owns the
 * template-specific API calls.
 */
export function TemplateDraftProvider({ mode = "campaign", template, version, workspace, onSaved, onPublished, onReload, children }) {
  const campaign = useMemo(() => ({
    id: template?.id || "",
    workspaceId: workspace?.id || template?.workspaceId || "",
    productionId: "",
    kind: template?.kind || "COLLECTION",
    name: template?.name || "",
    description: template?.description || "",
    status: template?.status || "draft",
  }), [template, workspace?.id]);
  const revision = useMemo(() => revisionForVersion(template, version, mode), [mode, template, version]);
  const operations = useMemo(() => {
    if (!version?.id || !template?.id) return undefined;
    if (mode === "recipe") {
      return {
        save: async (snapshot, options) => {
          const result = await updateReviewRecipeVersion(template.id, version.id, { definition: snapshot.reviewWorkflow }, { etag: options.etag });
          const savedVersion = result.version || result;
          return revisionForVersion(template, savedVersion, mode);
        },
        validate: async (_snapshot, options) => ({ valid: true, issues: [], etag: options.etag }),
        publish: async (_snapshot, options) => {
          const result = await publishReviewRecipeVersion(template.id, version.id, { etag: options.etag });
          return { revision: revisionForVersion(template, result.version, mode), recipe: result.recipe, version: result.version };
        },
        reload: async () => {
          const result = await listReviewRecipeVersions(template.id);
          const latest = result.items.find((item) => item.id === version.id) || result.items[0];
          return revisionForVersion(template, latest, mode);
        },
      };
    }
    return {
      save: async (snapshot, options) => {
        const result = await updateCampaignTemplateVersion(template.id, version.id, {
          definition: templateDefinition(snapshot),
          review_recipe_version_id: snapshot.reviewRecipeVersionId || null,
        }, { etag: options.etag });
        const savedVersion = result.version || result;
        return revisionForVersion(template, savedVersion, mode);
      },
      validate: async (_snapshot, options) => ({ valid: true, issues: [], etag: options.etag }),
      publish: async (_snapshot, options) => {
        const result = await publishCampaignTemplateVersion(template.id, version.id, { etag: options.etag });
        return { revision: revisionForVersion(template, result.version, mode), template: result.template, version: result.version };
      },
      reload: async () => {
        const result = await listCampaignTemplateVersions(template.id);
        const latest = result.items.find((item) => item.id === version.id) || result.items[0];
        return revisionForVersion(template, latest, mode);
      },
    };
  }, [mode, template, version]);

  if (!version?.id) return null;
  return <CampaignRevisionDraftProvider campaign={campaign} revision={revision} production={null} operations={operations} onSaved={onSaved} onPublished={onPublished} onReload={onReload}>{children}</CampaignRevisionDraftProvider>;
}

export function TemplateEditorShell({ mode = "campaign", children }) {
  return <RevisionEditorShell showPreview={mode === "campaign"} previewButtonLabel="预览模板">{children}</RevisionEditorShell>;
}
