import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const makeRoot = path.join(root, "out", "make");

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(target)));
    else files.push(target);
  }
  return files;
}

const packageJson = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8")
);
const files = (await walk(makeRoot))
  .filter((file) => path.basename(file).includes(packageJson.version))
  .sort();
if (files.length === 0) throw new Error("No release artifacts found under out/make.");

const lines = [];
for (const file of files) {
  const digest = createHash("sha256").update(await readFile(file)).digest("hex");
  lines.push(`${digest}  ${path.relative(makeRoot, file)}`);
}

const output = path.join(root, "SHA256SUMS.txt");
await writeFile(output, `${lines.join("\n")}\n`, "utf8");
console.log(`Wrote ${lines.length} checksums to ${output}`);
