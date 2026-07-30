# AhaCue

[![CI](https://github.com/liuzhengxiang666/algo-companion/actions/workflows/ci.yml/badge.svg)](https://github.com/liuzhengxiang666/algo-companion/actions/workflows/ci.yml)

> Source-available for noncommercial use; not OSI-approved open source.

AhaCue 是一个本地悬浮式算法陪练。安装后直接在应用内打开刷题页面，
不需要浏览器插件，也不需要复制粘贴题目和代码。

它不是复杂的 Agent 会话，也不是直接替用户完成题目。它尽量不打断手写过程，
用最简洁的文字帮助做题者理解题意，并根据当前代码只提示下一步。

## 亮点

- **最小打扰**：平时只有一个悬浮球，不占用编码空间，不主动弹出对话。
- **最少文字**：题意优先用一句大白话讲清楚，提示只给当前需要的一步。
- **延续手写**：自动读取最新代码，从用户已经写到的位置继续，不从头讲题。
- **渐进提示**：先给思路，再按需展示伪代码、边界、API 和局部片段。
- **流程而非聊天**：通过固定选项推进，不需要反复组织问题与模型对话。
- **保留主导权**：默认只读；代码写入必须由用户确认，并且可以撤销。

## 功能

- 自动识别当前题目、编程语言、编辑器代码和 Run/Submit 结果。
- `没思路`：先用大白话解释题意，再选择解题方法。
- `有思路`：根据当前代码生成精简伪代码，悬浮保留供手写时对照，再按需提示下一步。
- `直接看答案`：查看完整代码，并可写入编辑器和撤销。
- `复习这题`：结合上次的方法、错误和真实卡点继续复习。
- 开始手写后，再次点击悬浮球会读取最新代码继续提示，不会从头开始。
- 失败只显示红点，不自动弹窗，也不会自动消耗模型额度。
- 题目、尝试记录和复习记忆只保存在本地。
- 比赛、测评、面试和考试页面自动关闭辅导能力。

## 安装使用

在 [GitHub Releases](https://github.com/liuzhengxiang666/algo-companion/releases)
下载适合系统的安装包：

- Windows：下载 `.exe` 安装程序；
- macOS：下载对应芯片的压缩包；
- Ubuntu/Debian：下载 `.deb`；
- 其他 Linux：下载 `AppImage`。

Ubuntu/Debian 可以执行：

```bash
sudo apt install ./algo-companion_0.4.5_amd64.deb
```

安装后：

1. 打开 AhaCue；
2. 确认仅用于个人学习或非营利教育；
3. 在应用内登录刷题平台；
4. 通过齿轮选择可用的免费模型，或填写自己的 API Key；
5. 进入普通题目页面，点击悬浮球开始。

## 源码运行

环境要求：Node.js 20.20 或更高版本。

```bash
git clone https://github.com/liuzhengxiang666/algo-companion.git
cd algo-companion
chmod +x run.sh
./run.sh
```

Windows 克隆后双击 `run.cmd`。

开发检查：

```bash
pnpm typecheck
pnpm test
pnpm verify:public
```

## 说明

- 当前自动识别支持 `leetcode.cn` 普通题目页面。
- 页面识别只处理用户当前打开的可见页面，不批量抓取题库、不访问隐藏接口、
  不拦截网络请求，也不自动提交。
- 项目没有后端、账号系统或遥测；代码、错误和复习记录不上传服务器。
- 本项目与 LeetCode、领扣网络不存在隶属、合作或背书关系。
- 源码允许个人学习、非营利教育和研究，禁止商业使用。
- 禁止用于比赛、在线考试、招聘测评、作弊或自动提交。

详细条款见 [LICENSE](./LICENSE) 和 [DISCLAIMER.md](./DISCLAIMER.md)。

© 2026 liuzhengxiang666. AhaCue 作者保留署名权。
