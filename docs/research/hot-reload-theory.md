# OpenWork 热加载 (Hot Reload) 实现原理与调研报告

## 1. 核心流程

OpenWork 的热加载并不是传统前端意义上的 HMR，而是一种基于 **Unix 信号 (SIGUSR2)** 触发的 **"软重载" (Soft Reload) 机制**。

### 交互链路
1. **触发源 (openwrk)**: `openwrk` (headless CLI) 在启动 `opencode` 进程时，通过环境变量注入热加载配置。
2. **信号传递**: 当需要重载时（例如配置文件变动），系统（或外部触发器）向 `opencode` 主进程发送 `SIGUSR2` 信号。
3. **主线程响应**: `opencode` 的 TUI 主线程监听该信号，并通过 RPC 通知 Worker 线程。
4. **内部执行**: Worker 执行 `reload()`，重置配置缓存并销毁重建所有项目实例。

## 2. 交互逻辑

| 维度 | 实现方式 |
| :--- | :--- |
| **配置注入** | `openwrk` 使用环境变量 `OPENCODE_HOT_RELOAD` 系列传参。 |
| **信号机制** | 监听 `process.on("SIGUSR2", ...)`。 |
| **进程内交互** | 使用自定义的 `Rpc.client` / `Rpc.listen` 机制在线程间同步重载状态。 |
| **文件监控** | 集成 `@parcel/watcher`，利用跨平台原生后端（FSEvents/inotify/Windows API）监控文件变化。 |

## 3. 性能分析

### 性能消耗评估：极低

该机制通过以下设计保证了高性能：

1. **非重启式重载**: 
   - **不重启进程**。避免了 JS 引擎重新初始化、HTTP 服务重新 bind 端口以及子进程 spawn 的高昂开销。
2. **懒加载 (Lazy Load)**:
   - `Config.global.reset()` 仅重置两个布尔位。真正的配置文件 I/O 只在重载后的第一次业务请求时触发。
3. **并行销毁**:
   - `Instance.disposeAll()` 使用 `Promise.all` 并行清理状态及退订文件监控，速度极快。
4. **防抖与冷却**:
   - `openwrk` 侧内置了默认 700ms 的防抖 (Debounce) 和 1500ms 的冷却 (Cooldown) 时间，防止文件频繁写入导致的重载风暴。

## 4. 结论

OpenCode 内部的热加载设计非常优雅。它通过 **"内存状态清理 + 懒加载重建"** 的方式，实现了近乎瞬时的配置更新，同时保持了极低的系统资源占用，适合在高频协作的 AI 编码场景下使用。

---

## 5. 附录：如何手动触发热加载

由于热加载不仅依赖文件监控，还监听系统信号，你可以通过命令行手动强制触发重载。

### 步骤
1. **获取 PID**:
   ```bash
   pgrep opencode
   ```
2. **发送信号**:
   ```bash
   # 向进程发送 SIGUSR2 信号
   kill -SIGUSR2 <PID>
   ```

### 进阶：自动化监听并触发
如果你想在修改特定文件时立即生效，可使用 `fswatch` (macOS):
```bash
fswatch -o ~/.config/openwork/opencode.json | xargs -n1 -I{} pkill -SIGUSR2 opencode
```
