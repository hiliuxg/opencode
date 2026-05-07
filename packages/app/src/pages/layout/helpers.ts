import { getFilename } from "@opencode-ai/util/path"
import { type Session, type SessionCatalog } from "@opencode-ai/sdk/v2/client"

type SessionStore = {
  session?: Session[]
  path: { directory: string }
}

export const workspaceKey = (directory: string) => {
  const value = directory.replaceAll("\\", "/")
  const drive = value.match(/^([A-Za-z]:)\/+$/)
  if (drive) return `${drive[1]}/`
  if (/^\/+$/i.test(value)) return "/"
  return value.replace(/\/+$/, "")
}

export const shouldNotify = (active: string | undefined, dir: string) => {
  if (!active) return false
  return workspaceKey(active) === workspaceKey(dir)
}

function sortSessions(now: number) {
  const oneMinuteAgo = now - 60 * 1000
  return (a: Session, b: Session) => {
    const aUpdated = a.time.updated ?? a.time.created
    const bUpdated = b.time.updated ?? b.time.created
    const aRecent = aUpdated > oneMinuteAgo
    const bRecent = bUpdated > oneMinuteAgo
    if (aRecent && bRecent) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    if (aRecent && !bRecent) return -1
    if (!aRecent && bRecent) return 1
    return bUpdated - aUpdated
  }
}

const isRootVisibleSession = (session: Session, directory: string) =>
  workspaceKey(session.directory) === workspaceKey(directory) && !session.parentID && !session.time?.archived

const roots = (store: SessionStore) =>
  (store.session ?? []).filter((session) => isRootVisibleSession(session, store.path.directory))

export const sortedRootSessions = (store: SessionStore, now: number) => roots(store).sort(sortSessions(now))

export const latestRootSession = (stores: SessionStore[], now: number) =>
  stores.flatMap(roots).sort(sortSessions(now))[0]

function entry(session: Session, pin = true) {
  return [
    workspaceKey(session.directory),
    session.id,
    session.catalogID ?? "",
    session.time.archived ?? "",
    pin ? (session.time.pinned ?? "") : "",
  ].join(":")
}

function sid(session: Session) {
  return `${workspaceKey(session.directory)}:${session.id}`
}

export function remember(seen: Map<string, Set<string>>, list: Session[], pin = true, catalogID?: string) {
  list.forEach((session) => {
    const id = sid(session)
    const set = seen.get(id) ?? new Set<string>()
    set.add(entry(session, pin))
    if (catalogID) set.add(entry({ ...session, catalogID }, pin))
    seen.set(id, set)
  })
}

export function fingerprint(list: Session[], pin = true, seen?: Map<string, Set<string>>) {
  return list
    .map((session) => {
      const value = entry(session, pin)
      if (seen?.get(sid(session))?.has(value)) return
      return value
    })
    .filter((value): value is string => !!value)
    .sort()
    .join("\n")
}

export function synced(dirs: string[], status: (dir: string) => "loading" | "partial" | "complete") {
  return dirs.length > 0 && dirs.every((dir) => status(dir) === "complete")
}

export type Gate = {
  pending: Set<string>
  done: string
}

export function gates(): Gate {
  return {
    pending: new Set(),
    done: "",
  }
}

export function gate(state: Gate, key: string) {
  if (state.pending.has(key) || state.done === key) return false
  state.pending.add(key)
  return true
}

export function done(state: Gate, key: string, ok: boolean) {
  state.pending.delete(key)
  if (ok) state.done = key
}

export function reset(state: Gate) {
  state.pending.clear()
  state.done = ""
}

export function changed(state: { value?: string }, key: string, ready: boolean) {
  if (!ready) return false
  if (state.value === undefined) {
    state.value = key
    return false
  }
  if (state.value === key) return false
  state.value = key
  return true
}

export const movable = (key: SessionCatalog["key"] | undefined) => key !== "archived"

export const catalogs = (list: SessionCatalog[], directory?: string) =>
  (directory ? list.filter((cat) => workspaceKey(cat.directory) === workspaceKey(directory)) : list)
    .slice()
    .sort((a, b) => Number(a.key === "archived") - Number(b.key === "archived"))

export function catalogForDirectory(list: SessionCatalog[], active: SessionCatalog, directory: string) {
  const cats = catalogs(list, directory)
  if (workspaceKey(active.directory) === workspaceKey(directory)) {
    return cats.find((cat) => cat.id === active.id)
  }
  if (!active.key) return
  return cats.find((cat) => cat.key === active.key)
}

const stamp = (session: Session) => session.time.updated ?? session.time.created

const sort = (list: Session[]) =>
  list.slice().sort((a, b) => stamp(b) - stamp(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

export function archivedList(list: Session[], session: Session, id: string | undefined, time = Date.now()) {
  const next = {
    ...session,
    catalogID: id ?? session.catalogID,
    time: {
      ...session.time,
      archived: time,
      pinned: undefined,
    },
  }
  return sort([...list.filter((item) => item.id !== session.id), next])
}

export function hasProjectPermissions<T>(
  request: Record<string, T[] | undefined> | undefined,
  include: (item: T) => boolean = () => true,
) {
  return Object.values(request ?? {}).some((list) => list?.some(include))
}

export const childMapByParent = (sessions: Session[] | undefined) => {
  const map = new Map<string, string[]>()
  for (const session of sessions ?? []) {
    if (!session.parentID) continue
    const existing = map.get(session.parentID)
    if (existing) {
      existing.push(session.id)
      continue
    }
    map.set(session.parentID, [session.id])
  }
  return map
}

export const displayName = (project: { name?: string; worktree: string }) =>
  project.name || getFilename(project.worktree)

export const errorMessage = (err: unknown, fallback: string) => {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: { message?: string } }).data
    if (data?.message) return data.message
  }
  if (err instanceof Error) return err.message
  return fallback
}

export const effectiveWorkspaceOrder = (local: string, dirs: string[], persisted?: string[]) => {
  const root = workspaceKey(local)
  const live = new Map<string, string>()

  for (const dir of dirs) {
    const key = workspaceKey(dir)
    if (key === root) continue
    if (!live.has(key)) live.set(key, dir)
  }

  if (!persisted?.length) return [local, ...live.values()]

  const result = [local]
  for (const dir of persisted) {
    const key = workspaceKey(dir)
    if (key === root) continue
    const match = live.get(key)
    if (!match) continue
    result.push(match)
    live.delete(key)
  }

  return [...result, ...live.values()]
}
