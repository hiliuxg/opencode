#!/usr/bin/env bun

import { $ } from "bun"
import path from "path"
import { fileURLToPath } from "url"
import pkg from "../package.json"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const allTargets: {
    os: "linux" | "darwin" | "win32"
    arch: "arm64" | "x64"
}[] = [
        { os: "linux", arch: "arm64" },
        { os: "linux", arch: "x64" },
        { os: "darwin", arch: "arm64" }, // macOS M系列
        { os: "darwin", arch: "x64" }, // macOS Intel
        { os: "win32", arch: "x64" }, // Windows
    ]

async function build() {
    console.log("Cleaning up bin directory...")
    await $`rm -rf bin`
    await $`mkdir -p bin`

    for (const target of allTargets) {
        const osName = target.os === "win32" ? "windows" : target.os
        // e.g. opencode-admin-linux-arm64
        const executableName = `${pkg.name}-${osName}-${target.arch}${target.os === "win32" ? ".exe" : ""}`
        const outPath = path.join("bin", executableName)

        // Using bun build --compile programmatically via $ because Bun.build compile option 
        // is currently best supported via CLI arguments or requires complex execArgv tuning.
        console.log(`Building ${executableName} for ${target.os}-${target.arch}...`)

        try {
            await $`bun build ./src/index.ts --compile --target=bun-${target.os}-${target.arch} --outfile=${outPath}`
            console.log(`✅ Successfully built ${executableName}`)
        } catch (error) {
            console.error(`❌ Failed to build ${executableName}:`, error)
        }
    }

    console.log("🎉 All binaries built in 'bin' directory.")
}

build().catch((err) => {
    console.error("Build process failed:", err)
    process.exit(1)
})
