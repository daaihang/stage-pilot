export function getDetailActionLabels({ presentation = "overlay", detailLabel = "详情" } = {}) {
  const label = String(detailLabel || "详情").trim() || "详情";
  const canToggle = presentation !== "overlay";
  return {
    canToggle,
    toggle: presentation === "exclusive" ? "恢复为右侧详情栏" : "展开为大模态详情",
    close: presentation === "inline" ? `收起${label}` : `关闭${label}`,
  };
}
