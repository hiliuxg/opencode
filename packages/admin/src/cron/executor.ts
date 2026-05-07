import { getDb, schema } from "../db/client"
import { eq } from "drizzle-orm"
import { randomUUID } from "node:crypto"
import { withRetry } from "./retry"
import { Log } from "../util/log"

const { cronJobs, users, cronExecutions } = schema

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecutionResult {
    ok: boolean
    sessionId?: string
    error?: string
    duration?: number
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export class Executor {
    /** Max concurrent executions */
    private concurrency: number
    private running = 0
    private queue: string[] = []

    constructor(opts?: { concurrency?: number }) {
        this.concurrency = opts?.concurrency ?? 30
    }

    /** Enqueue a job for execution */
    async enqueue(jobId: string | number): Promise<ExecutionResult | undefined> {
        if (this.running >= this.concurrency) {
            Log.Default.info(`[Executor] queued job=${jobId} (running=${this.running}/${this.concurrency})`)
            this.queue.push(String(jobId))
            return
        }

        this.running++
        try {
            return await this.execute(jobId)
        } finally {
            this.running--
            this.processQueue()
        }
    }

    /** Process next item in queue */
    private processQueue() {
        if (this.queue.length === 0) return
        if (this.running >= this.concurrency) return
        const next = this.queue.shift()
        if (next) this.enqueue(next)
    }

    /** Execute a single job */
    private async execute(jobId: string | number): Promise<ExecutionResult> {
        const startTime = Date.now()
        Log.Default.info(`[Executor] executing job=${jobId}`)

        const db = getDb()

        // 0. Create execution record
        const result = await db.insert(cronExecutions).values({
            jobId: Number(jobId),
            status: "running",
            startedAt: new Date(startTime),
        } as any)

        const executionId = result[0].insertId
        Log.Default.info(`[Executor] created execution record id=${executionId}`)

        // 1. Load job + user info
        const [job] = await db.select().from(cronJobs).where(eq(cronJobs.id, Number(jobId) as any))
        if (!job) {
            const error = "job_not_found"
            Log.Default.error(`[Executor] job ${jobId} not found`)
            await db.update(cronExecutions).set({
                status: "error",
                error,
                completedAt: new Date(),
                duration: Date.now() - startTime
            }).where(eq(cronExecutions.id, executionId as any))
            return { ok: false, error }
        }

        const [user] = await db.select().from(users).where(eq(users.id, job.userId))
        if (!user) {
            const error = "user_not_found"
            Log.Default.error(`[Executor] user ${job.userId} not found for job ${jobId}`)
            await db.update(cronExecutions).set({
                status: "error",
                error,
                completedAt: new Date(),
                duration: Date.now() - startTime
            }).where(eq(cronExecutions.id, executionId as any))
            return { ok: false, error }
        }

        if (!user.containerHost) {
            const error = "no_container_host"
            Log.Default.error(`[Executor] user ${job.userId} has no containerHost configured`)
            await db.update(cronExecutions).set({
                status: "error",
                error,
                completedAt: new Date(),
                duration: Date.now() - startTime
            }).where(eq(cronExecutions.id, executionId as any))
            return { ok: false, error: "no_container_host" }
        }

        // 2. Parse job config
        const config = job.config ? JSON.parse(job.config) : {}

        // 3. Execute with retry
        try {
            const result = await withRetry(
                () => this.callOpencode(user, job, config),
                { maxRetries: 0, label: `job:${jobId}` }
            )

            const duration = Date.now() - startTime
            Log.Default.info(`[Executor] job=${jobId} completed in ${duration}ms sessionId=${result.sessionId}`)

            // 4. Update record (success)
            await db.update(cronExecutions).set({
                status: "completed",
                sessionId: result.sessionId,
                duration,
                completedAt: new Date()
            }).where(eq(cronExecutions.id, executionId as any))

            return { ok: true, sessionId: result.sessionId, duration }
        } catch (err) {
            const duration = Date.now() - startTime
            const error = err instanceof Error ? err.message : String(err)
            Log.Default.error(`[Executor] job=${jobId} failed after ${duration}ms: ${error}`)

            // 4. Update record (failure)
            await db.update(cronExecutions).set({
                status: "error",
                error,
                duration,
                completedAt: new Date()
            }).where(eq(cronExecutions.id, executionId as any))

            return { ok: false, error, duration }
        }
    }

    /**
     * Call opencode serve to:
     * 1. Create a new session
     * 2. Send the prompt and wait until the response stream is complete
     */
    private async callOpencode(
        user: typeof users.$inferSelect,
        job: typeof cronJobs.$inferSelect,
        config: Record<string, unknown>
    ): Promise<{ sessionId: string }> {
        const baseUrl = user.containerHost!.startsWith("http")
            ? user.containerHost!
            : `http://${user.containerHost}`

        const headers: Record<string, string> = {
            "Content-Type": "application/json",
        }

        // Auth if token is available
        if (user.authToken) {
            headers["Authorization"] = `Basic ${btoa(`opencode:${user.authToken}`)}`
        }

        // Set workspace directory from job
        if (job.workspaceDir) {
            headers["x-opencode-directory"] = job.workspaceDir
        }

        // Step 1: Create session
        const createRes = await fetch(`${baseUrl}/session`, {
            method: "POST",
            headers,
            body: JSON.stringify({}),
            signal: AbortSignal.timeout(60 * 60 * 1000),
        })

        if (!createRes.ok) {
            const text = await createRes.text().catch(() => "")
            throw new Error(`Failed to create session: ${createRes.status} ${text}`)
        }

        const session = (await createRes.json()) as { id: string }
        const sessionId = session.id
        Log.Default.info(`[Executor] created session=${sessionId} for job=${job.id}`)

        // Step 2: Build prompt input
        const promptBody: Record<string, unknown> = {
            parts: [
                {
                    type: "text",
                    text: job.prompt ?? "No prompt specified",
                },
            ],
        }

        // Attach model if specified in config
        if (config.providerID && config.modelID) {
            promptBody.model = {
                providerID: config.providerID,
                modelID: config.modelID,
            }
        }

        // Attach agent if specified
        if (config.agent) {
            promptBody.agent = config.agent
        }

        // Step 3: Send prompt and consume the stream so duration covers the full run
        const promptRes = await fetch(`${baseUrl}/session/${sessionId}/message`, {
            method: "POST",
            headers,
            body: JSON.stringify(promptBody),
            signal: AbortSignal.timeout(60 * 60 * 1000),
        })

        if (!promptRes.ok) {
            const text = await promptRes.text().catch(() => "")
            throw new Error(`Failed to send prompt: ${promptRes.status} ${text}`)
        }

        await promptRes.text()

        return { sessionId }
    }
}

/** Singleton executor */
export const executor = new Executor()
