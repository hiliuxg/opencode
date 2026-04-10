# 开发与构建指南 (Development & Build Guide)

本文档介绍如何在本地开发、编译以及使用 Docker 部署 OpenCode。

---

## 1. 本地开发 (Development)

### 前置要求
*   **Bun**: 1.3.5+
*   **Ripgrep (rg)**: 必须安装在系统中。

### 初始化
```bash
bun install
```

### 运行服务端 (Backend)
```bash
# 在项目根目录下运行
bun dev serve --port 4096
```

### 运行 Web 客户端 (Frontend)
```bash
cd packages/app
bun dev
```
*   **指定端口**: `VITE_OPENCODE_SERVER_PORT=8012 bun dev`
*   **指定路径**: 访问 `http://localhost:3000/<Base64_Encoded_Path>`

---

## 2. 编译打包 (Build)

### 编译单文件二进制
```bash
# 针对当前平台（推荐）
script/build.ts --single

# 如果遇到 Integrity 错误，跳过安装步骤
opencode/script/build.ts --single --skip-install
```

### 全平台构建 (macOS, Linux, Windows)
```bash
opencode/script/build.ts
```
**产物路径**: `packages/opencode/dist/`

---

## 3. Docker 构建与部署

### 在 Colima/Mac 环境下配置 Buildx
1.  **安装**: `brew install docker-buildx`
2.  **配置**: `mkdir -p ~/.docker/cli-plugins && ln -sfn /opt/homebrew/opt/docker-buildx/bin/docker-buildx ~/.docker/cli-plugins/docker-buildx`

### 步骤 A：进入目录 (必选)
```bash
cd packages/opencode
```

### 步骤 B：准备 Web 客户端产物 (必选)
目前 Dockerfile 需要 `packages/app/dist` 目录。在构建镜像前，必须先编译 Web 客户端并将其移动到 `packages/opencode/app-dist`。
```bash
# 1. 编译 Web 客户端
cd packages/app
bun run build

# 2. 复制到 opencode 目录下的缓存目录
mkdir -p ../opencode/app-dist
cp -r dist/* ../opencode/app-dist/

# 3. 回到 packages 目录
cd ..
```

### 步骤 C：构建镜像  
**构建 macOS 专用镜像 (v1 版本)**:
   ```bash
   docker buildx build --platform linux/arm64 \
     -t macos:v6 --load .
   ```

### 步骤 C：导出镜像包
```bash
docker save -o opencode-macos-v1.tar macos:v1
```

### 步骤 D：在离线 macOS 中运行
```bash
docker run -it --rm \
  -p 4096:4096 \
  -v $(pwd):/work \
  -e OPENCODE_DISABLE_MODELS_FETCH=true \
  macos:v1 web --hostname 0.0.0.0
```

**关键参数解释：**
*   **`-v $(pwd):/work`**: 将宿主机当前目录挂载到容器内的 `/work` 目录。
*   **`--hostname 0.0.0.0`**: 必须加上此参数，否则宿主机浏览器无法访问容器内的服务。
*   **目录说明**: 启动后，Web 界面默认看到的“当前目录”是容器内部的路径（默认为 `/`）。你需要在 Web 界面中打开 **`/work`** 目录（Base64 编码后的 URL）才能操作你挂载进去的宿主机代码。

---

## 4. 调试与排错 (Debug)

### 进入 Docker 容器内部
如果要检查镜像内部文件或环境，可以使用以下命令覆盖 Entrypoint 进入 Shell：
```bash
docker run -it --rm --entrypoint /bin/sh opencode:macos
```

---

## 5. Docker 离线部署 (CentOS 7 / Linux AMD64)

针对无法联网的 CentOS 7 服务器，需要在本地（Mac/Windows）构建好 `linux/amd64` 架构的镜像，导出后上传到服务器。

### 步骤 A：本地构建镜像 (Mac/Windows)
确保你已经安装了 Docker Desktop，并且开启了 Buildx 支持。

1.  **进入项目目录**:
    ```bash
    cd packages/opencode
    ```

2.  **构建 AMD64/centos 镜像**:
    ⚠️ 注意：CentOS 是 x86_64 架构，必须指定 `--platform linux/amd64`。
    ```bash
    docker buildx build --platform linux/amd64 \
      -t opencode-serve-1814 \
      --load \
      .
    ```

3.  **导出镜像为文件**:
    ```bash
    docker save -o opencode-serve-v125-1949.tar opencode-serve-v125-1949
    ```

