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

function readPropExpression(source, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*\\{`).exec(source);
  if (!match) return null;
  const open = match.index + match[0].lastIndexOf("{");
  let depth = 0;
  let quote = "";
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return source.slice(open + 1, index);
  }
  return null;
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
    if (/(?:<form\b|<DialogForm\b|<DetailFormLayout\b)/.test(modalBody) && /\bsm:grid-cols-2\b/.test(modalBody)) {
      violations.push(`${filename}: modal form uses a viewport sm:grid-cols-2 breakpoint; use DialogFormGrid`);
    }

    const footerPattern = /<(DialogFooter|AlertDialogFooter)\b/g;
    for (const footerMatch of modalBody.matchAll(footerPattern)) {
      const footerEnd = findOpeningTagEnd(modalBody, footerMatch.index ?? 0);
      if (footerEnd < 0) continue;
      const openingTag = modalBody.slice(footerMatch.index, footerEnd);
      if (!/\blayout\s*=\s*["'](?:standard|wizard|auth)["']/.test(openingTag)) {
        violations.push(`${filename}: <${footerMatch[1]}> must declare layout="standard|wizard|auth"`);
      }
      if (!/\bprimary\s*=/.test(openingTag)) {
        violations.push(`${filename}: <${footerMatch[1]}> must declare its primary action explicitly`);
      }
      const secondaryActions = readPropExpression(openingTag, "secondary")?.match(/<(?:Button|AlertDialogAction|AlertDialogCancel)\b/g)?.length ?? 0;
      if (secondaryActions > 2) {
        violations.push(`${filename}: <${footerMatch[1]}> accepts at most two secondary actions`);
      }
      const primaryExpression = readPropExpression(openingTag, "primary")?.trim() ?? "";
      const primaryActions = primaryExpression.startsWith("[")
        ? primaryExpression.match(/<(?:Button|AlertDialogAction|AlertDialogCancel)\b/g)?.length ?? 0
        : Number(Boolean(primaryExpression));
      if (primaryActions > 1) {
        violations.push(`${filename}: <${footerMatch[1]}> accepts exactly one primary action`);
      }
      if (!openingTag.slice(0, -1).trimEnd().endsWith("/")) {
        violations.push(`${filename}: <${footerMatch[1]}> must use cancel/secondary/primary slots instead of children`);
      }

      for (const bodyMatch of modalBody.matchAll(/<DialogBody\b|<AlertDialogBody\b/g)) {
        if ((bodyMatch.index ?? 0) >= (footerMatch.index ?? 0)) continue;
        const bodyEnd = findOpeningTagEnd(modalBody, bodyMatch.index ?? 0);
        if (bodyEnd < 0) continue;
        const bodyOpening = modalBody.slice(bodyMatch.index, bodyEnd);
        if (bodyOpening.slice(0, -1).trimEnd().endsWith("/")) continue;
        const bodyCloseAt = modalBody.indexOf(bodyMatch[0].startsWith("<Alert") ? "</AlertDialogBody>" : "</DialogBody>", bodyEnd);
        if (bodyCloseAt >= 0 && bodyCloseAt > (footerMatch.index ?? 0)) {
          violations.push(`${filename}: dialog footer must be a sibling of DialogBody, not inside its scroll region`);
          break;
        }
      }
    }

    if (/<form\b|<DetailFormLayout\b|<FormActionBar\b/.test(modalBody)) {
      violations.push(`${filename}: modal forms and actions must use DialogForm, DialogBody, and DialogFooter sibling regions`);
    }
    if (/<DialogForm\b/.test(modalBody)) {
      const formStart = modalBody.indexOf("<DialogForm");
      const formOpenEnd = findOpeningTagEnd(modalBody, formStart);
      const formCloseAt = modalBody.indexOf("</DialogForm>", formOpenEnd);
      const formBody = formCloseAt >= 0 ? modalBody.slice(formOpenEnd, formCloseAt) : "";
      const headerStart = formBody.indexOf("<DialogHeader");
      const bodyStart = formBody.indexOf("<DialogBody");
      const footerStart = formBody.indexOf("<DialogFooter");
      const bodyCloseAt = bodyStart >= 0 ? formBody.indexOf("</DialogBody>", bodyStart) : -1;
      if (formCloseAt < 0 || headerStart < 0 || bodyStart < headerStart || footerStart < 0 || bodyCloseAt < 0 || footerStart < bodyCloseAt) {
        violations.push(`${filename}: DialogForm must contain Header, Body, and Footer as ordered sibling regions`);
      }
    }

    if (/\btype\s*=\s*["']submit["']/.test(modalBody) && !/<DialogForm\b/.test(modalBody)) {
      violations.push(`${filename}: modal submit actions must belong to a DialogForm`);
    }
  }
  return violations;
}

export function scanDialogForms(source, filename = "source") {
  const violations = [];
  const pattern = /<DialogForm\b/g;
  for (const match of source.matchAll(pattern)) {
    const start = match.index ?? 0;
    const openEnd = findOpeningTagEnd(source, start);
    const closeAt = openEnd >= 0 ? source.indexOf("</DialogForm>", openEnd) : -1;
    if (openEnd < 0 || closeAt < 0) {
      violations.push(`${filename}: unclosed DialogForm`);
      continue;
    }
    const content = source.slice(openEnd, closeAt);
    const headerAt = content.indexOf("<DialogHeader");
    const bodyAt = content.indexOf("<DialogBody");
    const footerAt = content.indexOf("<DialogFooter");
    const bodyEnd = bodyAt >= 0 ? content.indexOf("</DialogBody>", bodyAt) : -1;
    if (headerAt < 0 || bodyAt < headerAt || footerAt < 0 || bodyEnd < 0 || footerAt < bodyEnd) {
      violations.push(`${filename}: DialogForm must contain Header, Body, and Footer as ordered sibling regions`);
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
    const source = fs.readFileSync(fullPath, "utf8");
    return [
      ...scanDialogCallsites(source, relativePath),
      ...scanDialogForms(source, relativePath),
    ];
  });
  if (violations.length) {
    throw new Error(`Dialog 调用必须遵守统一结构、尺寸和操作布局：\n${violations.join("\n")}`);
  }
}
