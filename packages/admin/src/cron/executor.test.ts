import { afterEach, expect, test } from "bun:test"
import { Executor, type ExecutionResult } from "./executor"

type Probe = {
    callOpencode(
        user: { containerHost: string | null; authToken: string | null },
        job: {
            id: number
            prompt: string | null
            workspaceDir: string | null
            timeout_seconds: number | null
        },
        cfg: Record<string, unknown>,
    ): Promise<{ sessionId: string }>
}

type Runner = {
    enqueue(jobId: string | number): Promise<ExecutionResult | undefined>
    execute(jobId: string | number): Promise<ExecutionResult>
}

const fetch = globalThis.fetch
const timeout = AbortSignal.timeout

afterEach(() => {
    globalThis.fetch = fetch
    AbortSignal.timeout = timeout
})

test("waits for the synchronous session message response", async () => {
    const calls: string[] = []
    const bodies: unknown[] = []
    let read = false

    globalThis.fetch = (async (input, init) => {
        const url = String(input)
        calls.push(url)
        if (init?.body) bodies.push(JSON.parse(String(init.body)))

        if (url === "http://opencode/session") {
            return {
                ok: true,
                json: async () => ({ id: "ses" }),
            } as Response
        }

        if (url === "http://opencode/session/ses/message") {
            return {
                ok: true,
                status: 200,
                text: async () => {
                    await Bun.sleep(10)
                    read = true
                    return JSON.stringify({ info: { id: "msg" }, parts: [] })
                },
            } as Response
        }

        throw new Error(`unexpected fetch: ${url}`)
    }) as typeof globalThis.fetch

    const result = await (new Executor() as unknown as Probe).callOpencode(
        { containerHost: "http://opencode", authToken: null },
        {
            id: 1,
            prompt: "hello",
            workspaceDir: "/tmp/project",
            timeout_seconds: 30,
        },
        { providerID: "prov", modelID: "mod" },
    )

    expect(result.sessionId).toBe("ses")
    expect(calls).toEqual(["http://opencode/session", "http://opencode/session/ses/message"])
    expect(read).toBe(true)
    expect(bodies[1]).toEqual({
        parts: [{ type: "text", text: "hello" }],
        model: { providerID: "prov", modelID: "mod" },
    })
})

test("enqueue returns the execution result", async () => {
    const exec = new Executor() as unknown as Runner
    exec.execute = async (jobId) => ({ ok: true, sessionId: String(jobId), duration: 25 })

    await expect(exec.enqueue("job")).resolves.toEqual({ ok: true, sessionId: "job", duration: 25 })
})

test("runs 30 jobs before queueing by default", async () => {
    const exec = new Executor() as unknown as Runner
    let calls = 0
    let done!: () => void
    const gate = new Promise<void>((r) => {
        done = r
    })

    exec.execute = async (jobId) => {
        calls++
        await gate
        return { ok: true, sessionId: String(jobId), duration: 25 }
    }

    const runs = Array.from({ length: 31 }, (_, i) => exec.enqueue(i))

    expect(calls).toBe(30)
    await expect(runs[30]).resolves.toBeUndefined()

    done()
    await Promise.all(runs.slice(0, 30))

    expect(calls).toBe(31)
})

test("uses a 60 minute timeout for opencode calls", async () => {
    const calls: number[] = []
    AbortSignal.timeout = ((ms) => {
        calls.push(ms)
        return timeout(60_000)
    }) as typeof AbortSignal.timeout

    globalThis.fetch = (async (input) => {
        const url = String(input)

        if (url === "http://opencode/session") {
            return {
                ok: true,
                json: async () => ({ id: "ses" }),
            } as Response
        }

        if (url === "http://opencode/session/ses/message") {
            return {
                ok: true,
                status: 200,
                text: async () => "",
            } as Response
        }

        throw new Error(`unexpected fetch: ${url}`)
    }) as typeof globalThis.fetch

    await (new Executor() as unknown as Probe).callOpencode(
        { containerHost: "http://opencode", authToken: null },
        {
            id: 1,
            prompt: "hello",
            workspaceDir: null,
            timeout_seconds: 30,
        },
        {},
    )

    expect(calls).toEqual([3_600_000, 3_600_000])
})
