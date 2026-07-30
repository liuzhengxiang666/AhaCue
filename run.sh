#!/usr/bin/env bash
set -euo pipefail

algo_project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$algo_project_dir"

if command -v pnpm >/dev/null 2>&1; then
  algo_package_runner=(pnpm)
elif command -v corepack >/dev/null 2>&1; then
  algo_package_runner=(corepack pnpm)
else
  echo "需要 Node.js 20.20 或更高版本。安装 Node.js 后重新运行 ./run.sh。" >&2
  exit 1
fi

"${algo_package_runner[@]}" install --frozen-lockfile --prefer-offline
exec "${algo_package_runner[@]}" start
