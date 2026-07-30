# Algo Companion

[![CI](https://github.com/liuzhengxiang666/algo-companion/actions/workflows/ci.yml/badge.svg)](https://github.com/liuzhengxiang666/algo-companion/actions/workflows/ci.yml)

> Source-available for noncommercial use; not OSI-approved open source.

Algo Companion 是一个本地悬浮式算法陪练原型。桌面应用以内嵌刷题页面为主界面，
右下角只保留一个悬浮球；用户主动点击后，Agent 才会按照固定路线提供精简提示。

当前版本为 `0.3.0`。项目仍处于个人原型阶段，不建议用于考试、比赛或招聘测评。

## 功能概览

- `没思路`：先用一句大白话解释题意，再展示最多三个方法。
- `有思路`：读取当前代码，只给最小的下一步，不重新讲整道题。
- `直接看答案`：先展示一句方法说明，再由用户决定是否查看和写入完整代码。
- `复习这题`：结合上次方法、真实错误、边界遗漏和 API 遗忘点复习。
- 点击“开始手写”后保留当前方法和提示层级；再次点击悬浮球会读取最新代码继续提示。
- Run/Submit 失败只显示红点，不自动弹窗，也不会自动调用模型。
- 悬浮球和面板可拖动、吸边并记住位置。
- 题意、方法和伪代码支持本地缓存；代码提示、诊断和完整答案不缓存。
- 比赛、测评、面试和考试页面自动关闭辅导能力。

## 重要：公开版与个人版

本仓库是公开源码版本，不包含自动读取特定平台页面的适配器，包括：

- 真实题面或题解；
- DOM 选择器；
- 编辑器内部读取逻辑；
- 隐藏接口或请求拦截；
- 自动提交代码。

因此，直接克隆本仓库可以运行桌面外壳、模型设置和合成测试，但不会自动识别真实
题目页面。个人适配器仅在项目所有者本地使用，获得平台书面许可前不会上传或发布。

## 架构

```text
Electron BaseWindow
├─ Remote WebContentsView       刷题网页，独立会话与 sandbox
└─ Local BrowserWindow          React 悬浮球与气泡
          │
          ▼ 受限 preload / IPC
Electron main process
├─ PlatformAdapterHost          平台读取与编辑接口
├─ ProviderRouter               Zen 与国内模型路由
├─ GuidanceProtocol             分阶段提示词、Schema 与输出裁剪
├─ DatabaseService              SQLite 记录、记忆与缓存
├─ SecretStore                  API Key 安全存储
└─ shared/contracts + workflow  跨进程类型与纯工作流规则
```

远程网页没有 preload，不能访问本地 IPC、SQLite 或 API Key。只有本地悬浮窗口的
`webContents` 可以调用经过白名单和 Zod 校验的 IPC。

## 目录结构

```text
src/
├─ main/
│  ├─ main.ts                   窗口生命周期与尝试监听
│  ├─ platform-adapter-host.ts  自动适配接口与撤销栈
│  ├─ provider-router.ts        模型选择、重试、冷却和缓存
│  ├─ guidance-protocol.ts      提示协议与输出规范
│  ├─ database.ts               SQLite 数据层
│  ├─ secret-store.ts           API Key 存储
│  └─ ipc.ts                    本地 IPC 权限边界
├─ preload/                     最小化 IPC 桥
├─ renderer/                    React 悬浮界面
└─ shared/                      数据契约与纯函数工作流
tests/fixtures/                 仅含合成题目
scripts/                        构建、许可和公开边界检查
```

## 环境要求

- Node.js `20.20` 或更高版本；
- pnpm `10.33`，也可以通过 Corepack 使用；
- Windows、macOS 或 Linux 桌面环境。

## 运行公开源码版

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm start
```

公开源码版不会加载个人自动适配器。它主要用于检查桌面外壳、设置、架构和合成测试。

## 项目所有者的个人版本

个人适配器必须位于公共仓库之外：

```text
Act/
Act-private/
└─ leetcode-cn-adapter.cjs
```

Linux 或 macOS：

```bash
chmod +x run.sh
./run.sh
```

Windows 可双击 `run.cmd`。也可以手动运行：

```bash
pnpm start:personal
```

生成仅供项目所有者本地使用的安装包：

```bash
pnpm make:personal
```

个人构建包含非公开适配器，不得上传源码、安装包或构建产物。

## 模型配置

- OpenCode Zen 免费模型支持自动快速路由。
- 免费模型失败后，可以切换到用户已经测试通过的 DeepSeek、通义千问、智谱、
  Moonshot/Kimi 或 SiliconFlow API Key。
- 429 模型冷却 10 分钟，网络或 5xx 错误冷却 2 分钟。
- 前台请求最多尝试两个免费模型，再切换到用户明确配置的备用服务商。

免费模型的在线状态、限流和使用条款可能随时变化，使用前请自行确认服务条款。

## 本地数据

项目没有后端、账号系统或遥测。Linux 安装版数据库默认位于：

```text
~/.config/Algo Companion/practice.db
```

开发版使用独立目录：

```text
~/.config/Algo Companion Dev/practice.db
```

Windows 使用 `%APPDATA%/Algo Companion/`，macOS 使用
`~/Library/Application Support/Algo Companion/`。SQLite 采用 WAL 模式，应用运行
期间还会存在 `practice.db-wal` 和 `practice.db-shm`。

数据库包含：

- `problems`：题目标识和题面摘要；
- `attempts`：Run/Submit 时的代码、结果和错误分类；
- `memories`：原方法、真实卡点、边界、API 遗忘和复习时间；
- `guidance_events`：提示阶段和提示级别；
- `guidance_cache`：可复用的题意、方法与伪代码；
- `settings`：模型选择和悬浮位置等设置。

API Key 不写入 SQLite。系统凭据能力可用时使用 Electron `safeStorage` 加密；Linux
如果只能提供 `basic_text`，则只在当前会话内保存。

## 测试与公开发布检查

```bash
pnpm typecheck
pnpm test
pnpm verify:public
```

生成不含个人适配器的公开预览包：

```bash
pnpm make
```

CI 会执行类型检查、自动化测试、许可证检查和公开边界扫描。真实页面适配器、题面
fixture、DOM 选择器以及本地数据库均不得进入公共仓库。

## 当前限制

- 公开仓库不提供真实页面自动识别能力。
- 复习排期已经存入数据库，但“今日待复习”入口尚未完成。
- UI 工作流目前集中在一个较大的 React 组件中，后续还需要拆成独立状态机和组件。
- 自动页面适配依赖目标平台页面结构，可能随页面更新失效。

## 许可与免责声明

第一方源码使用
[PolyForm Noncommercial License 1.0.0](./LICENSE)，允许个人学习、非营利教育和
研究用途，禁止商业使用。它不是 OSI 批准的开源许可证，因此本项目应称为
source-available，而不是严格意义上的开源软件。

本项目与 LeetCode、领扣网络不存在隶属、合作或背书关系。软件不包含或再分发题库
内容，用户必须遵守目标平台条款。禁止用于比赛、在线考试、招聘测评、作弊或自动
提交。完整条款见 [DISCLAIMER.md](./DISCLAIMER.md) 和
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
