import { ResourceTypeManagementPanel } from "@/components/resource-type-management-panel";

// Compatibility wrapper for callers that still render the legacy page route.
// The canonical UI now lives inside the resource library detail surface.
export function VenueTypeManagementPage({ workspace }) {
  return <ResourceTypeManagementPanel workspace={workspace} resourceType="venues" />;
}
