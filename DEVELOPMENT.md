# OpenCode 开发指南 (DEVELOPMENT.md)

本指南旨在帮助开发者快速了解 OpenCode 的项目架构、技术栈以及如何在本地环境进行开发。

---

## 1. 技术栈 (Technology Stack)

OpenCode 是一个基于 TypeScript 开发的高性能 AI 辅助工具，采用了现代化的开发工具链：

- **运行时 (Runtime)**: [Bun](https://bun.sh/) 1.3.9+ (作为包管理器、测试运行器及脚本引擎)。
- **后端/服务端核心**: 
    - **API 框架**: [Hono](https://hono.dev/)，一个极简且快速的 Web 框架。
    - **云原生部署**: [SST (Serverless Stack) v3](https://sst.dev/)。
    - **AI SDK**: 使用 Vercel 的 [AI SDK](https://sdk.vercel.ai/) 进行多模型交互。
- **前端/用户界面**:
    - **UI 框架**: [SolidJS](https://www.solidjs.com/) (高性能、细粒度响应式)。
    - **元框架**: [Solid Start](https://start.solidjs.com/)。
    - **CSS 框架**: [Tailwind CSS v4](https://tailwindcss.com/)。
    - **终端界面 (TUI)**: 基于 [opentui](https://github.com/sst/opentui)。
- **桌面端**: [Tauri](https://tauri.app/) (基于 Rust 的跨平台应用框架)。
- **项目管理**: [Turbo](https://turbo.build/) (用于 Monorepo 构建优化)。

---

## 2. 项目架构 (Architecture)

OpenCode 采用 **Monorepo (单体仓库)** 架构，通过 **Bun Workspaces** 管理子包：

- **核心包 (`packages/opencode`)**: 包含 Agent 逻辑、LSP 适配、API 服务端及 TUI 逻辑。
- **Web 应用 (`packages/app`)**: 全功能的 Web 交互界面。
- **桌面端 (`packages/desktop`)**: 将 Web 应用包装为桌面原生程序。
- **共享插件/SDK**: `packages/plugin` 和 `packages/sdk` 供跨包复用。

项目遵循 **服务端-客户端 (Server-Client)** 模型，服务端负责 AI 控制流和文件系统交互，客户端（TUI/Web/Desktop）通过 SDK 与服务端通信。

---

## 3. 本地开发环境设置

### 3.1 准备工作
请确保你的系统已安装 **Bun 1.3+**。

### 3.2 安装依赖
OpenCode 使用 Bun Workspaces，你**只需在根目录**执行一次安装即可：
```bash
bun install
```
此命令会自动安装所有子包的依赖，无需逐一进入文件夹安装。

---

## 4. 跑起项目

### 4.1 启动服务端 (Headless Server)
如果你只需要 API 服务，在根目录下运行：
```bash
bun dev serve
```
- **默认监听端口**: `4096`。
- **自定义端口**: `bun dev serve --port <port>`。

### 4.2 启动 Web 界面
有两种方式运行 Web 端：

#### 方案 A：一键启动 (服务端 + Web)
```bash
bun dev web
```
这将启动服务端并自动在浏览器中打开 `http://127.0.0.1:4096/`。

#### 方案 B：独立启动前端 (热更新开发模式)
1. 终端 1 启动服务端：`bun dev serve`
2. 终端 2 启动前端：`bun run --cwd packages/app dev`
   - 前端通常运行在 `http://localhost:3000` 或 `5173`。

---

## 5. 核心代码导引
- **Agent 逻辑**: `packages/opencode/src/agent/`
- **API 定义**: `packages/opencode/src/server/`
- **前端页面**: `packages/app/`
- **TUI 界面**: `packages/opencode/src/cli/cmd/tui/`
