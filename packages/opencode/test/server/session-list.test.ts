import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Database, eq } from "../../src/storage/db"
import { SessionCatalogTable, SessionTable } from "../../src/session/session.sql"
import { SessionCatalogID } from "../../src/session/schema"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

afterEach(async () => {
  await Instance.disposeAll()
})

describe("Session.list", () => {
  test("filters by directory", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const first = await Session.create({})

        await using other = await tmpdir({ git: true })
        const second = await Instance.provide({
          directory: other.path,
          fn: async () => Session.create({}),
        })

        const sessions = [...Session.list({ directory: tmp.path })]
        const ids = sessions.map((s) => s.id)

        expect(ids).toContain(first.id)
        expect(ids).not.toContain(second.id)
      },
    })
  })

  test("filters root sessions", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ title: "root-session" })
        const child = await Session.create({ title: "child-session", parentID: root.id })

        const sessions = [...Session.list({ roots: true })]
        const ids = sessions.map((s) => s.id)

        expect(ids).toContain(root.id)
        expect(ids).not.toContain(child.id)
      },
    })
  })

  test("filters by start time", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "new-session" })
        const futureStart = Date.now() + 86400000

        const sessions = [...Session.list({ start: futureStart })]
        expect(sessions.length).toBe(0)
      },
    })
  })

  test("filters by search term", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Session.create({ title: "unique-search-term-abc" })
        await Session.create({ title: "other-session-xyz" })

        const sessions = [...Session.list({ search: "unique-search" })]
        const titles = sessions.map((s) => s.title)

        expect(titles).toContain("unique-search-term-abc")
        expect(titles).not.toContain("other-session-xyz")
      },
    })
  })

  test("respects limit parameter", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Session.create({ title: "session-1" })
        await Session.create({ title: "session-2" })
        await Session.create({ title: "session-3" })

        const sessions = [...Session.list({ limit: 2 })]
        expect(sessions.length).toBe(2)
      },
    })
  })

  test("prioritizes pinned sessions with limited roots", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const pin = await Session.create({ title: "pinned-session" })
        const latest = await Session.create({ title: "latest-session" })

        Database.use((db) => {
          db.update(SessionTable)
            .set({ time_updated: 1, time_pinned: 1 })
            .where(eq(SessionTable.id, pin.id))
            .run()
          db.update(SessionTable)
            .set({ time_updated: 2, time_pinned: null })
            .where(eq(SessionTable.id, latest.id))
            .run()
        })

        const sessions = [...Session.list({ roots: true, limit: 1 })]
        expect(sessions.map((s) => s.id)).toEqual([pin.id])
      },
    })
  })

  test("removes deprecated notes catalog defaults", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const id = SessionCatalogID.descending()
        const now = Date.now()
        Database.use((db) =>
          db
            .insert(SessionCatalogTable)
            .values({
              id,
              project_id: Instance.project.id,
              directory: tmp.path,
              key: "notes",
              name: "Study notes",
              icon: "knowledge-base",
              sort: 2,
              time_created: now,
              time_updated: now,
            })
            .run(),
        )
        const session = await Session.create({ title: "notes-session" })
        await Session.setCatalog({ sessionID: session.id, catalogID: id })

        const list = await Session.Catalog.list({ directory: tmp.path })
        const info = await Session.get(session.id)

        expect(list.map((cat) => cat.key)).toEqual(["temp", "analysis", "archived"])
        expect(info.catalogID).toBeUndefined()
      },
    })
  })
})
