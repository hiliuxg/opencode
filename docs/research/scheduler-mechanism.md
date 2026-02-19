# Opencode 定时任务调度机制探索

本文档记录了对 `packages/opencode` 模块中定时调度代码的探索结果。

## 1. 核心调度器位置
核心代码位于：`/packages/opencode/src/scheduler/index.ts`

这是一个基于 `setInterval` 的轻量级定时调度框架，主要用于处理周期性的后台任务。

## 2. 核心架构

### 2.1 数据结构
核心类型定义如下：
```typescript
export namespace Scheduler {
  export type Task = {
    id: string          // 任务唯一标识
    interval: number    // 执行间隔（毫秒）
    run: () => Promise<void>  // 任务执行函数
    scope?: "instance" | "global"  // 作用域：实例级或全局级
  }
}
```

### 2.2 作用域机制 (Scope)
调度器根据 `scope` 属性决定任务的存储和清理逻辑：
- **`instance` (默认)**: 每个项目实例独立维护一套定时器。当实例销毁时（通过 `Instance.state` 管理），会自动调用 `clearInterval` 进行清理。
- **`global`**: 全局共享。即使有多个实例，同名的 `id` 只会注册一次，不会随着实例销毁。

## 3. 工作流程
1. **注册**: 调用 `Scheduler.register(task)`。
2. **防重**: 如果是全局作用域且已存在相同 `id`，则忽略。
3. **即时启动**: 注册后会立即异步调用一次 `task.run()`。
4. **周期执行**: 使用 `setInterval` 定时执行，并通过 `timer.unref()` 确保定时器不会阻止 Node.js 进程正常退出。

## 4. 现有应用场景
目前项目中已有两个功能使用了该调度器：

| 任务 ID | 位置 | 作用域 | 间隔 | 功能描述 |
| :--- | :--- | :--- | :--- | :--- |
| `tool.truncation.cleanup` | `src/tool/truncation.ts` | global | 1 小时 | 清理 `tool-output` 目录下超过 7 天的截断输出文件。 |
| `snapshot.cleanup` | `src/snapshot/index.ts` | instance | 1 小时 | 为每个实例定期执行 `git gc --prune=7.days`，清理快照数据。 |

## 5. 结论
`opencode` 的定时任务机制非常简洁，适合用于周期性的资源清理或状态同步。它与 `Instance` 生命周期紧密集成，通过 `scope` 机制灵活支持了“每个项目特有”和“全局通用”两种后台任务模式。
