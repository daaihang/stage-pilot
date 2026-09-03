import { useMemo } from "react";
import { Filters } from "@/components/reui/filters/filters";
import { createFilterQuery, flattenFilterConditions } from "@/components/reui/filters/filters-query";

export function ResourceFilters({ fields, value, onChange, onClear }) {
  const query = value || createFilterQuery();
  const hasFilters = flattenFilterConditions(query).length > 0;
  const configuredFields = useMemo(() => fields, [fields]);
  return <div className="min-w-0 flex-1">
    <Filters fields={configuredFields} query={query} onQueryChange={onChange} showClear={false} />
    {hasFilters && <button type="button" className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={onClear}>清除筛选</button>}
  </div>;
}

export function getResourceFilterConditions(query) {
  return flattenFilterConditions(query || createFilterQuery());
}
