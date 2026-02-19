import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"

import { CronRoutes } from "./routes/cron"
import { HealthRoutes } from "./routes/health"
import { ExecutionRoutes } from "./routes/execution"

export function createApp() {
    const app = new Hono()

    // Middleware
    app.use("*", logger())
    app.use("*", cors())

    // Routes
    app.route("/health", HealthRoutes())
    app.route("/api/jobs", CronRoutes())
    app.route("/api/executions", ExecutionRoutes())

    // TODO: app.route("/api/users", UserRoutes())

    return app
}
