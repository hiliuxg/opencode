# OpenCode Admin API 接口文档

以下是 `packages/admin` 提供的 API 接口及其接收参数说明。

## 1. 健康检查 (Health Check)

*   **路径**: `GET /health`
*   **功能**: 检查服务状态。
*   **参数**: 无。
*   **返回**:
    ```json
    {
      "ok": true,
      "uptime": 123.45,
      "scheduledJobs": 5,
      "timestamp": "2024-05-20T10:00:00.000Z"
    }
    ```

## 2. Cron 任务管理 (Jobs)

基础路径: `/api/jobs`

### 2.1 获取所有任务
*   **路径**: `GET /api/jobs`
*   **参数 (Query)**:
    *   `userId` (可选): 字符串，过滤指定用户的任务。
*   **返回**: 任务列表数组。

### 2.2 获取单个任务
*   **路径**: `GET /api/jobs/:id`
*   **参数 (Path)**:
    *   `id`: 任务 ID。
*   **返回**: 单个任务详情。

### 2.3 创建新任务
*   **路径**: `POST /api/jobs`
*   **参数 (Body - JSON)**:
    *   `userId` (必填): 字符串，用户 ID。
    *   `name` (必填): 字符串，任务名称。
    *   `cronExpression` (必填): 字符串，Cron 表达式 (例如 `0 9 * * *`)。
    *   `timezone` (可选): 字符串，默认 `"UTC"`。
    *   `prompt` (可选): 字符串，任务执行的 Prompt。
    *   `config` (可选): 对象 `Record<string, any>`，额外配置 (如 `providerID`, `modelID`)。
    *   `workspaceDir` (可选): 字符串，工作区路径。
    *   `maxRetries` (可选): 整数，最大重试次数，默认 `3`，必须 `>= 0`。
    *   `timeoutSeconds` (可选): 整数，超时秒数，默认 `300`，必须 `>= 1`。

### 2.4 更新任务
*   **路径**: `PUT /api/jobs/:id`
*   **参数 (Path)**:
    *   `id`: 任务 ID。
*   **参数 (Body - JSON)**:
    *   `name` (可选): 字符串。
    *   `cronExpression` (可选): 字符串。
    *   `timezone` (可选): 字符串。
    *   `prompt` (可选): 字符串。
    *   `config` (可选): 对象。
    *   `workspaceDir` (可选): 字符串。
    *   `enabled` (可选): 布尔值，设置启用/禁用状态。
    *   `maxRetries` (可选): 整数。
    *   `timeoutSeconds` (可选): 整数。

### 2.5 删除任务
*   **路径**: `DELETE /api/jobs/:id`
*   **参数 (Path)**:
    *   `id`: 任务 ID。
*   **返回**: `{ "ok": true, "deleted": "job-id" }`

### 2.6 切换任务启用状态
*   **路径**: `PATCH /api/jobs/:id/toggle`
*   **参数 (Path)**:
    *   `id`: 任务 ID。
*   **返回**: `{ "ok": true, "id": "...", "enabled": true/false }`

### 2.7 手动触发任务
*   **路径**: `POST /api/jobs/:id/run`
*   **参数 (Path)**:
    *   `id`: 任务 ID。
*   **返回**: 执行完成后返回 `{ "ok": true, "message": "job completed", "jobId": "...", "result": { "ok": true, "sessionId": "...", "duration": 12345 } }`；如果并发已满进入队列，则返回 `{ "ok": true, "message": "job queued", "jobId": "..." }`。

## 3. 执行记录 (Executions)

基础路径: `/api/executions`

### 3.1 获取执行历史
*   **路径**: `GET /api/executions`
*   **参数 (Query)**:
    *   `jobId` (可选): 字符串，过滤指定任务的执行记录。
    *   `limit` (可选): 整数，每页数量，默认 `20`，最大 `100`。
    *   `offset` (可选): 整数，分页偏移量，默认 `0`。
*   **返回**: 执行记录列表。

### 3.2 获取单次执行详情
*   **路径**: `GET /api/executions/:id`
*   **参数 (Path)**:
    *   `id`: 执行记录 ID。
*   **返回**: 单个执行记录详情。

## 4. 技能中心 (Skill Hub)

基础路径: `/api/skills`

### 4.1 获取技能列表
*   **路径**: `GET /api/skills`
*   **参数 (Query)**:
    *   `catalog` (可选): 字符串，过滤指定分类的技能。
    *   `name` (可选): 字符串，过滤指定名称的技能。
*   **返回**: 
    ```json
    {
      "ok": true,
      "items": [
        {
          "id": 1,
          "name": "技能名称",
          "catalog": "分类名称",
          "description": "描述",
          "userId": 1,
          "stars": 0,
          "createdAt": "2024-05-20T10:00:00.000Z",
          "updatedAt": "2024-05-20T10:00:00.000Z",
          "latestVersion": "1.0.0"
        }
      ]
    }
    ```

### 4.2 上传技能包
*   **路径**: `POST /api/skills`
*   **参数 (Body - multipart/form-data)**:
    *   `file` (必填): 文件对象，技能包 (例如 `.zip` 文件)。
    *   `name` (必填): 字符串，技能名称。
    *   `catalog` (必填): 字符串，技能分类，必须为 `会员`、`长音频`、`规模`、`AIK` 或 `直播` 之一。
    *   `version` (必填): 字符串，技能版本号。
    *   `userId` (必填): 字符串，上传用户的名称或数字 ID。
    *   `description` (可选): 字符串，技能描述。
*   **返回**: 
    ```json
    {
      "ok": true,
      "skillId": 2,
      "version": "1.0.0"
    }
    ```
