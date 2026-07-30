import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const expectations = new Map([
  ["LICENSE", "PolyForm Noncommercial License 1.0.0"],
  ["DISCLAIMER.md", "not affiliated"],
  ["THIRD_PARTY_NOTICES.md", "Third-party notices"],
  ["README.md", "not OSI-approved open source"]
]);

for (const [file, marker] of expectations) {
  const target = path.join(root, file);
  await stat(target);
  const content = await readFile(target, "utf8");
  const normalized = content.replace(/\s+/g, " ").toLowerCase();
  if (!normalized.includes(marker.toLowerCase())) {
    throw new Error(`${file} is missing required marker: ${marker}`);
  }
}

const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
if (packageJson.license !== "PolyForm-Noncommercial-1.0.0") {
  throw new Error("package.json must declare PolyForm-Noncommercial-1.0.0");
}
if (packageJson.productName !== "AhaCue" || packageJson.author !== "liuzhengxiang666") {
  throw new Error("package.json must preserve the AhaCue name and author attribution");
}

const disclaimer = await readFile(path.join(root, "DISCLAIMER.md"), "utf8");
if (!disclaimer.includes("Required Notice: Copyright © 2026 liuzhengxiang666.")) {
  throw new Error("DISCLAIMER.md is missing the author's required notice");
}

console.log("Legal files verified.");