### 步骤 B：上传到服务器
使用 `scp` 或 `sftp` 将 `opencode-centos-v1.tar` 上传到 CentOS 服务器。
```bash
# 示例
scp opencode-centos-v1.tar user@your-centos-server:/home/user/
```

    ### 步骤 C：服务器端加载与运行 (CentOS 7)

    1.  **准备配置目录 (重要)**:
        为了防止服务器在启动时尝试联网安装插件导致卡死，必须手动创建一个包含 `node_modules` 的配置目录。
        ```bash
        mkdir -p opencode_data/config/node_modules
        ```

    2.  **加载镜像**:
        ```bash
        docker load -i opencode-centos-v1.tar
        ```

    3.  **运行容器**:
        CentOS 7 内核较老，且可能没有网络权限。请使用以下命令启动：
        ```bash
        # 创建工作目录（如果需要）
        mkdir -p /data/opencode_work

        docker run -d \
          --name opencode-server \
          --restart always \
          -p 4096:4096 \
          -v /data/opencode_work:/work \
          -v $(pwd)/opencode_data/config:/root/.config/opencode \
          -e OPENCODE_DISABLE_MODELS_FETCH=true \
          -e OPENCODE_DISABLE_DEFAULT_PLUGINS=true \
          -e OPENCODE_DISABLE_LSP_DOWNLOAD=true \
          opencode-centos:v1 \
          web --hostname 0.0.0.0
        ```

    **参数说明**:
    *   `web --hostname 0.0.0.0`: **必须**。启动 Web 服务并允许外部访问。
    *   `-v ...:/root/.config/opencode`: **关键**。挂载伪造的配置目录，骗过程序的插件安装检查，避免离线卡死。
    *   `-e OPENCODE_DISABLE_MODELS_FETCH=true`: 禁用模型下载（离线必选）。
    *   `-e OPENCODE_DISABLE_DEFAULT_PLUGINS=true`: **关键**。禁用自动安装默认插件。
    *   `-e OPENCODE_DISABLE_LSP_DOWNLOAD=true`: **关键**。禁用自动下载语言服务器。
    *   `--restart always`: 容器异常退出或重启后自动启动。
    *   `-v ...:/work`: 挂载代码目录。

3.  **验证运行**:
    ```bash
    docker logs -f opencode-server
    ```
    看到 `OpenCode server running at http://0.0.0.0:4096` 即表示成功。



sudo docker run \
  -it --rm \
  -p 4096:4096 \
  -e OPENCODE_DISABLE_MODELS_FETCH=true \
  -e OPENCODE_DISABLE_DEFAULT_PLUGINS=true \
  -e OPENCODE_DISABLE_LSP_DOWNLOAD=true \
  -v /data1/opencode:/home \
  opencode-serve-1053:latest \
  --log-level DEBUG --print-logs serve --hostname 0.0.0.0  


  
opencode-app-2251:latest



# 上一个版本 opencode-v125-03152153 
# 上一个版本 opencode-v125-03252302
# 上一个版本 opencode-v125-03262334 
# 上一个版本 opencode-v125-03282001 45f94d09e8a3
# 上一个版本 45f94d09e8a3   opencode-v125-03282001 

# 前端构建

export OPENCODE_BASE_PATH=/kgbi/starbot

bun run --cwd packages/app build

# 后端构建

export OPENCODE_BASE_PATH=/kgbi/starbot
export OPENCODE_SKILL_MARKET_TOKEN=4LXfT11bcFQaU5T27Zgw40G7jYB

OPENCODE_CHANNEL=latest OPENCODE_VERSION=1.3.13 ./packages/opencode/script/build.ts

docker buildx build --platform linux/amd64 \
      -t opencode-v1313-04101052 \
      --load \
      . 

docker save -o opencode-v1313-04101052.tar opencode-v1313-04101052

sudo docker load -i opencode-v1313-04101052.tar
  
  
sudo docker run  -d \
  -p 4096:4096 \
  -e OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX=10240 \
  -e OPENCODE_ACCESS_GRANTS=/root/.config/opencode/grants.json \
  -e OPENCODE_BASE_PATH=/kgbi/starbot \
  -e OPENCODE_SKILL_MARKET_TOKEN=4LXfT11bcFQaU5T27Zgw40G7jYB \
  -e OPENCODE_DISABLE_MODELS_FETCH=true \
  -e OPENCODE_DISABLE_DEFAULT_PLUGINS=true \
  -e OPENCODE_DISABLE_LSP_DOWNLOAD=true \
  -e OPENCODE_GLOBAL_PLUGIN_INSTALL_ONLY=true \
  -v /data1/opencode:/home \
  -v /data1/opencode/base-1333/config:/root/.config/opencode \
  -v /data1/opencode/base-1333/local:/root/.local \
  opencode-v1313-04101052 \
  --print-logs serve --hostname 0.0.0.0 --cors * --log-level INFO  



docker exec -it 3f38319046be  /bin/sh


10.34.81.146:4097

/root/.config/opencode/skill_sync.sh upload https://kudata-agent.tmeoa.com/opencode /root/.config/opencode/skills/skill-creator leoliu AIK -l

上一个 opencode镜像 opencode-v125-03091425:latest