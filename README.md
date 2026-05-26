# Windsurf Session Exporter

一个用于导出本机 Windsurf Cascade / Agent 会话正文的小工具。

它会通过 Windsurf 自己正在运行的本地 language server RPC 读取会话，再把原始 transcript 清洗成更适合阅读、归档和检索的 Markdown / JSON。

## 功能特性

- 自动发现正在运行的 `language_server_windows_x64.exe`
- 自动检测 Windsurf 本地 RPC 端口
- 通过本机 CSRF 校验调用 Windsurf language server
- 调用 `GetAllCascadeTrajectories` 和 `GetCascadeTranscriptForTrajectoryId`
- 默认过滤 Tool / system step 噪声，只保留 `User` 和 `Assistant` 正文
- 支持导出 Markdown 和 JSON
- 支持 Web UI 预览、搜索、单个导出、批量导出
- 兼容 Windows PowerShell 5.1 和 PowerShell 7+
- 修复 Windows 管道编码导致的中文乱码问题

## 隐私说明

本工具只读取你本机 Windsurf 已缓存的 session 数据，并通过本机 `127.0.0.1` RPC 访问 Windsurf language server。

默认不会提交或上传导出的会话正文。仓库里的 `.gitignore` 已忽略：

- `exports/`
- `tmp-*/`
- `debug_*.txt`

注意：导出的 Markdown / JSON 可能包含你的提示词、代码、文件路径、终端输出或其他敏感信息。公开仓库前请不要手动把 `exports/` 加入 Git。

## 环境要求

- Windows
- 已安装并登录 Windsurf
- Windsurf 正在运行，Cascade / Agent 面板可正常打开
- Node.js 18+，用于 Web UI
- PowerShell 5.1 或 PowerShell 7+

## 获取代码

```powershell
git clone https://github.com/dusk2999/windsurf-session-exporter.git
cd windsurf-session-exporter
```

如果你已经下载过本项目，直接在项目目录里运行后续命令即可。

## 快速启动 Web UI

打开 Windsurf，并确保 Cascade / Agent 面板已经正常加载。然后在项目目录中双击：

```text
start.bat
```

或在命令行运行：

```powershell
node server.js
```

服务默认从 `http://localhost:3000` 启动。如果端口被占用，会自动尝试 `3001`、`3002` 等后续端口，并打开浏览器。

## Web UI 能做什么

- 左侧列表展示所有 Windsurf session
- 支持按标题、工作区、CascadeId 搜索
- 支持预览清洗后的会话正文
- 支持切换是否包含 Tool 执行步骤
- 支持代码块语法高亮和一键复制
- 支持单个导出 Markdown / JSON
- 支持批量导出全部 session
- 导出文件默认保存到 `exports/`

## 命令行用法

列出最近 20 条 session：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\Export-WindsurfSession.ps1 -List -Limit 20
```

导出最近修改的一条 session：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\Export-WindsurfSession.ps1
```

导出指定 session：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\Export-WindsurfSession.ps1 -CascadeId "86f62e25-f2e5-4d3f-9513-b65bc750e117"
```

导出全部 session：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\Export-WindsurfSession.ps1 -All
```

导出时包含 Tool 步骤：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\Export-WindsurfSession.ps1 -CascadeId "<cascade-id>" -IncludeTools
```

只导出 JSON：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\Export-WindsurfSession.ps1 -CascadeId "<cascade-id>" -JsonOnly
```

只导出 Markdown：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\Export-WindsurfSession.ps1 -CascadeId "<cascade-id>" -MarkdownOnly
```

指定输出目录：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\Export-WindsurfSession.ps1 -OutDir "D:\exports"
```

## 输出格式

Markdown 会按角色整理为：

```markdown
# Session Title

- CascadeId: `...`
- TotalSteps: 297
- ExportedAt: 2026-05-26 11:18:14 +08:00

## User 1

...

## Assistant 1

...
```

JSON 会保留结构化字段：

```json
{
  "cascadeId": "...",
  "title": "...",
  "status": "...",
  "createdTime": "...",
  "lastModifiedTime": "...",
  "workspace": "...",
  "numTotalSteps": 297,
  "includeTools": false,
  "messages": []
}
```

## 工作原理

Windsurf 的 session 缓存文件通常位于：

```text
C:\Users\<you>\.codeium\windsurf\cascade\*.pb
```

这些 `.pb` 文件不是直接可读的明文正文。Windsurf 自带的 language server 负责解包和读取这些 session。本工具不会硬解析 `.pb`，而是复用 Windsurf 本地运行时提供的 RPC 接口读取 transcript。

读取流程大致是：

1. 找到 `language_server_windows_x64.exe`
2. 找到它监听的本地端口
3. 从进程环境读取本机 CSRF 值
4. 请求本地 RPC 获取 session 列表和 transcript
5. 清洗 transcript，输出 Markdown / JSON

## 测试

运行清洗逻辑测试：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tests\transcript-parser.tests.ps1
```

运行 Windows PowerShell 5.1 中文编码回归测试：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tests\ps51-encoding-regression.tests.ps1
```

检查前端和服务端 JS 语法：

```powershell
node --check .\server.js
node --check .\public\app.js
```

## 常见问题

### GitHub 上看不到仓库？

如果仓库是 private，未登录对应账号时 GitHub 会显示 404。把仓库改成 public 或登录正确账号即可。

### 预览或导出中文乱码？

请使用当前版本。旧版在 Windows PowerShell 5.1 下可能会把 UTF-8 响应按错误编码解码，导致出现 `å¹¶æ...` 这类 mojibake。当前版本已经改为按 UTF-8 字节读取 RPC 响应。

### 找不到 Windsurf language server？

先打开 Windsurf，并确保 Cascade / Agent 面板已经正常加载。然后重新运行导出命令或刷新 Web UI。

### 批量导出会不会上传到云端？

不会。导出发生在本机，文件写入本地 `exports/` 目录。

## 文件结构

```text
.
├── Export-WindsurfSession.ps1       # CLI 导出入口
├── WindsurfSessionExport.psm1       # transcript 清洗和 Markdown 生成逻辑
├── server.js                        # 原生 Node.js Web 服务
├── start.bat                        # 双击启动脚本
├── public/
│   ├── index.html                   # Web UI 页面
│   ├── style.css                    # 样式
│   ├── app.js                       # 前端交互逻辑
│   └── libs/                        # 离线前端依赖缓存
└── tests/
    ├── transcript-parser.tests.ps1
    └── ps51-encoding-regression.tests.ps1
```
