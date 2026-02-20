import { Hono } from "hono"
import { cronEngine } from "../../cron/engine"
import { Config } from "../../config"

export function HealthRoutes() {
    const app = new Hono()

    app.get("/", (c) => {
        return c.json({
            ok: true,
            uptime: process.uptime(),
            scheduledJobs: cronEngine.size,
            timestamp: new Date().toISOString(),
            skillSyncScript: Config.skills.syncScript,
        })
    })

    return app
}
