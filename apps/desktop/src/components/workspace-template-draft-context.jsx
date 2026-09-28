import { useMemo } from "react";
import { CampaignRevisionDraftProvider, RevisionEditorShell } from "@/components/campaign-revision-draft-context";
import {
  listCampaignTemplateVersions,
  publishCampaignTemplateVersion,
  updateCampaignTemplateVersion,
  validateCampaignTemplateVersion,
} from "@/lib/campaign-api";
import { emptyFormVersion } from "@/lib/campaign-form-model";

function revisionForVersion(template, version) {
  const definition = version?.definition && typeof version.definition === "object" ? version.definition : {};
  return {
    id: version?.id || "",
    revisionNo: version?.version || 0,
    status: version?.status || (version?.publishedAt ? "published" : "draft"),
    etag: version?.etag || "",
    formVersion: definition.form || emptyFormVersion(),
    availabilityPolicy: definition.availability_policy || {},
    reviewWorkflow: definition.review_workflow || {},
    materializationPlan: definition.materialization_plan || {},
    reviewRecipeVersionId: version?.reviewRecipeVersionId || "",
    reviewRecipeSource: version?.reviewRecipeSource || null,
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

/** Adapts a reusable form template to the Campaign editor's draft contract. */
export function TemplateDraftProvider({ template, version, workspace, onSaved, onPublished, onReload, children }) {
  const campaign = useMemo(() => ({
    id: template?.id || "",
    workspaceId: workspace?.id || template?.workspaceId || "",
    productionId: "",
    isTemplate: true,
    kind: template?.kind || "COLLECTION",
    name: template?.name || "",
    description: template?.description || "",
    status: template?.status || "draft",
  }), [template, workspace?.id]);
  const revision = useMemo(() => revisionForVersion(template, version), [template, version]);
  const operations = useMemo(() => {
    if (!version?.id || !template?.id) return undefined;
    return {
      save: async (snapshot, options) => {
        const result = await updateCampaignTemplateVersion(template.id, version.id, {
          definition: templateDefinition(snapshot),
          review_recipe_version_id: snapshot.reviewRecipeVersionId || null,
        }, { etag: options.etag });
        return revisionForVersion(template, result.version || result);
      },
      validate: async (_snapshot, options) => validateCampaignTemplateVersion(template.id, version.id, { etag: options.etag }),
      publish: async (_snapshot, options) => {
        const result = await publishCampaignTemplateVersion(template.id, version.id, { etag: options.etag });
        return { revision: revisionForVersion(template, result.version), template: result.template, version: result.version };
      },
      reload: async () => {
        const result = await listCampaignTemplateVersions(template.id);
        const current = result.items.find((item) => item.id === version.id) || result.items[0];
        return revisionForVersion(template, current);
      },
    };
  }, [template, version]);

  if (!version?.id) return null;
  return <CampaignRevisionDraftProvider campaign={campaign} revision={revision} production={null} operations={operations} onSaved={onSaved} onPublished={onPublished} onReload={onReload}>{children}</CampaignRevisionDraftProvider>;
}

export function TemplateEditorShell({ children }) {
  return <RevisionEditorShell showPreview previewButtonLabel="预览模板" floatingPrimary>{children}</RevisionEditorShell>;
}
