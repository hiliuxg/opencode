import { describe, expect, test } from "bun:test"
import type { Session, SessionCatalog } from "@opencode-ai/sdk/v2/client"
import { archivedList, catalogForDirectory, catalogs, movable } from "./helpers"

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
