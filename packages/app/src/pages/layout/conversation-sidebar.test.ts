import { describe, expect, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { archivedList, movable } from "./helpers"

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
