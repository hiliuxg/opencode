import { describe, expect, test } from "bun:test"
import type { Session, SessionCatalog } from "@opencode-ai/sdk/v2/client"
import {
  archivedList,
  catalogForDirectory,
  catalogs,
  changed,
  done,
  fingerprint,
  gate,
  gates,
  movable,
  remember,
  reset,
  synced,
} from "./helpers"

const item = (id: string, time: Session["time"], input: Partial<Session> = {}): Session => ({
  id,
  slug: id,
  projectID: "project",
  directory: "/repo",
  title: id,
  version: "1",
  time,
  ...input,
})

const cat = (id: string, key: SessionCatalog["key"]): SessionCatalog => ({
  id,
  projectID: "project",
  directory: "/repo",
  name: id,
  icon: "folder",
  key,
  sort: 0,
  time: { created: 0, updated: 0 },
})

describe("archivedList", () => {
  test("adds an archived session to the local archive cache", () => {
    const list = archivedList(
      [item("old", { created: 1, updated: 1, archived: 1 })],
      item("new", { created: 2, updated: 3, pinned: 4 }),
      "archived",
      5,
    )

    expect(list.map((session) => session.id)).toEqual(["new", "old"])
    expect(list[0]?.catalogID).toBe("archived")
    expect(list[0]?.time.archived).toBe(5)
    expect(list[0]?.time.pinned).toBeUndefined()
  })

  test("replaces an existing archived session", () => {
    const list = archivedList(
      [
        item("new", { created: 2, updated: 3, archived: 4 }),
        item("old", { created: 1, updated: 1, archived: 1 }),
      ],
      item("new", { created: 2, updated: 10 }),
      "archived",
      11,
    )

    expect(list.map((session) => session.id)).toEqual(["new", "old"])
    expect(list.filter((session) => session.id === "new")).toHaveLength(1)
    expect(list[0]?.time.archived).toBe(11)
  })
})

describe("movable", () => {
  test("hides move option for archived sessions", () => {
    expect(movable("archived")).toBe(false)
    expect(movable("temp")).toBe(true)
    expect(movable(undefined)).toBe(true)
  })
})

describe("catalogs", () => {
  test("keeps archived catalog last", () => {
    const list = [cat("archived", "archived"), cat("temp", "temp"), cat("analysis", "analysis")]

    expect(catalogs(list).map((cat) => cat.id)).toEqual(["temp", "analysis", "archived"])
  })

  test("filters catalogs to the active directory", () => {
    const current = { ...cat("current", "temp"), directory: "/repo/current" }
    const stale = { ...cat("stale", "temp"), directory: "/repo/stale" }

    expect(catalogs([stale, current], "/repo/current").map((cat) => cat.id)).toEqual(["current"])
  })

  test("resolves system catalogs by directory before loading sessions", () => {
    const old = { ...cat("old-temp", "temp"), directory: "/repo/old" }
    const next = { ...cat("next-temp", "temp"), directory: "/repo/next" }

    expect(catalogForDirectory([old, next], old, "/repo/next")?.id).toBe("next-temp")
  })

  test("does not reuse custom catalog ids across directories", () => {
    const old = { ...cat("old-work", undefined), directory: "/repo/old" }
    const next = { ...cat("next-work", undefined), directory: "/repo/next", name: old.name }

    expect(catalogForDirectory([old, next], old, "/repo/next")).toBeUndefined()
  })
})

