/**
 * Admin API 客户端
 * 封装对 OpenCode Admin 定时任务服务的 REST 调用
 */

const DEFAULT_ADMIN_URL = "https://kudata-agent.tmeoa.com/opencode"

export function getAdminUrl(): string {
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

export type ScheduleType = "hourly" | "daily" | "weekly" | "monthly"

export type CronParams =
    | { type: "hourly"; interval: number; minute: number }
    | { type: "daily"; hour: number; minute: number }
    | { type: "weekly"; day: number; hour: number; minute: number }
    | { type: "monthly"; date: number; hour: number; minute: number }

/** weekly `day`: 1=Mon … 7=Sun (maps Sun to 0 for cron) */
export function cronFromSchedule(params: CronParams): string {
    if (params.type === "hourly") {
        return `${params.minute} */${params.interval} * * *`
    }
    if (params.type === "daily") {
        return `${params.minute} ${params.hour} * * *`
    }
    if (params.type === "weekly") {
        const dow = params.day === 7 ? 0 : params.day
        return `${params.minute} ${params.hour} * * ${dow}`
    }
    return `${params.minute} ${params.hour} ${params.date} * *`
}

/** Reverse of cronFromSchedule — parses a cron string back into CronParams */
export function parseCronToSchedule(cron: string): CronParams {
    const [min, hr, dom, , dow] = cron.trim().split(" ")
    const minute = Number(min)
    if (hr.startsWith("*/")) {
        return { type: "hourly", interval: Number(hr.slice(2)), minute }
    }
    const hour = Number(hr)
    if (dom === "*" && dow === "*") {
        return { type: "daily", hour, minute }
    }
    if (dom === "*") {
        const day = Number(dow) === 0 ? 7 : Number(dow)
        return { type: "weekly", day, hour, minute }
    }
    return { type: "monthly", date: Number(dom), hour, minute }
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
    // eslint-disable-next-line no-console
    console.log("[createJob] Request body:", JSON.stringify(data, null, 2))
    const res = await request<ApiResponse<CronJob>>("/api/jobs", {
        method: "POST",
        body: JSON.stringify(data),
    })
    if (!res.item) throw new Error("Failed to create job")
    return res.item
}

export async function updateJob(id: string, data: Partial<CreateJobInput> & { enabled?: boolean }): Promise<CronJob> {
    const res = await request<ApiResponse<CronJob>>(`/api/jobs/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
    })
    if (!res.item) throw new Error("Failed to update job")
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

export interface Skill {
    id: number
    name: string
    catalog: string
    description: string
    userId: number
    stars: number
    createdAt: string
    updatedAt: string
    latestVersion?: string
}

export async function getSkills(params?: {
    catalog?: string
    name?: string
}): Promise<Skill[]> {
    const sp = new URLSearchParams()
    if (params?.catalog) sp.set("catalog", params.catalog)
    if (params?.name) sp.set("name", params.name)
    const query = sp.toString()
    const res = await request<ApiResponse<Skill>>(`/api/skills${query ? `?${query}` : ""}`)
    return res.items || []
}

export async function getAdminConfig(): Promise<{ skillSyncScript: string }> {
    return request("/health")
}

export interface GuidedTopic {
    id: number
    skillname: string
    question: string
    createdAt: string
}

export async function getGuidedTopics(skillname: string, limit = 3): Promise<GuidedTopic[]> {
    const sp = new URLSearchParams({ skillname, limit: String(limit) })
    const res = await request<ApiResponse<GuidedTopic>>(`/api/topics?${sp.toString()}`)
    return res.items || []
}
