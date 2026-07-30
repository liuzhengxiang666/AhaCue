import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const scanRoots = ["src", "tests/fixtures"];
const forbiddenFileNames = [
  "leetcode-cn-adapter.cjs",
  "provider-secrets.json"
];
const forbidden = [
  { name: "DOM selector", pattern: /\bdocument\s*\.\s*querySelector(All)?\s*\(/ },
  { name: "page script injection", pattern: /\bexecuteJavaScript(InIsolatedWorld)?\b/ },
  { name: "request interception", pattern: /\bwebRequest\s*\.\s*onBeforeRequest\b/ },
  { name: "editor internals", pattern: /\bmonaco\s*\.\s*editor\b/ },
  { name: "hidden graph endpoint", pattern: /leetcode\.(com|cn)\/graphql/i },
  { name: "private adapter artifact", pattern: /private[-_ ]adapter/i }
];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && [".vite", "node_modules", "out"].includes(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(target)));
    else if (/\.(?:ts|tsx|js|mjs|json|html|css)$/i.test(entry.name)) files.push(target);
  }
  return files;
}

const violations = [];
for (const fileName of forbiddenFileNames) {
  if (await fileExists(path.join(root, fileName))) {
    violations.push(`${fileName}: private local artifact`);
  }
}
if (
  process.env.ALGO_COMPANION_PERSONAL_BUILD === "1" ||
  process.env.ALGO_COMPANION_ADAPTER_PATH
) {
  violations.push(
    "environment: personal adapter flags are forbidden in a public build"
  );
}
for (const scanRoot of scanRoots) {
  for (const file of await walk(path.join(root, scanRoot))) {
    const content = await readFile(file, "utf8");
    for (const rule of forbidden) {
      if (rule.pattern.test(content)) {
        violations.push(`${path.relative(root, file)}: ${rule.name}`);
      }
    }
  }
}

if (violations.length > 0) {
  throw new Error(`Public release boundary violated:\n${violations.join("\n")}`);
}

console.log("Public release scan passed: external automatic-adapter boundary intact.");

async function fileExists(target) {
  try {
    await readFile(target);
    return true;
  } catch {
    return false;
  }
}
