// The builder preview and the future public form deliberately share one
// renderer contract. Keeping this adapter separate gives the public surface a
// stable import without duplicating FormVersion rendering logic.
export { CampaignFormPreview as CampaignFormRenderer } from "./campaign-form-builder";
