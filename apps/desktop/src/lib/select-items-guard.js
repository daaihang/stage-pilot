import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (["ui", "reui"].includes(entry.name) && path.basename(directory) === "components") return [];
      return sourceFiles(fullPath);
    }
    return /\.(jsx|tsx)$/.test(entry.name) ? [fullPath] : [];
  });
}

function findOpeningTagEnd(source, start) {
  let braceDepth = 0;
  let quote = null;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
    } else if (char === "{") {
      braceDepth += 1;
    } else if (char === "}") {
      braceDepth -= 1;
    } else if (char === ">" && braceDepth === 0) {
      return index;
    }
  }
  return -1;
}

export function scanSelectRoots(source, filename = "source") {
  const violations = [];
  const pattern = /<Select(?=\s|>)/g;
  let match;

  while ((match = pattern.exec(source))) {
    const end = findOpeningTagEnd(source, pattern.lastIndex);
    if (end < 0) {
      violations.push(`${filename}: unterminated <Select> root`);
      break;
    }
    const openingTag = source.slice(match.index, end + 1);
    if (!/\bitems\s*=/.test(openingTag)) {
      const line = source.slice(0, match.index).split("\n").length;
      violations.push(`${filename}:${line} Select.Root requires an explicit items mapping`);
    }
    pattern.lastIndex = end + 1;
  }

  return violations;
}

export function validateSelectItemsGuard(root = desktopRoot) {
  const sourceRoot = path.join(root, "src/components");
  const violations = sourceFiles(sourceRoot).flatMap((fullPath) => {
    const relativePath = path.relative(root, fullPath).replaceAll("\\", "/");
    return scanSelectRoots(fs.readFileSync(fullPath, "utf8"), relativePath);
  });
  if (violations.length) {
    throw new Error(`Select.Root 必须提供完整的 value/label items 映射：\n${violations.join("\n")}`);
  }
}
