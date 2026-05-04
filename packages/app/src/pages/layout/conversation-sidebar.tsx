import { useParams } from "@solidjs/router"
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, on, type Accessor } from "solid-js"
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
import { archivedList, movable, workspaceKey } from "./helpers"

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
  openNew: (dir: string) => void
  openSession: (session: Session) => void
  prefetchSession: (session: Session, priority?: "high" | "low") => void
  archiveSession: (session: Session, input?: { catalogID?: string; pinned?: boolean }) => Promise<void>
  scrollRef: (el: HTMLDivElement | undefined) => void
}

const temp = "temp"
const archived = "archived"

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

function stamp(session: Session) {
  return session.time.updated ?? session.time.created
}

function sort(list: Session[]) {
  return list.slice().sort((a, b) => stamp(b) - stamp(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
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

export function ConversationSidebar(props: Props) {
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
    loading: false,
  })

  const [cats, setCats] = createSignal<SessionCatalog[]>([])
  const [arch, setArch] = createSignal<Session[]>(empty)
  const rev = { value: 0 }
  const catrev = { value: 0 }

  const ids = createMemo(() => new Set(cats().map((cat) => cat.id)))
  const dir = createMemo(() => props.currentDir() || props.dirs()[0] || props.project()?.worktree || "")
  const active = createMemo(() => cats().find((cat) => cat.id === state.cat) ?? cats()[0])
  const activeID = createMemo(() => active()?.id ?? "")
  const tempcat = createMemo(() => cats().find((cat) => cat.key === temp) ?? cats()[0])
  const archcat = createMemo(() => cats().find((cat) => cat.key === archived))
  const base = createMemo(() => sort(props.sessions().filter((session) => !session.parentID && !session.time.archived)))
  const system = (cat: SessionCatalog) => cat.key === temp || cat.key === archived

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

  const fetchCats = async () => {
    const directory = dir()
    const token = ++catrev.value
    if (!directory) {
      setCats([])
      setState("cat", "")
      return
    }
    const result = await globalSDK.client.session.catalog.list({ directory }).catch((err) => {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: error(err, language.t("common.requestFailed")),
      })
      return
    })
    if (token !== catrev.value || !result) return
    const list = result.data ?? []
    setCats(list)
    if (!list.some((cat) => cat.id === state.cat)) setState("cat", list[0]?.id ?? "")
  }

  const fetchArchived = async () => {
    const dirs = props.dirs()
    const token = ++rev.value
    if (dirs.length === 0) {
      setArch(empty)
      setState("loading", false)
      return
    }
    setState("loading", true)
    const list = await Promise.all(
      dirs.map((dir) =>
        globalSDK.client.experimental.session
          .list({ directory: dir, roots: true, archived: true, limit: 300 })
          .then((result) => (result.data ?? []).filter((session) => !!session?.id && !!session.time.archived))
          .catch((err) => {
            showToast({
              variant: "error",
              title: language.t("toast.session.listFailed.title", { project: dir }),
              description: error(err, language.t("common.requestFailed")),
            })
            return empty
          }),
      ),
    )
    if (token !== rev.value) return
    setArch(sort(list.flat()))
    setState("loading", false)
  }

  createEffect(() => {
    const list = cats()
    if (list.some((cat) => cat.id === state.cat)) return
    setState("cat", list[0]?.id ?? "")
  })

  createEffect(
    on(
      () => dir(),
      () => void fetchCats(),
    ),
  )

  createEffect(
    on(
      () => props.dirs().join("\n"),
      () => {
        props.dirs().forEach((dir) => void globalSync.project.loadSessions(dir))
        void fetchArchived()
      },
    ),
  )

  const scoped = createMemo(() => {
    if (active()?.key === archived) return arch()
    const list = base().filter((session) => catid(session) === activeID())
    if (list.length > 0) return list
    return base()
  })

  const searched = createMemo(() => {
    const q = state.query.trim().toLowerCase()
    const list = q ? scoped().filter((session) => session.title.toLowerCase().includes(q)) : scoped()
    return sort(list)
  })

  const pinlist = createMemo(() => searched().filter((session) => pinned(session)))
  const all = createMemo(() => searched().filter((session) => !pinned(session)))

  const count = (cat: SessionCatalog) => {
    if (cat.key === archived) return arch().length
    return base().filter((session) => catid(session) === cat.id).length
  }

  const more = createMemo(() => {
    if (active()?.key === archived || state.query.trim()) return false
    const limit = props.dirs().reduce((sum, dir) => {
      const [store] = globalSync.child(dir, { bootstrap: false })
      return sum + store.limit
    }, 0)
    if (scoped().length < limit) return false
    return props.dirs().some((dir) => {
      const [store] = globalSync.child(dir, { bootstrap: false })
      const count = (store.session ?? []).filter(
        (session) =>
          workspaceKey(session.directory) === workspaceKey(dir) && !session.parentID && !session.time.archived,
      ).length
      return store.sessionTotal > count
    })
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
      setCats((list) => [...list, data])
      setState("cat", data.id)
      return true
    }
    setCats((list) => list.map((item) => (item.id === cat.id ? data : item)))
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
    const list = cats().filter((item) => item.id !== cat.id)
    setCats(list)
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
    setArch((list) =>
      list.map((session) => (session.catalogID === cat.id ? { ...session, catalogID: undefined } : session)),
    )
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
    setArch((list) =>
      next.time.archived
        ? list.map((item) => (item.id === session.id ? next : item))
        : list.filter((item) => item.id !== session.id),
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
    setState("cat", cat.id)
    void globalSync.project.loadSessions(session.directory)
  }

  const rename = async (session: Session, title: string) => {
    const next = title.trim()
    if (!next || next === session.title) return
    await globalSDK.client.session
      .update({ directory: session.directory, sessionID: session.id, title: next })
      .then((result) => {
        if (result.data) updateLocal(session, result.data)
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
    setArch((list) => archivedList(list, session, id))
    if (active()?.key === archived) void fetchArchived()
  }

  const unarchive = async (session: Session) => {
    await updateSession(session, { catalogID: null, time: { archived: null } })
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
    setArch((list) => list.filter((item) => item.id !== session.id))
    if (params.id === session.id) props.openNew(session.directory)
    return true
  }

  const confirmRemove = (session: Session) => {
    if (!window.confirm(language.t("session.delete.confirm", { name: session.title }))) return
    void remove(session)
  }

  const load = async () => {
    await Promise.all(
      props.dirs().map(async (dir) => {
        const [, setStore] = globalSync.child(dir, { bootstrap: false })
        setStore("limit", (limit) => (limit ?? 0) + 5)
        await globalSync.project.loadSessions(dir)
      }),
    )
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
                          void updateSession(session, { pinned: !pinned(session) })
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
                  <For each={cats().filter((cat) => cat.key !== archived)}>
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
                  <For each={cats()}>
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
              when={active()?.key !== archived || !state.loading}
              fallback={<div class="px-1 py-6 text-12-regular text-text-weak">{language.t("prompt.loading")}</div>}
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
                <Show when={more() && active()?.key !== archived}>
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
