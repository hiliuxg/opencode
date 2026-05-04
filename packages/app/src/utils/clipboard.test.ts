import { describe, expect, test } from "bun:test"
import { copyPath } from "./clipboard"

describe("copyPath", () => {
  test("writes the absolute path to clipboard", async () => {
    const writes: string[] = []
    const toasts: { title: string; variant?: "error"; description?: string }[] = []

    const ok = await copyPath({
      path: "/repo/src/file.ts",
      labels: { success: "Copied", fail: "Failed" },
      board: { writeText: (text) => Promise.resolve(writes.push(text)).then(() => undefined) },
      toast: (toast) => toasts.push(toast),
    })

    expect(ok).toBe(true)
    expect(writes).toEqual(["/repo/src/file.ts"])
    expect(toasts).toEqual([{ title: "Copied" }])
  })

  test("shows an error when clipboard is unavailable", async () => {
    const toasts: { title: string; variant?: "error"; description?: string }[] = []

    const ok = await copyPath({
      path: "/repo/src/file.ts",
      labels: { success: "Copied", fail: "Failed" },
      board: null,
      toast: (toast) => toasts.push(toast),
    })

    expect(ok).toBe(false)
    expect(toasts).toEqual([{ variant: "error", title: "Failed" }])
  })
})
