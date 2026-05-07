import { useParams } from "@solidjs/router"
import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  untrack,
  type Accessor,
} from "solid-js"
import { createStore, produce } from "solid-js/store"
import type { Session, SessionCatalog } from "@opencode-ai/sdk/v2/client"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon, type IconProps } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { TextField } from "@opencode-ai/ui/text-field"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { showToast } from "@opencode-ai/ui/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { type LocalProject } from "@/context/layout"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { messageAgentColor } from "@/utils/agent"
import { Persist, persisted } from "@/utils/persist"
import { sessionPermissionRequest } from "../session/composer/session-request-tree"
import {
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

type Props = {
  project: Accessor<LocalProject | undefined>
  sessions: Accessor<Session[]>
  dirs: Accessor<string[]>
  currentDir: Accessor<string>
  width: Accessor<number>
  now: Accessor<number>
  merged: Accessor<boolean>
  hovering: Accessor<boolean>
  mobile?: boolean
  chooseProject: () => void
  openNew: (dir: string, opts?: { catalogID?: string }) => void
  openSession: (session: Session) => void
  prefetchSession: (session: Session, priority?: "high" | "low") => void
  archiveSession: (session: Session, input?: { catalogID?: string; pinned?: boolean }) => Promise<void>
  scrollRef: (el: HTMLDivElement | undefined) => void
}

type DirPage = {
  catalogID?: string
  pinned: Session[]
  items: Session[]
  count: number
  cursor?: string
  more: boolean
}

type Page = {
  dirs: Record<string, DirPage | undefined>
  loading: boolean
}

type Store = {
  cats: Map<string, SessionCatalog[]>
  totals: Map<string, Record<string, number>>
  pages: Map<string, Page>
}

const temp = "temp"
const archived = "archived"
const size = 10

const icons: Record<NonNullable<SessionCatalog["key"]>, IconProps["name"]> = {
  temp: "prompt",
  analysis: "checklist",
  archived: "archive",
}

const names: Record<NonNullable<SessionCatalog["key"]>, string[]> = {
  temp: ["Temporary sessions", "临时会话"],
  analysis: ["Focused analysis", "专项分析"],
  archived: ["Archived", "已经归档"],
}

const empty: Session[] = []
const countgate = gates()
const countchange = gates()
const pagegate = gates()
const pagechange = gates()
const cache: Store = {
  cats: new Map(),
  totals: new Map(),
  pages: new Map(),
}
let seq = 0

function hash(value: string) {
  let code = 0
  for (let i = 0; i < value.length; i++) code = (code * 31 + value.charCodeAt(i)) >>> 0
  return code.toString(36)
}

function sig(value: string) {
  return {
    hash: hash(value),
    rows: value ? value.split("\n").length : 0,
    chars: value.length,
  }
}

function stamp(session: Session) {
  return session.time.updated ?? session.time.created
}

function sort(list: Session[]) {
  return list.slice().sort((a, b) => stamp(b) - stamp(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function merge(list: Session[], next: Session[]) {
  const ids = new Set(list.map((item) => item.id))
  return [...list, ...next.filter((item) => item?.id && !ids.has(item.id))]
}

function error(err: unknown, fallback: string) {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: { message?: string } }).data
    if (data?.message) return data.message
  }
  if (err instanceof Error) return err.message
  return fallback
}

function collect(list: Session[], gone: Set<string>): Set<string> {
  const next = list
    .filter((item) => item.parentID && gone.has(item.parentID))
    .map((item) => item.id)
    .filter((id) => !gone.has(id))
  if (next.length === 0) return gone
  next.forEach((id) => gone.add(id))
  return collect(list, gone)
}

function stale() {
  cache.totals.clear()
  cache.pages.clear()
  reset(countgate)
  reset(countchange)
  reset(pagegate)
  reset(pagechange)
}

export function ConversationSidebar(props: Props) {
  const inst = ++seq
  const params = useParams()
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const notification = useNotification()
  const permission = usePermission()
  const dialog = useDialog()
  const [section, setSection] = persisted(
    Persist.global("conversation.sidebar.section", ["conversation.sidebar.section.v1"]),
    createStore({
      category: true,
      pinned: true,
      all: true,
    }),
  )

  const [state, setState] = createStore({
    query: "",
    cat: "",
  })

  const [cats, setCats] = createSignal<SessionCatalog[]>([])
  const [pages, setPages] = createSignal<Record<string, Page>>({})
  const [totals, setTotals] = createSignal<Record<string, number>>({})
  const catrev = { value: 0 }
  const pagerev = { value: 0 }
  const totalrev = { value: 0 }
  const marks = {
    count: { value: undefined as string | undefined },
    page: { value: undefined as string | undefined },
  }
  const seen = {
    count: new Map<string, Set<string>>(),
    page: new Map<string, Set<string>>(),
  }

  const dir = createMemo(() => props.currentDir() || props.dirs()[0] || props.project()?.worktree || "")
  const dircats = createMemo(() => catalogs(cats(), dir()))
  const ids = createMemo(() => new Set(dircats().map((cat) => cat.id)))
  const active = createMemo(() => dircats().find((cat) => cat.id === state.cat) ?? dircats()[0])
  const activeID = createMemo(() => active()?.id ?? "")
  const query = createMemo(() => state.query.trim())
  const key = createMemo(() => `${dir()}\n${activeID()}\n${query()}`)
  const page = createMemo(() => pages()[key()])
  const loading = createMemo(() => page()?.loading ?? (!!activeID() && props.dirs().length > 0))
  const tempcat = createMemo(() => dircats().find((cat) => cat.key === temp) ?? dircats()[0])
  const archcat = createMemo(() => dircats().find((cat) => cat.key === archived))
  const base = createMemo(() => sort(props.sessions().filter((session) => !session.parentID && !session.time.archived)))
  const countSig = createMemo(() => fingerprint(props.sessions(), false, seen.count))
  const pageSig = createMemo(() => fingerprint(props.sessions(), true, seen.page))
  const catDirs = createMemo(() => [...new Set([dir(), ...props.dirs()].filter(Boolean))])
  const catKey = createMemo(() => `${globalSDK.url}\n${catDirs().join("\n")}`)
  const countViewKey = createMemo(() => `${globalSDK.url}\n${dir()}\n${dircats().map((cat) => cat.id).join("\n")}`)
  const countChangeKey = createMemo(() => `${countViewKey()}\n${countSig()}`)
  const pageViewKey = createMemo(
    () =>
      `${globalSDK.url}\n${key()}\n${props.dirs().join("\n")}\n${cats()
        .map((cat) => `${cat.directory}:${cat.id}:${cat.key ?? ""}`)
        .join("\n")}`,
  )
  const pageChangeKey = createMemo(() => `${pageViewKey()}\n${pageSig()}`)
  const ready = createMemo(() =>
    synced(props.dirs(), (dir) => globalSync.child(dir, { bootstrap: false })[0].status),
  )
  const system = (cat: SessionCatalog) => cat.key === temp || cat.key === archived

  const trace = (event: string, data: Record<string, unknown> = {}) => {
    const active = untrack(activeID)
    const info = {
      inst,
      mobile: !!props.mobile,
      url: globalSDK.url,
      dir: untrack(dir),
      active,
      query: untrack(query),
      dirs: untrack(props.dirs),
      cats: untrack(() => dircats().map((cat) => `${cat.id}:${cat.key ?? "custom"}`)),
      sessions: untrack(() => props.sessions().length),
      ready: untrack(ready),
      status: untrack(() =>
        props.dirs().map((dir) => ({
          dir,
          status: globalSync.child(dir, { bootstrap: false })[0].status,
        })),
      ),
      ...data,
    }
    console.info(
      "[conversation-sidebar]",
      event,
      `inst=${inst} ${props.mobile ? "mobile" : "desktop"} src=${String(data.src ?? "-")} allow=${
        "allow" in data ? String(data.allow) : "-"
      } active=${active || "-"}`,
      info,
    )
  }

  onMount(() => trace("mount"))
  onCleanup(() => trace("cleanup"))

  const writeCats = (list: SessionCatalog[], id = catKey()) => {
    const next = catalogs(list)
    cache.cats.set(id, next)
    setCats(next)
    return next
  }

  const markPage = (page: Page) => {
    Object.values(page.dirs).forEach((item) => {
      if (!item) return
      const list = [...item.pinned, ...item.items]
      remember(seen.count, list, false, item.catalogID)
      remember(seen.page, list, true, item.catalogID)
    })
  }

  const writePage = (id: string, page: Page, request = pageViewKey()) => {
    cache.pages.set(pageViewKey(), page)
    cache.pages.set(request, page)
    markPage(page)
    setPages((all) => ({ ...all, [id]: page }))
  }

  const label = (cat: SessionCatalog) => {
    if (!cat.key) return cat.name
    if (!names[cat.key].includes(cat.name)) return cat.name
    if (cat.key === "analysis") return language.t("conversation.category.analysis")
    if (cat.key === "archived") return language.t("conversation.category.archived")
    return language.t("conversation.category.temp")
  }

  const catid = (session: Session) => {
    const id = session.catalogID ?? tempcat()?.id ?? ""
    if (ids().has(id)) return id
    return tempcat()?.id ?? ""
  }
  const pinned = (session: Session) => !!session.time.pinned

  const fetchCats = async (src = "unknown") => {
    const directory = dir()
    const id = catKey()
    const token = ++catrev.value
    trace("cats:start", { src, token })
    if (!directory) {
      setCats([])
      setState("cat", "")
      trace("cats:empty", { src, token })
      return
    }
    const saved = cache.cats.get(id)
    if (saved) {
      setCats(saved)
      const current = catalogs(saved, directory)
      if (!current.some((cat) => cat.id === state.cat)) setState("cat", current[0]?.id ?? "")
      trace("cats:cache", { src, token, rows: saved.length, current: current.map((cat) => cat.id) })
      return
    }
    const dirs = catDirs()
    const rows = await Promise.all(
      dirs.map((dir) =>
        globalSDK.client.session.catalog
          .list({ directory: dir })
          .then((result) => result.data ?? [])
          .catch((err) => {
            showToast({
              variant: "error",
              title: language.t("common.requestFailed"),
              description: error(err, language.t("common.requestFailed")),
            })
            return [] as SessionCatalog[]
          }),
      ),
    )
    if (token !== catrev.value) {
      trace("cats:stale", { src, token, current: catrev.value })
      return
    }
    const list = writeCats(rows.flat(), id)
    const current = catalogs(list, directory)
    if (!current.some((cat) => cat.id === state.cat)) setState("cat", current[0]?.id ?? "")
    trace("cats:done", { src, token, rows: list.length, current: current.map((cat) => cat.id) })
  }

  const fetchCounts = async (src = "unknown") => {
    const directory = dir()
    const token = ++totalrev.value
    if (!directory) {
      setTotals({})
      trace("counts:empty", { src, token })
      return
    }
    const state = src === "count-sig" ? countchange : countgate
    const id = src === "count-sig" ? countChangeKey() : countViewKey()
    const saved = src === "count-sig" ? undefined : cache.totals.get(id)
    if (saved) {
      setTotals(saved)
      trace("counts:cache", { src, token, rows: Object.keys(saved).length })
      return
    }
    const allow = gate(state, id)
    trace("counts:gate", { src, allow, key: sig(id), count: sig(countSig()) })
    if (!allow) return
    const result = await globalSDK.client.session.catalog.counts({ directory }).catch((err) => {
      trace("counts:error", { src, token, message: error(err, language.t("common.requestFailed")) })
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: error(err, language.t("common.requestFailed")),
      })
      return
    })
    const ok = token === totalrev.value && !!result
    done(state, id, ok)
    trace("counts:done", { src, token, ok, rows: result?.data?.length ?? 0 })
    if (!ok || !result) return
    const totals = Object.fromEntries((result.data ?? []).map((item) => [item.catalogID, item.count]))
    cache.totals.set(countViewKey(), totals)
    cache.totals.set(id, totals)
    setTotals(totals)
  }

  createEffect(() => {
    const list = dircats()
    if (list.some((cat) => cat.id === state.cat)) return
    setState("cat", list[0]?.id ?? "")
  })

  createEffect(
    on(
      () => `${dir()}\n${props.dirs().join("\n")}`,
      () => {
        trace("effect:cats")
        void fetchCats("dirs")
      },
    ),
  )

  createEffect(
    on(
      () => `${dir()}\n${dircats().map((cat) => cat.id).join("\n")}`,
      () => {
        trace("effect:counts", { src: "catalogs", cats: dircats().length })
        if (dircats().length === 0) return
        void fetchCounts("catalogs")
      },
    ),
  )

  createEffect(
    on(
      () => props.dirs().join("\n"),
      () => {
        trace("effect:dirs")
        props.dirs().forEach((dir) => void globalSync.project.loadSessions(dir))
      },
    ),
  )

  const fetchSessions = async (reset = true, src = "unknown") => {
    const cat = active()
    const dirs = props.dirs()
    const id = key()
    if (!cat || dirs.length === 0) {
      setPages((all) => ({ ...all, [id]: { dirs: {}, loading: false } }))
      trace("sessions:empty", { src, hasCat: !!cat, dirs: dirs.length })
      return
    }
    const state = src === "page-sig" ? pagechange : pagegate
    const request = src === "page-sig" ? pageChangeKey() : pageViewKey()
    const saved = reset && src !== "page-sig" ? cache.pages.get(request) : undefined
    if (saved) {
      writePage(id, saved, request)
      trace("sessions:cache", { src, reset, rows: Object.keys(saved.dirs).length })
      return
    }
    const allow = reset ? gate(state, request) : true
    trace("sessions:gate", { src, reset, allow, key: sig(request), page: sig(pageSig()) })
    if (!allow) return
    const token = ++pagerev.value
    trace("sessions:start", { src, token, reset, cat: cat.id })

    setPages((all) => ({
      ...all,
      [id]: { dirs: reset ? {} : (all[id]?.dirs ?? {}), loading: true },
    }))

    const rows = await Promise.all(
      dirs.map(async (dir) => {
        const prev = pages()[id]?.dirs[dir]
        const next = catalogForDirectory(cats(), cat, dir)
        if (!next) {
          trace("sessions:skip-dir", { src, token, dir, reason: "no-catalog", cat: cat.id })
          return { dir, page: prev ?? { pinned: empty, items: empty, count: 0, more: false } }
        }
        if (!reset && prev && !prev.more) {
          trace("sessions:skip-dir", { src, token, dir, reason: "no-more", cat: next.id })
          return { dir, page: prev }
        }
        trace("sessions:request", {
          src,
          token,
          dir,
          catalogID: next.id,
          reset,
          cursor: reset ? undefined : prev?.cursor,
          search: query() || undefined,
        })
        const result = await globalSDK.client.session.catalog
          .sessions({
            directory: dir,
            catalogID: next.id,
            limit: size,
            cursor: reset ? undefined : prev?.cursor,
            ...(query() && { search: query() }),
          })
          .catch((err) => {
            trace("sessions:error", { src, token, dir, message: error(err, language.t("common.requestFailed")) })
            showToast({
              variant: "error",
              title: language.t("toast.session.listFailed.title", { project: dir }),
              description: error(err, language.t("common.requestFailed")),
            })
            return
          })
        const data = result?.data
        if (!data) return { dir, page: prev ?? { pinned: empty, items: empty, count: 0, more: false } }
        remember(seen.count, [...(data.pinned ?? empty), ...(data.items ?? empty)], false, next.id)
        remember(seen.page, [...(data.pinned ?? empty), ...(data.items ?? empty)], true, next.id)
        return {
          dir,
          page: {
            catalogID: next.id,
            pinned: data.pinned ?? empty,
            items: reset ? (data.items ?? empty) : merge(prev?.items ?? empty, data.items ?? empty),
            count: data.count ?? 0,
            cursor: data.nextCursor,
            more: !!data.nextCursor,
          },
        }
      }),
    )
    const ok = token === pagerev.value
    if (reset) done(state, request, ok)
    trace("sessions:done", {
      src,
      token,
      ok,
      rows: rows.map((row) => ({
        dir: row.dir,
        pinned: row.page.pinned.length,
        items: row.page.items.length,
        count: row.page.count,
        more: row.page.more,
      })),
    })
    if (!ok) return
    writePage(
      id,
      {
        dirs: Object.fromEntries(rows.map((row) => [row.dir, row.page])),
        loading: false,
      },
      request,
    )
  }

  createEffect(
    on(
      () =>
        `${activeID()}\n${props.dirs().join("\n")}\n${cats()
          .map((cat) => `${cat.directory}:${cat.id}:${cat.key ?? ""}`)
          .join("\n")}\n${query()}`,
      () => {
        trace("effect:sessions", { src: "view" })
        void fetchSessions(true, "view")
      },
    ),
  )

  createEffect(
    on(
      () => `${globalSDK.url}\n${dir()}`,
      () => {
        trace("effect:reset")
        marks.count.value = undefined
        marks.page.value = undefined
        seen.count.clear()
        seen.page.clear()
      },
    ),
  )

  createEffect(() => {
    const ok = ready()
    const next = countSig()
    const prev = marks.count.value
    const hit = changed(marks.count, next, ok)
    trace("effect:count-sig", { hit, prev: prev ? sig(prev) : undefined, next: sig(next) })
    if (!hit) return
    if (dircats().length === 0) return
    void fetchCounts("count-sig")
  })

  createEffect(() => {
    const ok = ready()
    const next = pageSig()
    const prev = marks.page.value
    const hit = changed(marks.page, next, ok)
    trace("effect:page-sig", { hit, prev: prev ? sig(prev) : undefined, next: sig(next) })
    if (!hit) return
    if (!activeID()) return
    void fetchSessions(true, "page-sig")
  })

  const pinlist = createMemo(() => {
    const dirs = Object.values(page()?.dirs ?? {})
    return sort(dirs.flatMap((dir) => dir?.pinned ?? empty))
  })

  const all = createMemo(() => {
    const dirs = Object.values(page()?.dirs ?? {})
    return sort(dirs.flatMap((dir) => dir?.items ?? empty))
  })

  const searched = createMemo(() => [...pinlist(), ...all()])
  const busy = createMemo(() => loading() && searched().length === 0)

  const count = (cat: SessionCatalog) => {
    return totals()[cat.id] ?? 0
  }

  const more = createMemo(() => {
    if (loading()) return false
    return Object.values(page()?.dirs ?? {}).some((dir) => !!dir?.more)
  })

  const format = (session: Session) => {
    const diff = Math.max(0, props.now() - stamp(session))
    const minute = Math.floor(diff / 60_000)
    if (minute < 1) return language.t("common.time.justNow")
    if (minute < 60) return language.t("common.time.minutesAgo.short", { count: minute })
    const hour = Math.floor(minute / 60)
    if (hour < 24) return language.t("common.time.hoursAgo.short", { count: hour })
    const day = Math.floor(hour / 24)
    if (day < 7) return language.t("common.time.daysAgo.short", { count: day })
    return new Intl.DateTimeFormat(language.intl(), { month: "short", day: "numeric" }).format(new Date(stamp(session)))
  }

  const saveCat = async (cat: SessionCatalog | undefined, name: string) => {
    const next = name.trim()
    const directory = dir()
    if (!next || !directory) return false
    const result = await (
      cat
        ? globalSDK.client.session.catalog.update({ directory, catalogID: cat.id, body_name: next })
        : globalSDK.client.session.catalog.create({ directory, body_name: next, icon: "folder" })
    ).catch((err) => {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: error(err, language.t("common.requestFailed")),
      })
      return
    })
    if (!result?.data) return false
    const data = result.data
    if (!cat) {
      writeCats([...cats(), data])
      stale()
      setState("cat", data.id)
      return true
    }
    writeCats(cats().map((item) => (item.id === cat.id ? data : item)))
    return true
  }

  const CatDialog = (input: { cat?: SessionCatalog }) => {
    const [value, setValue] = createSignal(input.cat ? label(input.cat) : "")
    const save = () => void saveCat(input.cat, value()).then((ok) => ok && dialog.close())
    return (
      <Dialog
        title={input.cat ? language.t("conversation.category.rename") : language.t("conversation.category.new")}
        fit
      >
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <TextField
            autofocus
            label={language.t("conversation.category.name")}
            value={value()}
            placeholder={language.t("conversation.category.placeholder")}
            onInput={(event) => setValue(event.currentTarget.value)}
            onKeyDown={(event: KeyboardEvent) => {
              if (event.key !== "Enter") return
              save()
            }}
          />
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button variant="primary" size="large" onClick={save}>
              {input.cat ? language.t("common.rename") : language.t("conversation.category.create")}
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

  const showCat = (cat?: SessionCatalog) => dialog.show(() => <CatDialog cat={cat} />)

  const removeCat = async (cat: SessionCatalog) => {
    const directory = dir()
    const ok = await globalSDK.client.session.catalog
      .delete({ directory, catalogID: cat.id })
      .then((result) => result.data)
      .catch((err) => {
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: error(err, language.t("common.requestFailed")),
        })
        return false
      })
    if (!ok) return false
    const list = writeCats(cats().filter((item) => item.id !== cat.id))
    stale()
    props.dirs().forEach((dir) => {
      const [, setStore] = globalSync.child(dir, { bootstrap: false })
      setStore(
        produce((draft) => {
          draft.session
            .filter((session) => session.catalogID === cat.id)
            .forEach((session) => {
              session.catalogID = undefined
            })
        }),
      )
    })
    if (state.cat === cat.id) setState("cat", list[0]?.id ?? "")
    return true
  }

  const confirmRemoveCat = (cat: SessionCatalog) => {
    if (!window.confirm(language.t("conversation.category.deleteConfirm", { name: label(cat) }))) return
    void removeCat(cat)
  }

  const updateLocal = (session: Session, next: Session) => {
    const [, setStore] = globalSync.child(session.directory, { bootstrap: false })
    setStore(
      produce((draft) => {
        const idx = draft.session.findIndex((item) => item.id === session.id)
        if (idx !== -1) draft.session[idx] = next
      }),
    )
  }

  const patchPages = (next: Session) => {
    const patch = (page: Page): Page => ({
      ...page,
      dirs: Object.fromEntries(
        Object.entries(page.dirs).map(([dir, item]) => [
          dir,
          item && {
            ...item,
            pinned: item.pinned.map((session) => (session.id === next.id ? next : session)),
            items: item.items.map((session) => (session.id === next.id ? next : session)),
          },
        ]),
      ),
    })
    cache.pages.forEach((page, key) => {
      cache.pages.set(key, patch(page))
    })
    setPages((all) =>
      Object.fromEntries(Object.entries(all).map(([id, page]) => [id, patch(page)])),
    )
  }

  const updateSession = async (
    session: Session,
    input: { catalogID?: string | null; pinned?: boolean; time?: { archived?: number | null } },
  ) => {
    const result = await globalSDK.client.session
      .update({ directory: session.directory, sessionID: session.id, ...input })
      .catch((err) => {
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: error(err, language.t("common.requestFailed")),
        })
        return
      })
    if (!result?.data) return
    const next = {
      ...result.data,
      ...("catalogID" in input && { catalogID: input.catalogID ?? undefined }),
    }
    updateLocal(session, next)
    return next
  }

  const moveSession = async (session: Session, cat: SessionCatalog) => {
    if (catid(session) === cat.id) return
    const next = await updateSession(session, { catalogID: cat.key === temp ? null : cat.id })
    if (!next) return
    stale()
    setState("cat", cat.id)
    void globalSync.project.loadSessions(session.directory)
  }

  const rename = async (session: Session, title: string) => {
    const next = title.trim()
    if (!next || next === session.title) return
    await globalSDK.client.session
      .update({ directory: session.directory, sessionID: session.id, title: next })
      .then((result) => {
        if (result.data) {
          updateLocal(session, result.data)
          patchPages(result.data)
        }
      })
      .catch((err) => {
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: error(err, language.t("common.requestFailed")),
        })
      })
  }

  const RenameDialog = (input: { session: Session }) => {
    const [value, setValue] = createSignal(input.session.title)
    const save = () => void rename(input.session, value()).then(() => dialog.close())
    return (
      <Dialog title={language.t("conversation.session.rename")} fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <TextField
            autofocus
            label={language.t("conversation.session.name")}
            value={value()}
            onInput={(event) => setValue(event.currentTarget.value)}
            onKeyDown={(event: KeyboardEvent) => {
              if (event.key !== "Enter") return
              save()
            }}
          />
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button variant="primary" size="large" onClick={save}>
              {language.t("common.rename")}
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

  const showRename = (session: Session) => dialog.show(() => <RenameDialog session={session} />)

  const archive = async (session: Session) => {
    const id = archcat()?.id
    await props.archiveSession(session, { catalogID: id, pinned: false })
    stale()
  }

  const unarchive = async (session: Session) => {
    await updateSession(session, { catalogID: null, time: { archived: null } })
    stale()
    void globalSync.project.loadSessions(session.directory)
  }

  const remove = async (session: Session) => {
    const ok = await globalSDK.client.session
      .delete({ directory: session.directory, sessionID: session.id })
      .then((result) => result.data)
      .catch((err) => {
        showToast({
          variant: "error",
          title: language.t("session.delete.failed.title"),
          description: error(err, language.t("common.requestFailed")),
        })
        return false
      })
    if (!ok) return false

    const [, setStore] = globalSync.child(session.directory, { bootstrap: false })
    setStore(
      produce((draft) => {
        const gone = collect(draft.session, new Set([session.id]))
        draft.session = draft.session.filter((item) => !gone.has(item.id))
      }),
    )
    stale()
    if (params.id === session.id) props.openNew(session.directory)
    return true
  }

  const confirmRemove = (session: Session) => {
    if (!window.confirm(language.t("session.delete.confirm", { name: session.title }))) return
    void remove(session)
  }

  const load = async () => {
    await fetchSessions(false, "load-more")
  }

  const Section = (input: {
    title: string
    icon: IconProps["name"]
    count: number
    list: Session[]
    open: boolean
    toggle: () => void
  }) => (
    <Show when={input.list.length > 0}>
      <section class="flex flex-col gap-1">
        <button
          type="button"
          class="flex h-7 items-center justify-between rounded-md px-1 text-left outline-none transition-colors hover:bg-surface-raised-base-hover"
          aria-label={input.open ? language.t("conversation.section.collapse") : language.t("conversation.section.expand")}
          aria-expanded={input.open}
          onClick={input.toggle}
        >
          <div class="flex min-w-0 items-center gap-1.5 text-text-base">
            <Icon name={input.icon} size="small" class="shrink-0 text-icon-base" />
            <span class="truncate text-11-medium">{input.title}</span>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <div class="text-10-regular text-text-weak">{input.count}</div>
            <Icon
              name={input.open ? "chevron-down" : "chevron-right"}
              size="small"
              class="shrink-0 text-icon-base"
            />
          </div>
        </button>
        <Show when={input.open}>
          <For each={input.list}>{(session) => <Row session={session} />}</For>
        </Show>
      </section>
    </Show>
  )

  const Row = (input: { session: Session }) => {
    const session = input.session
    const selected = () => params.id === session.id
    const [move, setMove] = createSignal(false)
    const [store] = globalSync.child(session.directory)
    const unseen = createMemo(() => notification.session.unseenCount(session.id))
    const errored = createMemo(() => notification.session.unseenHasError(session.id))
    const permit = createMemo(() => {
      return !!sessionPermissionRequest(store.session, store.permission, session.id, (item) => {
        return !permission.autoResponds(item, session.directory)
      })
    })
    const working = createMemo(() => {
      if (permit()) return false
      const pending = (store.message[session.id] ?? []).findLast(
        (message) =>
          message.role === "assistant" &&
          typeof (message as { time?: { completed?: unknown } }).time?.completed !== "number",
      )
      const status = store.session_status[session.id]
      return (
        pending !== undefined ||
        status?.type === "busy" ||
        status?.type === "retry" ||
        (status !== undefined && status.type !== "idle")
      )
    })
    const tint = createMemo(() => messageAgentColor(store.message[session.id], store.agent))
    return (
      <div
        data-session-id={session.id}
        class="group/session flex min-w-0 items-center gap-2 rounded-md px-[5px] py-[4px] transition-colors"
        classList={{
          "bg-surface-base-active": selected(),
          "hover:bg-surface-raised-base-hover": !selected(),
        }}
        onPointerEnter={() => props.prefetchSession(session, "low")}
        onPointerDown={() => props.prefetchSession(session, "high")}
        onClick={() => props.openSession(session)}
      >
        <div
          class="flex size-6 shrink-0 items-center justify-center"
          style={{ color: tint() ?? "var(--icon-interactive-base)" }}
        >
          <Switch fallback={<Icon name="dash" size="small" class="text-icon-weak" />}>
            <Match when={working()}>
              <Spinner class="size-[15px]" />
            </Match>
            <Match when={permit()}>
              <div class="size-1.5 rounded-full bg-surface-warning-strong" />
            </Match>
            <Match when={errored()}>
              <div class="size-1.5 rounded-full bg-text-diff-delete-base" />
            </Match>
            <Match when={unseen() > 0}>
              <div class="size-1.5 rounded-full bg-text-interactive-base" />
            </Match>
          </Switch>
        </div>
        <div class="min-w-0 flex-1">
          <div class="truncate text-12-medium text-text-strong">{session.title}</div>
        </div>
        <div class="relative flex h-6 w-14 shrink-0 items-center justify-end">
          <div class="text-10-regular text-text-weak transition-opacity group-hover/session:opacity-0 group-focus-within/session:opacity-0">
            {format(session)}
          </div>
          <DropdownMenu
            modal={!props.hovering()}
            onOpenChange={(open) => {
              if (!open) setMove(false)
            }}
          >
            <Tooltip value={language.t("common.moreOptions")} placement="top">
              <DropdownMenu.Trigger
                as={IconButton}
                icon="dot-grid"
                variant="ghost"
                class="pointer-events-none absolute right-0 top-1/2 size-6 -translate-y-1/2 rounded-md opacity-0 transition-opacity group-hover/session:pointer-events-auto group-hover/session:opacity-100 group-focus-within/session:pointer-events-auto group-focus-within/session:opacity-100 data-[expanded]:pointer-events-auto data-[expanded]:opacity-100"
                aria-label={language.t("common.moreOptions")}
                onClick={(event: MouseEvent) => {
                  event.preventDefault()
                  event.stopPropagation()
                }}
              />
            </Tooltip>
            <DropdownMenu.Portal>
              <DropdownMenu.Content class="min-w-36">
                <Show
                  when={move()}
                  fallback={
                    <>
                      <DropdownMenu.Item
                        onSelect={() => {
                          void updateSession(session, { pinned: !pinned(session) }).then((next) => {
                            if (next) stale()
                          })
                        }}
                      >
                        <DropdownMenu.ItemLabel>
                          {pinned(session)
                            ? language.t("conversation.session.unpin")
                            : language.t("conversation.session.pin")}
                        </DropdownMenu.ItemLabel>
                      </DropdownMenu.Item>
                      <Show when={movable(active()?.key)}>
                        <button
                          type="button"
                          data-slot="dropdown-menu-item"
                          class="w-full justify-start text-left hover:bg-surface-raised-base-hover"
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            setMove(true)
                          }}
                        >
                          <span data-slot="dropdown-menu-item-label">{language.t("conversation.session.move")}</span>
                        </button>
                      </Show>
                      <DropdownMenu.Item onSelect={() => showRename(session)}>
                        <DropdownMenu.ItemLabel>{language.t("common.rename")}</DropdownMenu.ItemLabel>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        onSelect={() => void (active()?.key === archived ? unarchive(session) : archive(session))}
                      >
                        <DropdownMenu.ItemLabel>
                          {active()?.key === archived
                            ? language.t("conversation.session.unarchive")
                            : language.t("common.archive")}
                        </DropdownMenu.ItemLabel>
                      </DropdownMenu.Item>
                      <DropdownMenu.Separator />
                      <DropdownMenu.Item onSelect={() => confirmRemove(session)}>
                        <DropdownMenu.ItemLabel class="text-[#DC2626]">
                          {language.t("common.delete")}
                        </DropdownMenu.ItemLabel>
                      </DropdownMenu.Item>
                    </>
                  }
                >
                  <button
                    type="button"
                    data-slot="dropdown-menu-item"
                    class="w-full justify-start text-left hover:bg-surface-raised-base-hover"
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      setMove(false)
                    }}
                  >
                    <span data-slot="dropdown-menu-item-label" class="flex min-w-0 items-center gap-2">
                      <Icon name="arrow-left" size="small" class="shrink-0 text-icon-base" />
                      <span>{language.t("conversation.session.moveBack")}</span>
                    </span>
                  </button>
                  <DropdownMenu.Separator />
                  <For each={dircats().filter((cat) => cat.key !== archived)}>
                    {(cat) => (
                      <DropdownMenu.Item
                        disabled={catid(session) === cat.id}
                        class="max-w-60"
                        onSelect={() => void moveSession(session, cat)}
                      >
                        <DropdownMenu.ItemLabel class="flex min-w-0 items-center gap-2">
                          <Show when={catid(session) === cat.id} fallback={<span class="size-4 shrink-0" />}>
                            <Icon name="check-small" size="small" class="shrink-0 text-icon-base" />
                          </Show>
                          <span class="min-w-0 truncate">{label(cat)}</span>
                        </DropdownMenu.ItemLabel>
                      </DropdownMenu.Item>
                    )}
                  </For>
                </Show>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu>
        </div>
      </div>
    )
  }

  return (
    <div
      classList={{
        "flex flex-col min-h-0 min-w-0 box-border rounded-tl-[12px] bg-background-base": true,
        "border-l border-t border-border-weaker-base": props.merged(),
        "border border-b-0 border-border-weak-base": !props.merged(),
        "flex-1 max-w-full overflow-hidden": !!props.mobile,
      }}
      style={{ width: props.mobile ? undefined : `${props.width()}px` }}
    >
      <Show
        when={props.project()}
        fallback={
          <div class="flex-1 min-h-0 flex items-center justify-center px-6 pb-32 text-center">
            <div class="flex max-w-60 flex-col items-center gap-6">
              <div class="flex flex-col gap-2">
                <div class="text-12-medium text-text-strong">{language.t("sidebar.empty.title")}</div>
                <div class="text-12-regular text-text-base">{language.t("sidebar.empty.description")}</div>
              </div>
              <Button size="large" icon="folder-add-left" onClick={props.chooseProject}>
                {language.t("command.project.open")}
              </Button>
            </div>
          </div>
        }
      >
        <div class="flex h-full min-h-0 flex-col">
          <div class="shrink-0 px-5 pb-4 pt-5">
            <div class="flex items-center justify-between gap-3">
              <h2 class="truncate text-[16px] font-medium leading-6 tracking-normal text-text-strong">
                {language.t("conversation.title")}
              </h2>
              <Tooltip value={language.t("command.session.new")} placement="bottom">
                <IconButton
                  icon="new-session"
                  variant="ghost"
                  class="-mr-2 size-8 rounded-md"
                  disabled={!dir()}
                  aria-label={language.t("command.session.new")}
                  onClick={() => {
                    const next = dir()
                    if (!next) return
                    const cat = tempcat()
                    if (cat) setState("cat", cat.id)
                    stale()
                    props.openNew(next)
                  }}
                />
              </Tooltip>
            </div>

            <div class="mt-3">
              <label class="flex h-10 min-w-0 w-full items-center gap-2 rounded-md border border-border-weak-base bg-background-base px-3 focus-within:border-border-strong-base">
                <Icon name="magnifying-glass" size="small" class="text-icon-base" />
                <input
                  class="min-w-0 flex-1 bg-transparent text-12-regular text-text-strong outline-none placeholder:text-text-weak"
                  value={state.query}
                  placeholder={language.t("conversation.search")}
                  onInput={(event) => setState("query", event.currentTarget.value)}
                />
              </label>
            </div>

            <div class="mt-3 flex flex-col gap-1">
              <div class="flex h-7 items-center justify-between rounded-md transition-colors hover:bg-surface-raised-base-hover">
                <button
                  type="button"
                  class="flex h-full min-w-0 flex-1 items-center text-left outline-none"
                  aria-label={
                    section.category
                      ? language.t("conversation.section.collapse")
                      : language.t("conversation.section.expand")
                  }
                  aria-expanded={section.category}
                  onClick={() => setSection("category", (value) => !value)}
                >
                  <div class="truncate text-12-medium text-text-strong">{language.t("conversation.category.title")}</div>
                </button>
                <div class="flex shrink-0 items-center gap-1">
                  <Tooltip value={language.t("conversation.category.new")} placement="top">
                    <IconButton
                      icon="plus-small"
                      variant="ghost"
                      class="size-7 translate-x-0.5 rounded-md"
                      aria-label={language.t("conversation.category.new")}
                      onClick={(event: MouseEvent) => {
                        event.preventDefault()
                        event.stopPropagation()
                        showCat()
                      }}
                    />
                  </Tooltip>
                  <Tooltip
                    value={
                      section.category
                        ? language.t("conversation.section.collapse")
                        : language.t("conversation.section.expand")
                    }
                    placement="top"
                  >
                    <IconButton
                      icon={section.category ? "chevron-down" : "chevron-right"}
                      variant="ghost"
                      class="size-5 rounded-md"
                      aria-label={
                        section.category
                          ? language.t("conversation.section.collapse")
                          : language.t("conversation.section.expand")
                      }
                      aria-expanded={section.category}
                      onClick={(event: MouseEvent) => {
                        event.preventDefault()
                        event.stopPropagation()
                        setSection("category", (value) => !value)
                      }}
                    />
                  </Tooltip>
                </div>
              </div>
              <Show when={section.category}>
                <div class="flex flex-col gap-1">
                  <For each={dircats()}>
                    {(cat) => (
                      <button
                        type="button"
                        class="group/cat flex w-full items-center gap-2 rounded-md px-[5px] py-[4px] text-left transition-colors hover:bg-surface-raised-base-hover"
                        classList={{ "bg-surface-base-active": activeID() === cat.id }}
                        onClick={() => setState("cat", cat.id)}
                      >
                        <Icon
                          name={cat.key ? icons[cat.key] : (cat.icon as IconProps["name"])}
                          size="small"
                          class="shrink-0 text-icon-base"
                        />
                        <span class="min-w-0 flex-1 truncate text-12-medium text-text-strong">{label(cat)}</span>
                        <div class="relative flex h-6 w-8 shrink-0 items-center justify-end">
                          <span
                            class="text-11-regular text-text-weak transition-opacity"
                            classList={{
                              "group-hover/cat:opacity-0 group-focus-within/cat:opacity-0": !system(cat),
                            }}
                          >
                            {count(cat)}
                          </span>
                          <Show when={!system(cat)}>
                            <DropdownMenu modal={!props.hovering()}>
                              <DropdownMenu.Trigger
                                as={IconButton}
                                icon="dot-grid"
                                variant="ghost"
                                class="pointer-events-none absolute right-0 size-6 rounded-md opacity-0 transition-opacity group-hover/cat:pointer-events-auto group-hover/cat:opacity-100 group-focus-within/cat:pointer-events-auto group-focus-within/cat:opacity-100 data-[expanded]:pointer-events-auto data-[expanded]:opacity-100"
                                aria-label={language.t("common.moreOptions")}
                                onClick={(event: MouseEvent) => {
                                  event.preventDefault()
                                  event.stopPropagation()
                                }}
                              />
                              <DropdownMenu.Portal>
                                <DropdownMenu.Content>
                                  <DropdownMenu.Item
                                    onSelect={() => {
                                      const next = dir()
                                      if (!next) return
                                      stale()
                                      props.openNew(next, { catalogID: cat.id })
                                    }}
                                  >
                                    <DropdownMenu.ItemLabel>{language.t("command.session.new")}</DropdownMenu.ItemLabel>
                                  </DropdownMenu.Item>
                                  <DropdownMenu.Item onSelect={() => showCat(cat)}>
                                    <DropdownMenu.ItemLabel>{language.t("common.rename")}</DropdownMenu.ItemLabel>
                                  </DropdownMenu.Item>
                                  <DropdownMenu.Item onSelect={() => confirmRemoveCat(cat)}>
                                    <DropdownMenu.ItemLabel>{language.t("common.delete")}</DropdownMenu.ItemLabel>
                                  </DropdownMenu.Item>
                                </DropdownMenu.Content>
                              </DropdownMenu.Portal>
                            </DropdownMenu>
                          </Show>
                        </div>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </div>

          <div
            ref={(el) => props.scrollRef(el)}
            class="flex-1 min-h-0 overflow-y-auto px-5 pb-5 no-scrollbar [overflow-anchor:none]"
          >
            <div class="flex items-center justify-between pb-2">
              <div class="text-12-medium text-text-strong">{language.t("conversation.list.title")}</div>
            </div>

            <Show
              when={!busy()}
              fallback={
                <div class="px-1 py-6 text-12-regular text-text-weak">{language.t("conversation.list.loading")}</div>
              }
            >
              <div class="flex flex-col gap-1">
                <Section
                  title={language.t("conversation.pinned")}
                  icon="pin"
                  count={pinlist().length}
                  list={pinlist()}
                  open={section.pinned}
                  toggle={() => setSection("pinned", (value) => !value)}
                />
                <Section
                  title={language.t("conversation.all")}
                  icon="bullet-list"
                  count={all().length}
                  list={all()}
                  open={section.all}
                  toggle={() => setSection("all", (value) => !value)}
                />
                <Show when={searched().length === 0}>
                  <div class="px-1 py-6 text-12-regular text-text-weak">{language.t("conversation.empty")}</div>
                </Show>
                <Show when={more()}>
                  <Button variant="ghost" size="large" class="w-full justify-center" onClick={() => void load()}>
                    {language.t("common.loadMore")}
                  </Button>
                </Show>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  )
}
