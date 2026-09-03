import { useMemo } from "react";
import { Filters } from "@/components/reui/filters/filters";
import { createFilterQuery, flattenFilterConditions } from "@/components/reui/filters/filters-query";
import { Button } from "@/components/ui/button";

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
  const operatorLabels = {
    contains: "包含",
    not_contains: "不包含",
    starts_with: "开头是",
    ends_with: "结尾是",
    is: "是",
    is_not: "不是",
    is_any_of: "属于任一",
    is_none_of: "不属于任一",
    has_any_of: "包含任一",
    has_all_of: "包含全部",
    has_none_of: "不包含任一",
    eq: "等于",
    neq: "不等于",
    gt: "大于",
    gte: "大于等于",
    lt: "小于",
    lte: "小于等于",
    between: "介于",
    not_between: "不介于",
    is_before: "早于",
    is_after: "晚于",
    is_on_or_before: "早于或等于",
    is_on_or_after: "晚于或等于",
    empty: "为空",
    not_empty: "不为空",
  };
  return <div className="flex min-w-0 flex-1 items-start gap-2">
    <div className="min-w-0 flex-1"><Filters fields={configuredFields} query={query} onQueryChange={onChange} labels={labels} operatorLabels={operatorLabels} showClear={false} /></div>
    {hasFilters && <Button type="button" variant="outline" size="sm" className="mt-0.5 shrink-0" onClick={onClear}>清除筛选</Button>}
  </div>;
}

export function getResourceFilterConditions(query) {
  return flattenFilterConditions(query || createFilterQuery());
}
