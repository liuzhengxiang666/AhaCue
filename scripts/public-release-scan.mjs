import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const adapterFile = path.join(root, "adapters", "leetcode-cn.cjs");
const scanRoots = ["src", "adapters", "tests/fixtures"];
const globalForbidden = [
  {
    name: "request interception",
    pattern: /\bwebRequest\s*\.\s*onBeforeRequest\b/
  },
  {
    name: "hidden graph endpoint",
    pattern: /leetcode\.(com|cn)\/graphql/i
  },
  {
    name: "embedded credential",
    pattern:
      /\b(?:gho_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,})\b/
  }
];
const adapterForbidden = [
  { name: "adapter network request", pattern: /\bfetch\s*\(/ },
  { name: "adapter XMLHttpRequest", pattern: /\bXMLHttpRequest\b/ },
  { name: "adapter WebSocket", pattern: /\bWebSocket\s*\(/ },
  { name: "cookie access", pattern: /\bdocument\s*\.\s*cookie\b/ },
  {
    name: "browser storage access",
    pattern: /\b(?:localStorage|sessionStorage)\b/
  },
  {
    name: "automatic click or submit",
    pattern: /\.(?:click|submit|requestSubmit)\s*\(/
  }
];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (
      entry.isDirectory() &&
      [".git", ".vite", "node_modules", "out"].includes(entry.name)
    ) {
      continue;
    }
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(target)));
    else if (/\.(?:cjs|ts|tsx|js|mjs|json|html|css)$/i.test(entry.name)) {
      files.push(target);
    }
  }
  return files;
}

const violations = [];
let adapterContent = "";
try {
  adapterContent = await readFile(adapterFile, "utf8");
} catch {
  violations.push("adapters/leetcode-cn.cjs: integrated adapter is missing");
}

for (const scanRoot of scanRoots) {
  for (const file of await walk(path.join(root, scanRoot))) {
    const content = await readFile(file, "utf8");
    for (const rule of globalForbidden) {
      if (rule.pattern.test(content)) {
        violations.push(`${path.relative(root, file)}: ${rule.name}`);
      }
    }
  }
}

for (const rule of adapterForbidden) {
  if (rule.pattern.test(adapterContent)) {
    violations.push(`adapters/leetcode-cn.cjs: ${rule.name}`);
  }
}

for (const requiredExport of [
  "supports",
  "install",
  "readContext",
  "readAttempt",
  "insertSnippet",
  "replaceCode"
]) {
  if (!new RegExp(`\\b${requiredExport}\\b`).test(adapterContent)) {
    violations.push(
      `adapters/leetcode-cn.cjs: missing ${requiredExport} contract`
    );
  }
}

if (violations.length > 0) {
  throw new Error(`Release boundary violated:\n${violations.join("\n")}`);
}

console.log(
  "Release scan passed: integrated adapter is visible-page only, local, and non-submitting."
);
