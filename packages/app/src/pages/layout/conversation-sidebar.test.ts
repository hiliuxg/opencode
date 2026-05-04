import { describe, expect, test } from "bun:test"
import type { Session, SessionCatalog } from "@opencode-ai/sdk/v2/client"
import { archivedList, catalogs, movable } from "./helpers"

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
})
