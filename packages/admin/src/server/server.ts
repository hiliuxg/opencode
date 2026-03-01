import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { serveStatic } from "hono/bun"

import { Config } from "../config"
import { CronRoutes } from "./routes/cron"
import { HealthRoutes } from "./routes/health"
import { ExecutionRoutes } from "./routes/execution"
import { SkillsRoutes } from "./routes/skills"
import { TopicsRoutes } from "./routes/topics"

import { Log } from "../util/log"

const log = Log.create({ service: "server" })

export function createApp(config: typeof Config = Config) {
    const app = new Hono()

    const bp = config.basepath.endsWith("/") ? config.basepath.slice(0, -1) : config.basepath
    const rootRoute = bp === "" ? "/" : bp
    const wildcardRoute = bp === "" ? "/*" : `${bp}/*`

    // Middleware
    app.use("*", logger())
    app.use("*", cors())

    // If basepath is set, we need to rewrite the request path for static files and Hono routes
    // so that we can serve them correctly without the basepath prefix in the handlers.
    if (bp !== "") {
        app.use(wildcardRoute, async (c, next) => {
            const path = c.req.path
            if (path.startsWith(bp)) {
                const newPath = path.substring(bp.length) || "/"
                c.req.raw = new Request(new URL(newPath, "http://localhost"), c.req.raw)
            }
            await next()
        })
    }

    // Routes
    app.route(`${bp}/health`, HealthRoutes())
    app.route(`${bp}/api/jobs`, CronRoutes())
    app.route(`${bp}/api/executions`, ExecutionRoutes())
    app.route(`${bp}/api/skills`, SkillsRoutes())
    app.route(`${bp}/api/topics`, TopicsRoutes())

    // TODO: app.route(`${bp}/api/users`, UserRoutes())

    // Serve Frontend Static Files under Config.basepath
    log.info(`basepath=${bp}, wildcardRoute=${wildcardRoute}, rootRoute=${rootRoute}`)

    // Use a simpler approach for static files: serve them from / (after rewrite)
    app.use("/*", serveStatic({ root: "./ui/dist" }))

    app.get(rootRoute, async (c) => {
        const filePath = "./ui/dist/index.html"
        const file = Bun.file(filePath)
        return c.html(await file.text())
    })
    app.notFound(async (c) => {
        if (bp === "" || c.req.path.startsWith(bp)) {
            const filePath = "./ui/dist/index.html"
            const file = Bun.file(filePath)
            if (await file.exists()) {
                return c.html(await file.text())
            }
        }
        return c.json({ error: "Not Found" }, 404)
    })

    return app
}
