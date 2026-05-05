# OpenCode Admin

OpenCode 管理后台系统。

## 环境配置

在运行项目之前，请确保设置了必要的环境变量（或使用默认值）：

| 变量名 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `MYSQL_HOST` | `localhost` | 数据库主机地址 |
| `MYSQL_PORT` | `3306` | 数据库端口 |
| `MYSQL_USER` | `root` | 数据库用户名 |
| `MYSQL_PASSWORD` | `password` | 数据库密码 |
| `MYSQL_DATABASE` | `admin_db` | 数据库名 |

## 开发环境启动

本项目使用 [Bun](https://bun.sh/) 作为运行时和包管理器。

1. **安装依赖**
   ```bash
   bun install
   ```

2. **启动开发服务器**
   该命令会利用 `concurrently` 同时启动后端 (Bun) 和前端 (Vite)。
   ```bash
   bun dev
   ```
   - **后端**: `http://localhost:8787`
   - **前端**: `http://localhost:5173`

3. **单独启动**
   - 仅启动后端：`bun run dev:backend`
   - 仅启动前端：`bun run dev:frontend`

## Docker 线上打包与部署

我们推荐使用 Docker 进行容器化部署。

### 1. 准备工作
确保你已经执行了本地构建，产出了 `bin` 目录下的后端二进制文件（该脚本已配置为输出适配 Alpine 的 `musl` 版本）：
```bash
bun run build
```

### 2. 构建 Docker 镜像
在 `packages/admin` 目录下执行构建。

- **构建原生平台镜像 (推荐):** 
  ```bash
#  docker build -t opencode-admin-05036355 .
  ```
- **构建特定平台镜像 (例如针对 CentOS):**
  ```bash
  docker build --platform linux/amd64 -t opencode-admin-05036355 .
  ```

### 3. 镜像导出与导入 (跨机器迁移)
如果你在本地构建，需要将镜像同步到远程服务器（如 CentOS），可以使用 save/load 方式：

1. **本地机器：导出镜像为 tar 文件**
   ```bash
   docker save -o  opencode-admin-05036355.tar  opencode-admin-05036355
   ```

2. **将文件上传至服务器并导入**
   ```bash
   # 上传（示例）
   scp opencode-admin.tar root@your-server-ip:/root/
   # 服务器上：载入镜像
   docker load -i opencode-admin-05036355.tar
   ```

### 4. 使用 Docker 启动 (及环境变量处理)

启动时通过环境变量传递 MySQL 配置：

**方式一：命令行参数 `-e`**
```bash
docker run -d \
  -p 8787:8787 \
  -e MYSQL_HOST=10.5.140.127 \
  -e MYSQL_USER=root \
  -e MYSQL_PASSWORD=admin@kugou123 \
  -e MYSQL_PORT=3306 \
  -e MYSQL_DATABASE=databot_admin \
  -e SKILL_SYNC_SCRIPT=/root/.config/opencode/skill_sync.sh \
  -e OPENCODE_HOST=http://10.34.81.146:4096 \
  -e OPENCODE_DIR=/home/xiaogenliu \
  -e GUIDED_TOPIC_SKILLS=skill-creator \
  -v /data1/opencode_dist/admin/storage:/storage/skills \
  opencode-admin-05036355 --basepath opencode
```

**方式二：使用 .env 文件**
```bash
docker run -d --name opencode-admin -p 8787:8787 --env-file .env opencode-admin
```

### 4. 数据库初始化
镜像内不包含数据库。请确保：
1. 已通过 `bun run db:migrate` 初始化数据库。
2. 数据库连接信息在上述步骤中已正确注入容器。

## 数据库初始化 (SQL 导入)

数据库基于 MySQL，必须先创建数据库（默认名为 `admin_db`）。

1. **自动初始化/迁移**
   运行以下命令会自动按照定义删除旧表并重新创建所有表，同时初始化一个默认用户：
   ```bash
   bun run db:migrate
   ```

2. **手动 SQL 导入**
   如果你需要手动导入 SQL 脚本：
   - SQL 文件路径: `src/db/init.sql`
   - 使用命令行导入:
     ```bash
     mysql -u <user> -p <database_name> < src/db/init.sql
     ```
