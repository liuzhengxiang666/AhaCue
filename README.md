# Algo Companion

[![CI](https://github.com/liuzhengxiang666/algo-companion/actions/workflows/ci.yml/badge.svg)](https://github.com/liuzhengxiang666/algo-companion/actions/workflows/ci.yml)

> Source-available for noncommercial use; not OSI-approved open source.

Algo Companion 是一个本地悬浮式算法陪练。桌面应用以内嵌刷题页面为主界面，
右下角只保留一个悬浮球；只有用户主动点击后才会调用模型。

它不是复杂的 Agent 会话，也不是直接替用户完成题目。它希望尽量少打断手写过程，
用最简洁的文字帮助做题者理解题意，并根据当前代码只提示下一步。

## 亮点

- **最小打扰**：平时只有一个悬浮球，不占用编码空间，不主动弹出对话。
- **最少文字**：题意优先用一句大白话讲清楚，提示只给当前需要的一步。
- **延续手写**：直接读取最新代码，从用户已经写到的位置继续，不从头讲题。
- **渐进提示**：先给思路，再按需展示伪代码、边界、API 和局部片段。
- **流程而非聊天**：通过固定选项推进解题，不需要反复组织问题与模型对话。
- **保留主导权**：默认只读；只有用户明确操作时才插入片段或写入答案，并且可以撤销。

## 功能

- 自动读取当前题目、编程语言、编辑器代码和运行结果。
- `没思路`：先用大白话解释题意，再选择解题方法。
- `有思路`：根据当前代码只提示最小的下一步。
- `直接看答案`：查看完整代码，并可写入编辑器和撤销。
- `复习这题`：结合上次的方法、错误和真实卡点继续复习。
- 开始手写后，再次点击悬浮球会读取最新代码继续渐进提示，不会从头开始。
- Run/Submit 失败只显示红点，不自动弹窗，也不会自动消耗模型额度。
- 题目、尝试记录和复习记忆保存在本地。
- 首次启动必须确认仅用于个人学习或非营利教育，未确认时 Agent 功能保持关闭。
- 比赛、测评、面试和考试页面自动关闭辅导能力。

## 使用

环境要求：

- Node.js 20.20 或更高版本；
- pnpm 10.33，或者使用 Corepack。

克隆并安装：

```bash
git clone https://github.com/liuzhengxiang666/algo-companion.git
cd algo-companion
corepack enable
pnpm install --frozen-lockfile
```

运行：

```bash
pnpm start
```

项目所有者使用自动适配版时，将个人适配器放在仓库相邻目录：

```text
algo-companion/
Act-private/
└─ leetcode-cn-adapter.cjs
```

Linux 或 macOS：

```bash
chmod +x run.sh
./run.sh
```

Windows 双击 `run.cmd`，或者运行：

```bash
pnpm start:personal
```

启动后点击悬浮球即可选择解题路线。模型只需在齿轮设置中选择服务商并填写需要的
API Key；也可以使用可用的免费模型。

## 说明

- 公开源码不包含真实页面自动适配器，因此不会自动读取真实题目页面。
- 题目、代码、错误和复习记录只保存在本地，不上传服务器。
- 本项目与 LeetCode、领扣网络不存在隶属、合作或背书关系。
- 源码允许个人学习、非营利教育和研究，禁止商业使用。
- 禁止用于比赛、在线考试、招聘测评、作弊或自动提交。

详细条款见 [LICENSE](./LICENSE) 和 [DISCLAIMER.md](./DISCLAIMER.md)。
