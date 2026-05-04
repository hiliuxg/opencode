import { Hono } from "hono"
import { z } from "zod"
import { randomUUID } from "node:crypto"
import { eq, and } from "drizzle-orm"

import { getDb, schema } from "../../db/client"
import { cronEngine } from "../../cron/engine"
import { executor } from "../../cron/executor"
import { Log } from "../../util/log"

const { cronJobs } = schema

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const CreateJobBody = z.object({
    userId: z.union([z.coerce.number().int().min(1), z.string().min(1)]),
    name: z.string().min(1, "name is required"),
    cronExpression: z.string().min(1, "cronExpression is required"),
    timezone: z.string().optional().default("UTC"),
    prompt: z.string().optional(),
    config: z.record(z.string(), z.any()).optional(),
    workspaceDir: z.string().optional(),
    maxRetries: z.number().int().min(0, "maxRetries must be >= 0").optional(),
    timeoutSeconds: z.number().int().min(1, "timeoutSeconds must be >= 1").optional(),
})

const UpdateJobBody = z.object({
    name: z.string().min(1, "name is required").optional(),
    cronExpression: z.string().min(1, "cronExpression is required").optional(),
    timezone: z.string().optional(),
    prompt: z.string().optional(),
    config: z.record(z.string(), z.any()).optional(),
    workspaceDir: z.string().optional(),
    enabled: z.boolean().optional(),
    maxRetries: z.number().int().min(0, "maxRetries must be >= 0").optional(),
    timeoutSeconds: z.number().int().min(1, "timeoutSeconds must be >= 1").optional(),
})

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function CronRoutes() {
    const app = new Hono()

    // ---- LIST ---------------------------------------------------------------
    app.get("/", async (c) => {
        const db = getDb()
        const userId = c.req.query("userId")
        const workspaceDir = c.req.query("workspaceDir")

        let query = db.select().from(cronJobs).$dynamic()

        const filters = []
        if (userId) filters.push(eq(cronJobs.userId, Number(userId)))
        if (workspaceDir) filters.push(eq(cronJobs.workspaceDir, workspaceDir))

        if (filters.length > 0) {
            query = query.where(and(...filters))
        }

        const jobs = await query

        // Attach next run info
        const result = jobs.map((job: any) => ({
            ...job,
            config: job.config ? JSON.parse(job.config) : null,
            nextRun: cronEngine.nextRun(String(job.id))?.toISOString() ?? null,
        }))

        return c.json({ ok: true, items: result })
    })

    // ---- GET ONE ------------------------------------------------------------
    app.get("/:id", async (c) => {
        const db = getDb()
        const id = Number(c.req.param("id"))
        const [job] = await db.select().from(cronJobs).where(eq(cronJobs.id, id))
        if (!job) return c.json({ ok: false, error: "job_not_found" }, 404)
        return c.json({
            ok: true,
            item: {
                ...job,
                config: job.config ? JSON.parse(job.config) : null,
                nextRun: cronEngine.nextRun(String(job.id))?.toISOString() ?? null,
            },
        })
    })

    // ---- CREATE -------------------------------------------------------------
    app.post("/", async (c) => {
        const body = await c.req.json()
        const parsed = CreateJobBody.safeParse(body)
        if (!parsed.success) {
            return c.json({ ok: false, error: "validation_error", details: parsed.error.flatten() }, 400)
        }
        const data = parsed.data
        const now = new Date()

        const db = getDb()

        // Resolve userId if it's a string
        let userId: number
        if (typeof data.userId === "string") {
            const [user] = await db.select().from(schema.users).where(eq(schema.users.name, data.userId))
            if (!user) {
                return c.json({ ok: false, error: "user_not_found", message: `User '${data.userId}' not found` }, 404)
            }
            userId = user.id
        } else {
            userId = data.userId
        }

        const result = await db.insert(cronJobs).values({
            userId: userId,
            name: data.name,
            cronExpression: data.cronExpression,
            timezone: data.timezone,
            prompt: data.prompt ?? null,
            config: data.config ? JSON.stringify(data.config) : null,
            workspaceDir: data.workspaceDir ?? null,
            enabled: true,
            maxRetries: data.maxRetries ?? 3,
            timeout_seconds: data.timeoutSeconds ?? 300,
            createdAt: now,
            updatedAt: now,
        } as any)

        const id = result[0].insertId

        // Schedule it immediately
        cronEngine.schedule(String(id), data.cronExpression, data.timezone)

        const [created] = await db.select().from(cronJobs).where(eq(cronJobs.id, id as any))
        return c.json({
            ok: true,
            item: {
                ...created,
                config: created.config ? JSON.parse(created.config) : null,
                nextRun: cronEngine.nextRun(String(id))?.toISOString() ?? null,
            },
        }, 201)
    })

    // ---- UPDATE -------------------------------------------------------------
    app.put("/:id", async (c) => {
        const db = getDb()
        const id = Number(c.req.param("id"))

        const [existing] = await db.select().from(cronJobs).where(eq(cronJobs.id, id))
        if (!existing) return c.json({ ok: false, error: "job_not_found" }, 404)

        const body = await c.req.json()
        const parsed = UpdateJobBody.safeParse(body)
        if (!parsed.success) {
            return c.json({ ok: false, error: "validation_error", details: parsed.error.flatten() }, 400)
        }
        const data = parsed.data
        const updates: Record<string, unknown> = { updatedAt: new Date() }

        if (data.name !== undefined) updates.name = data.name
        if (data.cronExpression !== undefined) updates.cronExpression = data.cronExpression
        if (data.timezone !== undefined) updates.timezone = data.timezone
        if (data.prompt !== undefined) updates.prompt = data.prompt
        if (data.config !== undefined) updates.config = JSON.stringify(data.config)
        if (data.workspaceDir !== undefined) updates.workspaceDir = data.workspaceDir
        if (data.enabled !== undefined) updates.enabled = data.enabled
        if (data.maxRetries !== undefined) updates.maxRetries = data.maxRetries
        if (data.timeoutSeconds !== undefined) (updates as any).timeout_seconds = data.timeoutSeconds

        await db.update(cronJobs).set(updates).where(eq(cronJobs.id, id as any))

        // Re-schedule if cron expression or enabled state changed
        const newCron = data.cronExpression ?? existing.cronExpression
        const newTz = data.timezone ?? existing.timezone ?? "UTC"
        const newEnabled = data.enabled ?? existing.enabled

        if (newEnabled) {
            cronEngine.schedule(String(id), newCron, newTz)
        } else {
            cronEngine.unschedule(String(id))
        }

        const [updated] = await db.select().from(cronJobs).where(eq(cronJobs.id, id))
        return c.json({
            ok: true,
            item: {
                ...updated,
                config: updated.config ? JSON.parse(updated.config) : null,
                nextRun: cronEngine.nextRun(String(id))?.toISOString() ?? null,
            },
        })
    })

    // ---- DELETE -------------------------------------------------------------
    app.delete("/:id", async (c) => {
        const db = getDb()
        const id = Number(c.req.param("id"))

        const [existing] = await db.select().from(cronJobs).where(eq(cronJobs.id, id))
        if (!existing) return c.json({ ok: false, error: "job_not_found" }, 404)

        cronEngine.unschedule(String(id))
        await db.delete(cronJobs).where(eq(cronJobs.id, id))

        return c.json({ ok: true, deleted: id })
    })

    // ---- TOGGLE ENABLED -----------------------------------------------------
    app.patch("/:id/toggle", async (c) => {
        const db = getDb()
        const id = Number(c.req.param("id"))

        const [existing] = await db.select().from(cronJobs).where(eq(cronJobs.id, id))
        if (!existing) return c.json({ ok: false, error: "job_not_found" }, 404)

        const newEnabled = !existing.enabled
        await db
            .update(cronJobs)
            .set({ enabled: newEnabled, updatedAt: new Date() })
            .where(eq(cronJobs.id, id))

        if (newEnabled) {
            cronEngine.schedule(String(id), existing.cronExpression, existing.timezone ?? "UTC")
        } else {
            cronEngine.unschedule(String(id))
        }

        return c.json({ ok: true, id, enabled: newEnabled })
    })

    // ---- MANUAL TRIGGER (run now) -------------------------------------------
    app.post("/:id/run", async (c) => {
        const db = getDb()
        const id = Number(c.req.param("id"))

        const [existing] = await db.select().from(cronJobs).where(eq(cronJobs.id, id))
        if (!existing) return c.json({ ok: false, error: "job_not_found" }, 404)

        Log.Default.info(`[CronRoutes] manual trigger for job=${id}`)
        const result = await executor.enqueue(String(id))

        return c.json({ ok: true, message: result ? "job completed" : "job queued", jobId: id, result })
    })

    return app
}
