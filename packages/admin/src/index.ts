import { Config } from "./config"
import { runMigrations } from "./db/migrate"
import { cronEngine } from "./cron/engine"
import { executor } from "./cron/executor"
import { createApp } from "./server/server"

async function main() {
    console.log("[admin] starting opencode-admin service...")

    // 1. Run database migrations
    await runMigrations()

    // 2. Bootstrap cron engine (load enabled jobs from DB)
    await cronEngine.bootstrap()

    // 3. Wire executor to cron engine
    cronEngine.setTriggerHandler((jobId) => {
        console.log(`[admin] cron triggered job=${jobId}`)
        executor.enqueue(jobId)
    })

    // 4. Start HTTP server
    const app = createApp()
    const server = Bun.serve({
        hostname: Config.hostname,
        port: Config.port,
        fetch: app.fetch,
    })

    console.log(`[admin] listening on http://${server.hostname}:${server.port}`)
    console.log(`[admin] database: mysql://${Config.db.host}:${Config.db.port}/${Config.db.database}`)
    console.log(`[admin] scheduled jobs: ${cronEngine.size}`)
}

main().catch((err) => {
    console.error("[admin] fatal:", err)
    process.exit(1)
})
