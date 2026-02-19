/**
 * Admin API 客户端
 * 封装对 OpenCode Admin 定时任务服务的 REST 调用
 */

const DEFAULT_ADMIN_URL = "http://localhost:8787"

function getAdminUrl(): string {
    try {
        return import.meta.env.VITE_ADMIN_API_URL || DEFAULT_ADMIN_URL
    } catch {
        return DEFAULT_ADMIN_URL
    }
}

// ── Types ────────────────────────────────────────────

export interface CronJobConfig {
    providerID?: string
    modelID?: string
}

export interface CronJob {
    id: string | number
    userId: string | number
    name: string
    cronExpression: string
    timezone: string
    prompt: string
    config: CronJobConfig
    enabled: boolean
    nextRun?: string
    createdAt: string
    updatedAt: string
}

export interface CreateJobInput {
    userId: string | number
    name: string
    cronExpression: string
    timezone: string
    prompt: string
    config?: CronJobConfig
    workspaceDir?: string
}

export interface Execution {
    id: string | number
    jobId: string | number
    status: "running" | "success" | "error"
    startedAt: string
    finishedAt?: string
    duration?: number
    error?: string
    result?: string
}

// ── Cron 表达式辅助 ──────────────────────────────────

export type ScheduleType = "daily" | "hourly"

/**
 * 根据调度类型和值生成 cron 表达式
 * - daily + hour => "0 {hour} * * *"
 * - hourly + interval => "0 * /{interval} * * *"
 */
export function cronFromSchedule(type: ScheduleType, value: number): string {
    if (type === "daily") {
        return `0 ${value} * * *`
    }
    return `0 */${value} * * *`
}

// ── API 函数 ─────────────────────────────────────────

// ── API 函数 ─────────────────────────────────────────

interface ApiResponse<T> {
    ok: boolean
    items?: T[]
    item?: T
    error?: string
    [key: string]: any
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${getAdminUrl()}${path}`
    const res = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...options,
    })
    if (!res.ok) {
        const text = await res.text().catch(() => res.statusText)
        throw new Error(`Admin API error ${res.status}: ${text}`)
    }
    return res.json()
}

export async function getJobs(userId?: string, workspaceDir?: string): Promise<CronJob[]> {
    const sp = new URLSearchParams()
    if (userId) sp.set("userId", userId)
    if (workspaceDir) sp.set("workspaceDir", workspaceDir)
    const query = sp.toString()
    const res = await request<ApiResponse<CronJob>>(`/api/jobs${query ? `?${query}` : ""}`)
    return res.items || []
}

export async function getJob(id: string): Promise<CronJob> {
    const res = await request<ApiResponse<CronJob>>(`/api/jobs/${id}`)
    if (!res.item) throw new Error("Job not found")
    return res.item
}

export async function createJob(data: CreateJobInput): Promise<CronJob> {
    const res = await request<ApiResponse<CronJob>>("/api/jobs", {
        method: "POST",
        body: JSON.stringify(data),
    })
    if (!res.item) throw new Error("Failed to create job")
    return res.item
}

export async function deleteJob(id: string): Promise<void> {
    await request(`/api/jobs/${id}`, { method: "DELETE" })
}

export async function toggleJob(id: string): Promise<void> {
    await request(`/api/jobs/${id}/toggle`, { method: "PATCH" })
}

export async function runJob(id: string): Promise<void> {
    await request(`/api/jobs/${id}/run`, { method: "POST" })
}

export async function getExecutions(params?: {
    jobId?: string
    limit?: number
    offset?: number
    workspaceDir?: string
}): Promise<Execution[]> {
    const sp = new URLSearchParams()
    if (params?.jobId) sp.set("jobId", params.jobId)
    if (params?.limit) sp.set("limit", String(params.limit))
    if (params?.offset) sp.set("offset", String(params.offset))
    if (params?.workspaceDir) sp.set("workspaceDir", params.workspaceDir)
    const query = sp.toString()
    const res = await request<ApiResponse<Execution>>(`/api/executions${query ? `?${query}` : ""}`)
    return res.items || []
}

