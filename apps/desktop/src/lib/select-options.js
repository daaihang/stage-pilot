export const SELECT_LOADING_LABEL = "正在加载选项…";
export const SELECT_UNAVAILABLE_LABEL = "选项不可用";

/**
 * Build the complete label map passed to Base UI Select.Root.
 * Keep this list independent from a menu's search/filter result.
 */
export function resolveSelectItems(options = [], {
  value,
  loading = false,
  selectedLabel,
} = {}) {
  const normalized = [];
  const seen = new Set();

  for (const option of options) {
    if (!option || option.value == null) continue;
    const key = String(option.value);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      value: key,
      label: String(option.label ?? ""),
      ...(option.disabled ? { disabled: true } : {}),
    });
  }

  if (value == null || value === "" || seen.has(String(value))) {
    return { items: normalized, missingOption: null };
  }

  const knownLabel = typeof selectedLabel === "string" ? selectedLabel.trim() : "";
  const missingOption = {
    value: String(value),
    label: loading
      ? knownLabel || SELECT_LOADING_LABEL
      : knownLabel
        ? `${knownLabel}（已停用）`
        : SELECT_UNAVAILABLE_LABEL,
    disabled: true,
  };

  return { items: [...normalized, missingOption], missingOption };
}
