import { existsSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const action = process.argv[2] || "start";
if (!["start", "package", "make"].includes(action)) {
  throw new Error(`Unsupported personal build action: ${action}`);
}

const configured = process.env.ALGO_COMPANION_ADAPTER_PATH?.trim();
const adapter = path.resolve(
  configured || path.join(root, "..", "Act-private", "leetcode-cn-adapter.cjs")
);
if (!existsSync(adapter)) {
  throw new Error(
    `个人自动适配器不存在：${adapter}\n请先准备本地适配器，再启动个人版本。`
  );
}

const forgeCli = path.join(
  root,
  "node_modules",
  "@electron-forge",
  "cli",
  "dist",
  "electron-forge.js"
);
if (!existsSync(forgeCli)) {
  throw new Error("Electron Forge 尚未安装，请先运行 pnpm install。");
}

function findLinuxSandbox() {
  if (process.platform !== "linux" || action !== "start") return undefined;
  const candidates = [
    process.env.CHROME_DEVEL_SANDBOX,
    "/opt/google/chrome/chrome-sandbox",
    "/usr/lib/chromium/chrome-sandbox",
    "/usr/lib/chromium-browser/chrome-sandbox",
    "/usr/lib/algo-companion/chrome-sandbox"
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const details = statSync(candidate);
      if (details.uid === 0 && (details.mode & 0o4000) !== 0) return candidate;
    } catch {
      // Try the next known system sandbox.
    }
  }
  return undefined;
}

const childEnv = {
  ...process.env,
  ALGO_COMPANION_ADAPTER_PATH: adapter,
  ALGO_COMPANION_PERSONAL_BUILD: "1"
};
delete childEnv.ELECTRON_RUN_AS_NODE;
const linuxSandbox = findLinuxSandbox();
if (linuxSandbox) childEnv.CHROME_DEVEL_SANDBOX = linuxSandbox;
if (process.platform === "linux" && action === "start" && !linuxSandbox) {
  console.warn(
    "未找到系统 Chromium 沙箱。建议双击已安装版本，或先安装生成的 DEB 包。"
  );
}

const child = spawn(process.execPath, [forgeCli, action], {
  cwd: root,
  stdio: "inherit",
  env: childEnv
});

child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Electron Forge stopped by ${signal}.`);
    process.exitCode = 1;
  } else {
    process.exitCode = code ?? 1;
  }
});
