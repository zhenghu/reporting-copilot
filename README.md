# Reporting Copilot

汇报工作台 · Mac 独立版。通过本机 Codex 逐页制作、讨论和修改交互式 HTML 汇报，用户确认页面后自动合稿。

## 快速开始

1. 克隆或下载整个仓库，保留 `app/` 和 `runtime/`。
2. 安装并登录 Codex。
3. 双击 `启动汇报工作台.command`，浏览器将打开 <http://127.0.0.1:18776/>。
4. 使用完毕后，双击 `关闭汇报工作台.command` 停止后台服务，本地报告和数据保留。

启动器优先使用通过自检的本机 Python 3.9 或更新版本；没有可用版本时，使用附带的 Apple Silicon 或 Intel Python 运行环境，无需另装 Node 或 Homebrew。首次打开未签名程序的处理方法见 [先读我.md](先读我.md)。

## 功能

- 按大纲创建 1 至 60 页汇报，最多 5 个写作任务并发。
- 每页独立 Codex 会话，支持继续讨论、修改和查看公开进展。
- 草稿、已确认版本和历史合稿分别保存。
- 支持文本、SVG 对象和连线的直接编辑。
- 用户逐页确认后自动合稿，整篇检查通过后可定稿并下载自包含 HTML。

AI 写作目前固定调用 Codex CLI，模型为 `gpt-6-astra`，推理强度为 `medium`，使用本机账号额度。模型可用性取决于账号和 Codex 版本；本工具不是离线模型。

## 代码结构

```text
app/
├── standalone_launch.py   # 登录检测与后台启动
├── server.py              # 本机 HTTP API 与静态资源
├── coordinator.py         # Codex 调用、队列与会话
├── store.py               # 数据、版本、大纲与合稿
├── context_budget.py      # 增量任务上下文与文件交稿
├── live_progress.py       # 公开任务进展
├── codex_project.py       # Codex 桌面工作区
├── studio_client.py       # 总工命令行客户端
├── direct_edit.py         # HTML 编辑补丁
├── standalone_export.py   # 整篇定稿检查
├── authoring-kit/         # 汇报作者规范
└── web/                   # 原生 JavaScript、CSS 与字体
runtime/                   # 两种 Mac 架构的 Python 归档
```

后端使用 Python 标准库，前端使用原生 JavaScript 和 CSS，不需要构建步骤。

## 数据与校验

启动器将应用安装到 `~/Library/Application Support/ReportStudio/application`，报告与版本保存在 `~/Library/Application Support/ReportStudio/data`。这些运行数据不属于仓库，不应随安装包分享。

服务仅监听本机回环地址。AI 写作时，任务材料会发送到用户配置的 Codex 服务；凭据由 Codex 管理。

校验原始交付文件：

```sh
shasum -a 256 -c SHA256SUMS.txt
```

`SHA256SUMS.txt` 覆盖原始交付包文件，不包含后续新增的仓库说明文件；后续修复过的启动器和使用说明会与原始校验值不同。运行环境来源和哈希见 [runtime/manifest.json](runtime/manifest.json)，交付验收范围见 [交付检查.md](交付检查.md)。

## 已知限制

- 内置 Python 在部分 Mac 环境可能被系统终止；启动器会优先使用通过自检的本机 Python，并在需要重新解压时备份、替换不完整的内置环境。没有可用运行环境时，处理方法见使用文档。
- 已有后台服务运行时，启动器会复用它；使用新版前应先停止旧服务。
- 当前 HTML 去重逻辑不会保存仅摘要或证据发生变化的提交。
- Intel 运行环境尚未完成 Intel 真机验收。
- 当前仓库未附自动化测试套件或 CI 工作流。

字体许可证位于 `app/web/typefaces/OFL.txt`，Python 发行归档内附其许可证。
