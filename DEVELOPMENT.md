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

---

## 6. Docker 部署 (Docker Deployment)

本节介绍如何构建 OpenCode 的 Docker 镜像并在服务器上运行。

### 6.1 打包与构建 (Build & Package)

由于 Dockerfile 采用的是将本地构建产物打包进镜像的策略，因此在构建 Docker 镜像之前，需要先在本地完成编译。

1.  **编译项目产物**：
    在根目录下执行：
    ```bash
    # 使用 Turbo 并行构建所有子包
    bun x turbo build
    ```
    此命令会生成：
    - 后端二进制文件：位于 `packages/opencode/dist/`
    - 前端静态资源：位于 `packages/app/dist/`

2.  **构建 Docker 镜像**：
    ```bash
    # 构建 amd64 架构镜像
    docker buildx build --platform linux/amd64 -t opencode:latest --load .
    ```

### 6.2 导出与导入镜像 (Export & Import)

如果需要在内网环境或不同机器间分发镜像：

1.  **导出镜像文件**：
    ```bash
    docker save -o opencode-latest.tar opencode:latest
    ```

2.  **在目标机器加载镜像**：
    ```bash
    sudo docker load -i opencode-latest.tar
    ```

### 6.3 运行容器 (Running the Container)

推荐使用以下配置运行容器，以确保数据的持久化和环境的适配：

```bash
docker run -d \
  --name opencode \
  -p 4096:4096 \
  -e OPENCODE_DISABLE_MODELS_FETCH=true \
  -e OPENCODE_DISABLE_DEFAULT_PLUGINS=true \
  -e OPENCODE_DISABLE_LSP_DOWNLOAD=true \
  -v /data1/opencode:/home \
  -v /data1/opencode/base/config:/root/.config/opencode \
  -v /data1/opencode/base/local:/root/.local \
  opencode:latest \
  serve --hostname 0.0.0.0 --cors "*" --log-level DEBUG --print-logs
```

#### 参数详解：
- **端口映射 (`-p`)**: 将容器内的 `4096` 端口映射到宿主机的 `4096`。
- **环境变量 (`-e`)**: 
  - `OPENCODE_DISABLE_MODELS_FETCH`: 禁用模型自动拉取（适用于受限网络）。
  - `OPENCODE_DISABLE_DEFAULT_PLUGINS`: 禁用默认插件加载。
  - `OPENCODE_DISABLE_LSP_DOWNLOAD`: 禁用 LSP 自动下载。
- **卷挂载 (`-v`)**: 
  - `/home`: 挂载工作目录。
  - `/root/.config/opencode`: 挂载配置文件目录。
  - `/root/.local`: 挂载本地缓存及数据目录。
- **启动参数**: 指定 `serve` 模式运行，监听 `0.0.0.0`，允许所有跨域请求 (`--cors "*"`)。
