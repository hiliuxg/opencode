import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import type { SessionCatalogID } from "../../src/session/schema"
import { SessionTable } from "../../src/session/session.sql"
import { Database, eq } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

afterEach(async () => {
  await Instance.disposeAll()
})

const mark = (
  session: Session.Info,
  input: { updated: number; pinned?: number | null; archived?: number | null; catalogID?: SessionCatalogID | null },
) =>
  Database.use((db) =>
    db
      .update(SessionTable)
      .set({
        time_updated: input.updated,
        time_pinned: input.pinned,
        time_archived: input.archived,
        ...(input.catalogID !== undefined && { catalog_id: input.catalogID }),
      })
      .where(eq(SessionTable.id, session.id))
      .run(),
  )

describe("session catalog sessions endpoint", () => {
  test("returns pinned sessions separately and cursor-paginates unpinned sessions", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const cat = await Session.Catalog.create({ directory: tmp.path, name: "Work" })
        const pin = await Session.create({ title: "pinned" })
        const latest = await Session.create({ title: "latest" })
        const middle = await Session.create({ title: "middle" })
        const older = await Session.create({ title: "older" })
        const other = await Session.create({ title: "other" })

        await Promise.all(
          [pin, latest, middle, older].map((session) => Session.setCatalog({ sessionID: session.id, catalogID: cat.id })),
        )
        await Session.setPinned({ sessionID: pin.id, pinned: true })
        mark(pin, { updated: 40, pinned: 40 })
        mark(latest, { updated: 30 })
        mark(middle, { updated: 20 })
        mark(older, { updated: 10 })
        mark(other, { updated: 50 })

        const app = Server.Default()
        const res = await app.request(
          `/session/catalog/${cat.id}/sessions?directory=${encodeURIComponent(tmp.path)}&limit=2`,
        )
        expect(res.status).toBe(200)
        const body = (await res.json()) as {
          pinned: Session.Info[]
          items: Session.Info[]
          nextCursor?: string
          count: number
        }

        expect(body.pinned.map((session) => session.id)).toEqual([pin.id])
        expect(body.items.map((session) => session.id)).toEqual([latest.id, middle.id])
        expect(body.count).toBe(4)
        expect(body.nextCursor).toBeTruthy()

        const next = await app.request(
          `/session/catalog/${cat.id}/sessions?directory=${encodeURIComponent(tmp.path)}&limit=2&cursor=${encodeURIComponent(body.nextCursor!)}`,
        )
        expect(next.status).toBe(200)
        const page = (await next.json()) as {
          pinned: Session.Info[]
          items: Session.Info[]
          nextCursor?: string
          count: number
        }

        expect(page.pinned.map((session) => session.id)).toEqual([pin.id])
        expect(page.items.map((session) => session.id)).toEqual([older.id])
        expect(page.count).toBe(4)
        expect(page.nextCursor).toBeUndefined()
      },
    })
  })

  test("maps the temp catalog to uncategorized active root sessions", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const cats = await Session.Catalog.list({ directory: tmp.path })
        const temp = cats.find((cat) => cat.key === "temp")!
        const analysis = cats.find((cat) => cat.key === "analysis")!
        const root = await Session.create({ title: "temp-root" })
        const child = await Session.create({ title: "temp-child", parentID: root.id })
        const tagged = await Session.create({ title: "analysis-root" })
        const gone = await Session.create({ title: "archived-root" })

        await Session.setCatalog({ sessionID: tagged.id, catalogID: analysis.id })
        await Session.setArchived({ sessionID: gone.id, time: 100 })
        mark(root, { updated: 40 })
        mark(child, { updated: 50 })
        mark(tagged, { updated: 60 })
        mark(gone, { updated: 70, archived: 100 })

        const app = Server.Default()
        const res = await app.request(
          `/session/catalog/${temp.id}/sessions?directory=${encodeURIComponent(tmp.path)}&limit=10`,
        )
        expect(res.status).toBe(200)
        const body = (await res.json()) as { pinned: Session.Info[]; items: Session.Info[]; count: number }

        expect(body.pinned).toHaveLength(0)
        expect(body.items.map((session) => session.id)).toEqual([root.id])
        expect(body.count).toBe(1)
      },
    })
  })

  test("maps the archived catalog to archived root sessions regardless of catalog assignment", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const cats = await Session.Catalog.list({ directory: tmp.path })
        const arch = cats.find((cat) => cat.key === "archived")!
        const cat = await Session.Catalog.create({ directory: tmp.path, name: "Research" })
        const first = await Session.create({ title: "archived-empty" })
        const second = await Session.create({ title: "archived-catalog" })
        const active = await Session.create({ title: "active-arch-catalog" })

        await Session.setCatalog({ sessionID: second.id, catalogID: cat.id })
        await Session.setCatalog({ sessionID: active.id, catalogID: arch.id })
        await Session.setArchived({ sessionID: first.id, time: 100 })
        await Session.setArchived({ sessionID: second.id, time: 200 })
        mark(first, { updated: 20, archived: 100 })
        mark(second, { updated: 30, archived: 200, catalogID: cat.id })
        mark(active, { updated: 40, catalogID: arch.id })

        const app = Server.Default()
        const res = await app.request(
          `/session/catalog/${arch.id}/sessions?directory=${encodeURIComponent(tmp.path)}&limit=10`,
        )
        expect(res.status).toBe(200)
        const body = (await res.json()) as { pinned: Session.Info[]; items: Session.Info[]; count: number }

        expect(body.items.map((session) => session.id)).toEqual([second.id, first.id])
        expect(body.count).toBe(2)
      },
    })
  })

  test("returns catalog counts using the same system catalog semantics", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const cats = await Session.Catalog.list({ directory: tmp.path })
        const temp = cats.find((cat) => cat.key === "temp")!
        const arch = cats.find((cat) => cat.key === "archived")!
        const cat = await Session.Catalog.create({ directory: tmp.path, name: "Work" })
        const one = await Session.create({ title: "temp-one" })
        const two = await Session.create({ title: "temp-two" })
        const tagged = await Session.create({ title: "work-one" })
        const child = await Session.create({ title: "work-child", parentID: tagged.id })
        const gone = await Session.create({ title: "archived-one" })

        await Session.setCatalog({ sessionID: tagged.id, catalogID: cat.id })
        await Session.setCatalog({ sessionID: child.id, catalogID: cat.id })
        await Session.setArchived({ sessionID: gone.id, time: 100 })
        mark(one, { updated: 10 })
        mark(two, { updated: 20 })
        mark(tagged, { updated: 30 })
        mark(child, { updated: 40 })
        mark(gone, { updated: 50, archived: 100 })

        const app = Server.Default()
        const res = await app.request(`/session/catalog/counts?directory=${encodeURIComponent(tmp.path)}`)
        expect(res.status).toBe(200)
        const body = (await res.json()) as Array<{ catalogID: SessionCatalogID; count: number }>
        const counts = new Map(body.map((item) => [item.catalogID, item.count]))

        expect(counts.get(temp.id)).toBe(2)
        expect(counts.get(cat.id)).toBe(1)
        expect(counts.get(arch.id)).toBe(1)
      },
    })
  })
})
