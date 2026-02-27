import fs from "node:fs/promises"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import path from "node:path"
import os from "node:os"

const app = "opencode-admin"

const data = path.join(xdgData!, app)
const cache = path.join(xdgCache!, app)
const config = path.join(xdgConfig!, app)
const state = path.join(xdgState!, app)

export namespace Global {
    export const Path = {
        // Allow override via OPENCODE_ADMIN_TEST_HOME for test isolation
        get home() {
            return process.env.OPENCODE_ADMIN_TEST_HOME || os.homedir()
        },
        data,
        bin: path.join(data, "bin"),
        log: path.join(data, "log"),
        cache,
        config,
        state,
    }
}

await Promise.all([
    fs.mkdir(Global.Path.data, { recursive: true }).catch(() => { }),
    fs.mkdir(Global.Path.config, { recursive: true }).catch(() => { }),
    fs.mkdir(Global.Path.state, { recursive: true }).catch(() => { }),
    fs.mkdir(Global.Path.log, { recursive: true }).catch(() => { }),
    fs.mkdir(Global.Path.bin, { recursive: true }).catch(() => { }),
])
