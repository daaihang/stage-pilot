import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function findOpeningTagEnd(source, start) {
  let quote = "";
  let braceDepth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{") braceDepth += 1;
    else if (char === "}") braceDepth = Math.max(0, braceDepth - 1);
    else if (char === ">" && braceDepth === 0) return index + 1;
  }
  return -1;
}

export function scanDialogCallsites(source, filename = "source") {
  const violations = [];
  const pattern = /<(DialogContent|AlertDialogContent)\b/g;
  for (const match of source.matchAll(pattern)) {
    const end = findOpeningTagEnd(source, match.index ?? 0);
    if (end < 0) {
      violations.push(`${filename}: malformed <${match[1]}> opening tag`);
      continue;
    }
    const openingTag = source.slice(match.index, end);
    const size = /\bsize\s*=\s*["'](sm|md|lg|xl)["']/.exec(openingTag)?.[1];
    if (!size) violations.push(`${filename}: <${match[1]}> must declare size="sm|md|lg|xl"`);
    if (/\bmax-[wh]-/.test(openingTag)) {
      violations.push(`${filename}: <${match[1]}> must use the shared size prop instead of max-w/max-h overrides`);
    }

    const closingTag = `</${match[1]}`;
    const closeAt = source.indexOf(closingTag, end);
    if (closeAt < 0) continue;
    const modalBody = source.slice(end, closeAt);
    if (/(?:<form\b|<DetailFormLayout\b)/.test(modalBody) && /\bsm:grid-cols-2\b/.test(modalBody)) {
      violations.push(`${filename}: modal form uses a viewport sm:grid-cols-2 breakpoint; use DialogFormGrid`);
    }
    if (/<form\b/.test(modalBody) && /\btype\s*=\s*["']submit["']/.test(modalBody) && !/(?:DialogFooter|AlertDialogFooter|FormActionBar)/.test(modalBody)) {
      violations.push(`${filename}: modal submit action must use a sticky DialogFooter or FormActionBar`);
    }
  }
  return violations;
}

export function validateDialogUsage(root = desktopRoot) {
  const sourceRoot = path.join(root, "src");
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile() && entry.name.endsWith(".jsx") && !fullPath.includes(`${path.sep}ui${path.sep}`)) files.push(fullPath);
    }
  };
  visit(sourceRoot);

  const violations = files.flatMap((fullPath) => {
    const relativePath = path.relative(root, fullPath).replaceAll(path.sep, "/");
    return scanDialogCallsites(fs.readFileSync(fullPath, "utf8"), relativePath);
  });
  if (violations.length) {
    throw new Error(`Dialog 调用必须遵守统一尺寸和容器表单布局：\n${violations.join("\n")}`);
  }
}
