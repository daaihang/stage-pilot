import { useMemo } from "react";
import { Filters } from "@/components/reui/filters/filters";
import { createFilterQuery, flattenFilterConditions } from "@/components/reui/filters/filters-query";

export function ResourceFilters({ fields, value, onChange, onClear }) {
  const query = value || createFilterQuery();
  const hasFilters = flattenFilterConditions(query).length > 0;
  const configuredFields = useMemo(() => fields, [fields]);
  const labels = {
    addFilter: "添加筛选",
    addCondition: "添加筛选",
    addConditionGroup: "添加筛选组",
    clear: "清除",
    clearAll: "清除全部",
    searchFields: "搜索字段…",
    searchOptions: "搜索选项…",
    selectPlaceholder: "选择…",
    valuePlaceholder: "输入…",
    empty: "暂无结果",
    apply: "应用",
    discard: "取消",
    filtersLabel: "筛选条件",
    fieldsLabel: "字段",
    operator: "条件",
    where: "满足",
    and: "并且",
    or: "或者",
  };
  return <div className="min-w-0 flex-1">
    <Filters fields={configuredFields} query={query} onQueryChange={onChange} labels={labels} showClear={false} />
    {hasFilters && <button type="button" className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={onClear}>清除筛选</button>}
  </div>;
}

export function getResourceFilterConditions(query) {
  return flattenFilterConditions(query || createFilterQuery());
}
