import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { Config } from "./config"
import { cronEngine } from "./cron/engine"
import { executor } from "./cron/executor"
import { startGuidedTopicsCron } from "./cron/topics"
import { createApp } from "./server/server"
import { Log } from "./util/log"

const log = Log.create({ service: "main" })

async function main() {
    const argv = await yargs(hideBin(process.argv))
        .option("host", {
            type: "string",
            description: "Server host",
            default: Config.hostname,
        })
        .option("port", {
            type: "number",
            description: "Server port",
            default: Config.port,
        })
        .option("log-level", {
            type: "string",
            description: "Log level",
            choices: ["DEBUG", "INFO", "WARN", "ERROR"],
            default: "INFO",
        })
        .option("basepath", {
            type: "string",
            description: "Base path",
            default: Config.basepath,
        })
        .parse()

    await Log.init({
        print: true, // we can support file via other options later, for now we print to terminal and log file
        level: argv.logLevel as Log.Level,
    })

    // Override Config with parsed arguments
    Config.hostname = argv.host
    Config.port = argv.port
    Config.basepath = argv.basepath

    log.info("[admin] starting opencode-admin service...")

    // 1. Bootstrap cron engine (load enabled jobs from DB)
    await cronEngine.bootstrap()

    // 2. Wire executor to cron engine
    cronEngine.setTriggerHandler((jobId) => {
        log.info(`[admin] cron triggered job=${jobId}`)
        executor.enqueue(jobId)
    })

    // 3. Start guided topics cron job (nightly at 3AM)
    startGuidedTopicsCron()

    // 3. Start HTTP server
    const app = createApp(Config)
    const server = Bun.serve({
        hostname: Config.hostname,
        port: Config.port,
        fetch: app.fetch,
    })

    let bp = ""
    if (Config.basepath !== "") {
        bp = "/" + (Config.basepath.endsWith("/") ? Config.basepath.slice(0, -1) : Config.basepath)
    }

    log.info(`[admin] listening on http://${server.hostname}:${server.port}${bp}`)
    log.info(`[admin] database: mysql://${Config.db.host}:${Config.db.port}/${Config.db.database}`)
    log.info(`[admin] scheduled jobs: ${cronEngine.size}`)
}

main().catch((err) => {
    log.error("[admin] fatal:", err)
    process.exit(1)
})
