/**
 * /api/topics routes
 * GET /api/topics?skillname=XXX&limit=3
 *   - Returns `limit` random guided topic questions from the last 7 days for the given skill.
 */

import { Hono } from "hono"
import { getDb, schema } from "../../db/client"
import { eq, and, gte, sql } from "drizzle-orm"
import { runGuidedTopicsGeneration } from "../../cron/topics"

const { guidedTopics } = schema

export function TopicsRoutes() {
    const app = new Hono()

    // POST /trigger 用于手动触发调度，方便验证
    app.post("/trigger", async (c) => {
        // 放后台异步执行，避免请求超时
        runGuidedTopicsGeneration().catch(err => {
            console.error("[API] Failed manual topic generation:", err)
        })
        return c.json({ ok: true, message: "Guided topics generation manually triggered" })
    })

    // GET /api/topics?skillname=XXX&limit=3
    app.get("/", async (c) => {
        const startTime = Date.now()
        const skillname = c.req.query("skillname")
        const limit = Math.max(1, Math.min(20, Number(c.req.query("limit") ?? "3") || 3))

        if (!skillname) {
            return c.json({ ok: false, error: "missing_param", message: "skillname is required" }, 400)
        }

        const db = getDb()

        // Filter to the last 7 days only
        const sevenDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)

        const rows = await db
            .select()
            .from(guidedTopics)
            .where(
                and(
                    eq(guidedTopics.skillname, skillname),
                    gte(guidedTopics.createdAt, sevenDaysAgo)
                )
            )

        const shuffled = [...rows].sort(() => 0.5 - Math.random())
        const selected = shuffled.slice(0, limit)

        const duration = Date.now() - startTime
        console.log(`[API] GET /api/topics took ${duration}ms (rows: ${rows.length})`)

        return c.json({
            ok: true,
            items: selected.map((r: typeof rows[number]) => ({
                id: r.id,
                skillname: r.skillname,
                question: r.question,
                createdAt: r.createdAt,
            })),
        })
    })

    return app
}
