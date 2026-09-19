import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const formControlGuardTargets = [
  "src/components/campaign-form-builder.jsx",
  "src/components/campaign-form-fields.jsx",
  "src/components/campaign-form-renderer.jsx",
  "src/components/public-campaign-form-page.jsx",
  "src/components/campaign-entry-inbox.jsx",
  "src/components/workspace-template-library-page.jsx",
];

function isAllowedNativeControl(source, tag, index) {
  const type = /\btype\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
  const hasMarker = /\bdata-native-control-exception\b/.test(tag);
  const isAllowedType = type === "color" || (type === "file" && /\bhidden\b/.test(tag));
  const nearbyComment = source.slice(Math.max(0, index - 180), index);
  return hasMarker && isAllowedType && /native-control-exception:/i.test(nearbyComment);
}

export function scanNativeFormControls(source, filename = "source") {
  const violations = [];
  const pattern = /<(input|select|textarea)\b[^>]*>/g;
  for (const match of source.matchAll(pattern)) {
    if (isAllowedNativeControl(source, match[0], match.index || 0)) continue;
    violations.push(`${filename}: disallowed native <${match[1]}>`);
  }
  return violations;
}

export function validateFormControlGuard(root = desktopRoot) {
  const violations = [];
  for (const target of formControlGuardTargets) {
    const fullPath = path.join(root, target);
    const source = fs.readFileSync(fullPath, "utf8");
    violations.push(...scanNativeFormControls(source, target));
  }
  if (violations.length) {
    throw new Error(`业务表单必须使用 shadcn/ui 字段组件：\n${violations.join("\n")}`);
  }
}