describe("fingerprint", () => {
  test("ignores ordinary session metadata changes", () => {
    const before = fingerprint([item("one", { created: 1, updated: 2 })])
    const after = fingerprint([item("one", { created: 1, updated: 3 }, { title: "renamed" })])

    expect(after).toBe(before)
  })

  test("tracks changes that affect catalog session pages", () => {
    const base = item("one", { created: 1, updated: 2 })
    const key = fingerprint([base])

    expect(fingerprint([{ ...base, catalogID: "analysis" }])).not.toBe(key)
    expect(fingerprint([{ ...base, time: { ...base.time, archived: 3 } }])).not.toBe(key)
    expect(fingerprint([{ ...base, time: { ...base.time, pinned: 4 } }])).not.toBe(key)
    expect(fingerprint([base, item("two", { created: 2, updated: 2 })])).not.toBe(key)
  })

  test("can ignore pinned changes for count refreshes", () => {
    const base = item("one", { created: 1, updated: 2 })
    const next = item("one", { created: 1, updated: 2, pinned: 3 })

    expect(fingerprint([next], false)).toBe(fingerprint([base], false))
  })

  test("ignores sessions already loaded from catalog pages", () => {
    const base = item("one", { created: 1, updated: 2 })
    const seen = new Map<string, Set<string>>()

    remember(seen, [base])

    expect(fingerprint([base], true, seen)).toBe("")
    expect(fingerprint([{ ...base, time: { ...base.time, pinned: 3 } }], true, seen)).not.toBe("")
  })

  test("can ignore pinned changes for known count signatures", () => {
    const base = item("one", { created: 1, updated: 2 })
    const next = item("one", { created: 1, updated: 2, pinned: 3 })
    const seen = new Map<string, Set<string>>()

    remember(seen, [base], false)

    expect(fingerprint([next], false, seen)).toBe("")
  })

  test("can remember catalog endpoint rows with their path catalog id", () => {
    const base = item("one", { created: 1, updated: 2 })
    const seen = new Map<string, Set<string>>()

    remember(seen, [base], true, "temp")

    expect(fingerprint([{ ...base, catalogID: "temp" }], true, seen)).toBe("")
    expect(fingerprint([base], true, seen)).toBe("")
  })
})

describe("synced", () => {
  test("waits for visible directories to finish initial sync", () => {
    expect(synced([], () => "complete")).toBe(false)
    expect(synced(["/repo"], () => "loading")).toBe(false)
    expect(synced(["/repo"], () => "partial")).toBe(false)
    expect(synced(["/repo"], () => "complete")).toBe(true)
  })

  test("requires every visible directory to be complete", () => {
    expect(synced(["/repo", "/repo/other"], (dir) => (dir === "/repo" ? "complete" : "partial"))).toBe(false)
    expect(synced(["/repo", "/repo/other"], () => "complete")).toBe(true)
  })
})

describe("gate", () => {
  test("skips duplicate pending and completed keys", () => {
    const state = gates()

    expect(gate(state, "one")).toBe(true)
    expect(gate(state, "one")).toBe(false)

    done(state, "one", true)

    expect(gate(state, "one")).toBe(false)
    expect(gate(state, "two")).toBe(true)
  })

  test("allows retry after failed request", () => {
    const state = gates()

    expect(gate(state, "one")).toBe(true)
    done(state, "one", false)

    expect(gate(state, "one")).toBe(true)
  })

  test("allows an older completed key after a newer key finishes", () => {
    const state = gates()

    expect(gate(state, "one")).toBe(true)
    done(state, "one", true)
    expect(gate(state, "two")).toBe(true)
    done(state, "two", true)

    expect(gate(state, "one")).toBe(true)
  })

  test("can be reset after a structural cache invalidation", () => {
    const state = gates()

    expect(gate(state, "one")).toBe(true)
    done(state, "one", true)
    reset(state)

    expect(gate(state, "one")).toBe(true)
  })
})

describe("changed", () => {
  test("arms on first ready signature before reporting structural changes", () => {
    const state: { value?: string } = {}

    expect(changed(state, "initial", false)).toBe(false)
    expect(state.value).toBeUndefined()

    expect(changed(state, "initial", true)).toBe(false)
    expect(changed(state, "initial", true)).toBe(false)
    expect(changed(state, "next", true)).toBe(true)
    expect(changed(state, "next", true)).toBe(false)
  })
})
