import { Hono } from "hono"
import { cronEngine } from "../../cron/engine"

export function HealthRoutes() {
    const app = new Hono()

    app.get("/", (c) => {
        return c.json({
            ok: true,
            uptime: process.uptime(),
            scheduledJobs: cronEngine.size,
            timestamp: new Date().toISOString(),
        })
    })

    return app
}
