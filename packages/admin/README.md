# OpenCode Admin

OpenCode Admin 是一个用于集中管理多个 OpenCode 实例定时任务的服务。它利用 `croner` 提供秒级精度的定时调度，并通过 API 远程触发 `opencode serve` 实例执行任务。

## 核心特性

- **集中式调度**：统一管理所有用户的 Cron 任务，无需每个用户容器常驻后台。
- **SQLite 存储**：使用 Drizzle ORM + Bun SQLite，轻量级且高性能。
- **Executor 机制**：自动为每个触发的任务创建会话并发送 `prompt_async`。
- **模型支持**：支持在任务配置中指定 `providerID` 和 `modelID`（例如 `kimi-2.5`）。
- **工作区透明**：自动通过 `x-opencode-directory` 传递用户的 workspace 路径。

---

## 快速开始

### 本地开发

1. **安装依赖**
   ```bash
   cd packages/admin
   bun install
   ```

2. **启动服务**
   ```bash
   bun run dev
   ```
   默认监听 `http://localhost:8787`。

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `ADMIN_PORT` | 服务监听端口 | `8787` |
| `ADMIN_HOST` | 服务监听地址 | `0.0.0.0` |
| `DATABASE_PATH` | SQLite 数据库文件路径 | `~/.config/opencode-admin/admin.db` |

---

## API 接口文档

### 健康检查
`GET /health`
- 返回服务运行时间和调度任务总数。

### Cron 任务管理 (`/api/jobs`)

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/` | 获取所有任务。支持 `?userId=xxx` 过滤。 |
| `GET` | `/:id` | 获取单个任务详情（含下次执行时间 `nextRun`）。 |
| `POST` | `/` | 创建新任务。 |
| `PUT` | `/:id` | 更新任务信息（如 Cron 表达式、Prompt、配置）。 |
| `DELETE` | `/:id` | 删除任务并停止调度。 |
| `PATCH` | `/:id/toggle` | 启用/禁用任务。 |
| `POST` | `/:id/run` | 立即手动触发一次执行。 |

### 执行记录 (`/api/executions`)

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/` | 获取执行历史。支持 `?jobId=xxx&limit=20&offset=0`。 |
| `GET` | `/:id` | 获取单次执行详情（状态、错误信息、持续时间等）。 |

#### 创建任务示例 (POST `/api/jobs`)
```json
{
  "userId": "leoliu",
  "name": "每日代码审查",
  "cronExpression": "0 9 * * *",
  "timezone": "Asia/Shanghai",
  "prompt": "请检查 /Users/leoliu/mycode/project 下昨天的提交并汇总",
  "config": {
    "providerID": "kimi",
    "modelID": "kimi-2.5"
  }
}
```

---

## 线上部署

推荐使用 **Docker** 进行部署，以确保环境一致性。

### 1. 编写 Dockerfile (参考)

项目根目录下已准备好基础构建链路，对于 admin 包：

```dockerfile
FROM oven/bun:1.1 AS base
WORKDIR /app

COPY package.json bun.lockb ./
COPY packages/admin/package.json ./packages/admin/
RUN bun install

COPY packages/admin ./packages/admin
WORKDIR /app/packages/admin

EXPOSE 8787
ENTRYPOINT ["bun", "run", "src/index.ts"]
```

### 2. Docker Compose 配置

```yaml
services:
  opencode-admin:
    build: 
      context: ../../
      dockerfile: ./packages/admin/Dockerfile
    ports:
      - "8787:8787"
    volumes:
      - ./admin-data:/app/data
    environment:
      - DATABASE_PATH=/app/data/admin.db
      - ADMIN_PORT=8787
    restart: always
```

### 3. 注意事项
- **网络互通**：确保 Admin 服务能够通过网络访问到 `opencode serve` 所在的容器或主机地址。
- **持久化**：务必挂载 `/app/data` 目录以保留 SQLite 数据库文件。
- **安全**：目前 API 为开放状态，线上部署建议在 Nginx 层增加 Basic Auth 或 IP 白名单限制。
