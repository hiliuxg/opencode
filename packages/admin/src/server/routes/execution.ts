import { Hono } from "hono"
import { z } from "zod"
import { eq, desc } from "drizzle-orm"
import { getDb, schema } from "../../db/client"

const { cronExecutions, cronJobs } = schema

const QuerySchema = z.object({
    jobId: z.coerce.number().int().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    offset: z.coerce.number().int().min(0).optional().default(0),
    workspaceDir: z.string().optional(),
})

export function ExecutionRoutes() {
    const app = new Hono()

    // ---- LIST ---------------------------------------------------------------
    app.get("/", async (c) => {
        const db = getDb()
        const query = QuerySchema.safeParse(c.req.query())

        if (!query.success) {
            return c.json({ ok: false, error: "invalid_query", details: query.error.flatten() }, 400)
        }

        const { jobId, limit, offset, workspaceDir } = query.data

        let baseQuery = db
            .select({
                id: cronExecutions.id,
                jobId: cronExecutions.jobId,
                status: cronExecutions.status,
                sessionId: cronExecutions.sessionId,
                error: cronExecutions.error,
                duration: cronExecutions.duration,
                startedAt: cronExecutions.startedAt,
                completedAt: cronExecutions.completedAt,
            })
            .from(cronExecutions)
            .leftJoin(cronJobs, eq(cronExecutions.jobId, cronJobs.id))
            .orderBy(desc(cronExecutions.startedAt))
            .limit(limit)
            .offset(offset)
            .$dynamic()

        if (jobId !== undefined) {
            baseQuery = baseQuery.where(eq(cronExecutions.jobId, jobId))
        }

        if (workspaceDir) {
            baseQuery = baseQuery.where(eq(cronJobs.workspaceDir, workspaceDir))
        }

        const items = await baseQuery
        return c.json({ ok: true, items })
    })

    // ---- GET ONE ------------------------------------------------------------
    app.get("/:id", async (c) => {
        const db = getDb()
        const id = Number(c.req.param("id"))
        const [item] = await db.select().from(cronExecutions).where(eq(cronExecutions.id, id))

        if (!item) {
            return c.json({ ok: false, error: "execution_not_found" }, 404)
        }

        return c.json({ ok: true, item })
    })

    // ---- DELETE -------------------------------------------------------------
    app.delete("/:id", async (c) => {
        const db = getDb()
        const id = Number(c.req.param("id"))
        await db.delete(cronExecutions).where(eq(cronExecutions.id, id))
        return c.json({ ok: true, deleted: id })
    })

    return app
}
