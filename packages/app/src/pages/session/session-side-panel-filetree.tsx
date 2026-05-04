import { For, Match, Show, Switch, batch, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { createMediaQuery } from "@solid-primitives/media"
import { Tabs } from "@opencode-ai/ui/tabs"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { ContextMenu } from "@opencode-ai/ui/context-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Mark } from "@opencode-ai/ui/logo"
import { showToast, toaster } from "@opencode-ai/ui/toast"
import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
import type { DragEvent as SolidDndDragEvent } from "@thisbeyond/solid-dnd"
import { ConstrainDragYAxis, getDraggableId } from "@/utils/solid-dnd"
import { useDialog } from "@opencode-ai/ui/context/dialog"

import FileTree, {
  clipboardPath,
  pasteBlocked,
  pasteTarget,
  type FileTreeClip,
  type FileTreeClipState,
  type FileTreeOps,
} from "@/components/file-tree"
import { SessionContextUsage } from "@/components/session-context-usage"
import { SessionContextTab, SortableTab, FileVisual } from "@/components/session"
import { useCommand } from "@/context/command"
import { useFile, type SelectedLineRange } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSync } from "@/context/sync"
import { createFileTabListSync } from "@/pages/session/file-tab-scroll"
import { FileTabContent } from "@/pages/session/file-tabs"
import { closePlan, createOpenSessionFileTab, createSessionTabs, getTabReorderIndex, type Sizing } from "@/pages/session/helpers"
import { setSessionHandoff } from "@/pages/session/handoff"
import { useSessionLayout } from "@/pages/session/session-layout"
import type { FileNode } from "@opencode-ai/sdk/v2"

type TreeNode = {
  path: string
  type: string
}

function expandedDirs(input: {
  children: (dir: string) => readonly TreeNode[]
  expanded: (dir: string) => boolean
  root?: string
}) {
  const seen = new Set<string>()
  const walk = (dir: string): string[] =>
    input.children(dir).flatMap((node) => {
      if (node.type !== "directory") return []
      if (seen.has(node.path)) return []
      seen.add(node.path)
      if (!input.expanded(node.path)) return []
      return [node.path, ...walk(node.path)]
    })

  return walk(input.root ?? "")
}

function RootInput(props: { placeholder: string; onConfirm: (name: string) => void; onCancel: () => void }) {
  let ref: HTMLInputElement | undefined
  createEffect(() => {
    ref?.focus()
    ref?.select()
  })
  return (
    <div class="px-1 py-1">
      <input
        ref={ref}
        class="w-full h-6 bg-surface-raised-base border border-border-base rounded-md px-2 text-12-medium text-text-strong outline-none focus:ring-1 focus:ring-border-focus"
        placeholder={props.placeholder}
        onKeyDown={(e) => {
          if (e.key === "Enter") props.onConfirm(e.currentTarget.value.trim())
          if (e.key === "Escape") props.onCancel()
        }}
        onBlur={(e) => props.onConfirm(e.currentTarget.value.trim())}
      />
    </div>
  )
}

function TreeAction(props: {
  icon: "refresh" | "file-plus" | "folder-add-left" | "collapse-all"
  label: string
  onClick: () => void
}) {
  return (
    <Tooltip value={<span>{props.label}</span>} placement="bottom">
      <IconButton
        icon={props.icon}
        variant="ghost"
        size="small"
        class="rounded-md text-icon-weak"
        onClick={props.onClick}
        aria-label={props.label}
      />
    </Tooltip>
  )
}

export function SessionSidePanel(props: {
  reviewPanel: () => JSX.Element
  activeDiff?: string
  focusReviewDiff: (path: string) => void
  reviewSnap: boolean
  size: Sizing
}) {
  const layout = useLayout()
  const sync = useSync()
  const file = useFile()
  const language = useLanguage()
  const command = useCommand()
  const dialog = useDialog()
  const { params, sessionKey, tabs, view } = useSessionLayout()

  const isDesktop = createMediaQuery("(min-width: 768px)")

  const reviewOpen = createMemo(() => isDesktop() && view().reviewPanel.opened())
  const fileOpen = createMemo(() => isDesktop() && layout.fileTree.opened())
  const open = createMemo(() => reviewOpen() || fileOpen())
  const reviewTab = createMemo(() => isDesktop())
  const panelWidth = createMemo(() => {
    if (!open()) return "0px"
    if (reviewOpen()) return `calc(100% - ${layout.session.width()}px)`
    return `${layout.fileTree.width()}px`
  })
  const treeWidth = createMemo(() => (fileOpen() ? `${layout.fileTree.width()}px` : "0px"))

  const info = createMemo(() => (params.id ? sync.session.get(params.id) : undefined))
  const diffs = createMemo(() => (params.id ? (sync.data.session_diff[params.id] ?? []) : []))
  const reviewCount = createMemo(() => Math.max(info()?.summary?.files ?? 0, diffs().length))
  const hasReview = createMemo(() => reviewCount() > 0)
  const diffFiles = createMemo(() => diffs().map((d) => d.file))
  const kinds = createMemo(() => {
    const merge = (a: "add" | "del" | "mix" | undefined, b: "add" | "del" | "mix") => {
      if (!a) return b
      if (a === b) return a
      return "mix" as const
    }

    const normalize = (p: string) => p.replaceAll("\\\\", "/").replace(/\/+$/, "")

    const out = new Map<string, "add" | "del" | "mix">()
    for (const diff of diffs()) {
      const file = normalize(diff.file)
      const kind = diff.status === "added" ? "add" : diff.status === "deleted" ? "del" : "mix"

      out.set(file, kind)

      const parts = file.split("/")
      for (const [idx] of parts.slice(0, -1).entries()) {
        const dir = parts.slice(0, idx + 1).join("/")
        if (!dir) continue
        out.set(dir, merge(out.get(dir), kind))
      }
    }
    return out
  })

  const empty = (msg: string) => (
    <div class="h-full flex flex-col">
      <div class="h-6 shrink-0" aria-hidden />
      <div class="flex-1 pb-64 flex items-center justify-center text-center">
        <div class="text-12-regular text-text-weak">{msg}</div>
      </div>
    </div>
  )

  const nofiles = createMemo(() => {
    const state = file.tree.state("")
    if (!state?.loaded) return false
    return file.tree.children("").length === 0
  })

  const normalizeTab = (tab: string) => {
    if (!tab.startsWith("file://")) return tab
    return file.tab(tab)
  }

  const openReviewPanel = () => {
    if (!view().reviewPanel.opened()) view().reviewPanel.open()
  }

  const openTab = createOpenSessionFileTab({
    normalizeTab,
    openTab: tabs().open,
    pathFromTab: file.pathFromTab,
    loadFile: file.load,
    openReviewPanel,
    setActive: tabs().setActive,
  })

  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab,
    review: reviewTab,
    hasReview,
  })
  const contextOpen = tabState.contextOpen
  const openedTabs = tabState.openedTabs
  const activeTab = tabState.activeTab
  const activeFileTab = tabState.activeFileTab
  const path = createMemo(() => {
    const tab = activeFileTab()
    if (!tab) return
    return file.pathFromTab(tab)
  })
  const closeTabs = (mode: "all" | "others", target: string) => {
    const plan = closePlan({ tabs: tabs().all(), target, active: tabs().active(), mode })
    batch(() => {
      tabs().setAll(plan.all)
      tabs().setActive(plan.active)
    })
  }

  const fileTreeTab = () => layout.fileTree.tab()

  const showAllFiles = () => {
    if (fileTreeTab() !== "changes") return
    layout.fileTree.setTab("all")
  }

  const [store, setStore] = createStore({
    activeDraggable: undefined as string | undefined,
  })

  const handleDragStart = (event: unknown) => {
    const id = getDraggableId(event)
    if (!id) return
    setStore("activeDraggable", id)
  }

  const handleDragOver = (event: SolidDndDragEvent) => {
    const { draggable, droppable } = event
    if (!draggable || !droppable) return

    const currentTabs = tabs().all()
    const toIndex = getTabReorderIndex(currentTabs, draggable.id.toString(), droppable.id.toString())
    if (toIndex === undefined) return
    tabs().move(draggable.id.toString(), toIndex)
  }

  const handleDragEnd = () => {
    setStore("activeDraggable", undefined)
  }

  const [uploading, setUploading] = createSignal(false)
  const [rootCreate, setRootCreate] = createSignal<"file" | "folder" | null>(null)

  const readEntry = (entry: FileSystemEntry, base: string): Promise<{ path: string; content: string; encoding: "base64" }[]> => {
    return new Promise((ok) => {
      if (entry.isFile) {
        ;(entry as FileSystemFileEntry).file((f) => {
          const reader = new FileReader()
          reader.onload = () => {
            const raw = reader.result as string
            const content = raw.split(",")[1] || ""
            ok([{ path: base ? `${base}/${entry.name}` : entry.name, content, encoding: "base64" }])
          }
          reader.readAsDataURL(f)
        })
        return
      }
      if (entry.isDirectory) {
        const dir = entry as FileSystemDirectoryEntry
        const dirReader = dir.createReader()
        dirReader.readEntries(async (entries) => {
          const all: { path: string; content: string; encoding: "base64" }[] = []
          for (const child of entries) {
            const sub = await readEntry(child, base ? `${base}/${entry.name}` : entry.name)
            all.push(...sub)
          }
          ok(all)
        })
        return
      }
      ok([])
    })
  }

  const handleUploadDrop = async (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const items = e.dataTransfer?.items
    if (!items) return

    const entries: FileSystemEntry[] = []
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry?.()
      if (entry) entries.push(entry)
    }
    if (entries.length === 0) return

    showToast({ title: language.t("fileTree.upload.start") })
    setUploading(true)
    const tid = showToast({ variant: "loading", title: language.t("fileTree.upload.progress"), persistent: true })
    const all: { path: string; content: string; encoding: "base64" }[] = []
    for (const entry of entries) {
      const sub = await readEntry(entry, "")
      all.push(...sub)
    }
    let uploadErr: unknown
    await file.upload(all).catch((err: unknown) => { uploadErr = err })
    toaster.dismiss(tid)
    setUploading(false)
    if (uploadErr) {
      showToast({
        variant: "error",
        title: language.t("fileTree.upload.error"),
        description: uploadErr instanceof Error ? uploadErr.message : String(uploadErr),
      })
    } else {
      showToast({ title: language.t("fileTree.upload.success") })
    }
  }

  const handleUploadDragOver = (e: DragEvent) => {
    if (!e.dataTransfer?.types?.includes("Files")) return
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"
  }

  const confirmDelete = (node: FileNode) => {
    const isDir = node.type === "directory"
    const msg = isDir
      ? language.t("fileTree.delete.confirmFolder", { name: node.name })
      : language.t("fileTree.delete.confirmFile", { name: node.name })
    if (!window.confirm(msg)) return
    void file.remove(node.path).then(() => {
      showToast({ variant: "success", title: language.t("fileTree.toast.deleteSuccess") })
    }).catch((err: unknown) => {
      showToast({
        variant: "error",
        title: language.t("fileTree.toast.deleteFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    })
  }

  const confirmDeleteMany = (nodes: { path: string }[]) => {
    const msg = language.t("fileTree.delete.confirmMany", { count: nodes.length })
    if (!window.confirm(msg)) return
    void Promise.all(
      nodes.map((node) =>
        file.remove(node.path).catch((err: unknown) => {
          showToast({
            variant: "error",
            title: language.t("fileTree.toast.deleteFailed"),
            description: err instanceof Error ? err.message : String(err),
          })
        }),
      ),
    ).then(() => {
      showToast({ variant: "success", title: language.t("fileTree.toast.deleteSuccess") })
    })
  }

  const [clip, setClip] = createSignal<FileTreeClip | null>(null)
  const treeClip: FileTreeClipState = { value: clip, set: (next) => setClip(next) }
  const treeKey = (p: string) =>
    file
      .normalize(p)
      .replace(/[\\/]+$/, "")
      .replaceAll("\\", "/")

  const fileTreeOps: FileTreeOps = {
    onRename: async (node, next) => {
      await file.rename(node.path, next).catch((err: unknown) => {
        showToast({
          variant: "error",
          title: language.t("fileTree.toast.renameFailed"),
          description: err instanceof Error ? err.message : String(err),
        })
      })
    },
    onDelete: confirmDelete,
    onDeleteMany: confirmDeleteMany,
    onNewFile: async (dir, name) => {
      const target = dir ? `${dir}/${name}` : name
      await file.write(target, "").catch((err: unknown) => {
        showToast({
          variant: "error",
          title: language.t("fileTree.toast.writeFailed"),
          description: err instanceof Error ? err.message : String(err),
        })
      })
    },
    onNewFolder: async (dir, name) => {
      const target = dir ? `${dir}/${name}` : name
      await file.mkdir(target).catch((err: unknown) => {
        showToast({
          variant: "error",
          title: language.t("fileTree.toast.mkdirFailed"),
          description: err instanceof Error ? err.message : String(err),
        })
      })
    },
    onMove: async (src, dst) => {
      await file.rename(src, dst).catch((err: unknown) => {
        showToast({
          variant: "error",
          title: language.t("fileTree.toast.renameFailed"),
          description: err instanceof Error ? err.message : String(err),
        })
      })
    },
    onDownload: async (node) => {
      await file.download(node.path).catch((err: unknown) => {
        showToast({
          variant: "error",
          title: language.t("fileTree.toast.downloadFailed"),
          description: err instanceof Error ? err.message : String(err),
        })
      })
    },
    onCopy: async (src, dst) => {
      await file
        .copy(src, dst)
        .then(() => {
          showToast({ title: language.t("fileTree.toast.copySuccess") })
        })
        .catch((err: unknown) => {
          showToast({
            variant: "error",
            title: language.t("fileTree.toast.copyFailed"),
            description: err instanceof Error ? err.message : String(err),
          })
        })
    },
    onPreview: (node) => {
      window.open(file.serveUrl(node.path), "_blank")
    },
    onShare: async (node) => {
      try {
        const url = await file.share(node.path)
        await navigator.clipboard.writeText(url)
        showToast({ title: language.t("fileTree.toast.shareSuccess") })
      } catch (err) {
        showToast({
          variant: "error",
          title: language.t("fileTree.toast.shareFailed"),
          description: err instanceof Error ? err.message : String(err),
        })
      }
    },
    onUpload: async (dir, items) => {
      const entries: FileSystemEntry[] = []
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.()
        if (entry) entries.push(entry)
      }
      if (entries.length === 0) return
      showToast({ title: language.t("fileTree.upload.start") })
      setUploading(true)
      const tid = showToast({ variant: "loading", title: language.t("fileTree.upload.progress"), persistent: true })
      const all: { path: string; content: string; encoding: "base64" }[] = []
      for (const entry of entries) {
        const sub = await readEntry(entry, dir)
        all.push(...sub)
      }
      let uploadErr: unknown
      await file.upload(all).catch((err: unknown) => { uploadErr = err })
      toaster.dismiss(tid)
      setUploading(false)
      if (uploadErr) {
        showToast({
          variant: "error",
          title: language.t("fileTree.upload.error"),
          description: uploadErr instanceof Error ? uploadErr.message : String(uploadErr),
        })
      } else {
        showToast({ title: language.t("fileTree.upload.success") })
      }
    },
  }

  const pasteRoot = () => {
    const board = typeof navigator === "undefined" ? undefined : navigator.clipboard
    if (!board?.readText) {
      showToast({ variant: "error", title: language.t("fileTree.toast.pasteFailed") })
      return
    }
    void board
      .readText()
      .then((text) => {
        const raw = clipboardPath(text)
        if (!raw) throw new Error(language.t("fileTree.toast.clipboardEmpty"))
        const src = treeKey(raw)
        const current = clip()
        const op = current?.path === src ? current.op : "copy"
        if (current && current.path !== src) setClip(null)
        if (pasteBlocked({ op, src, dir: "" })) throw new Error(language.t("fileTree.toast.pasteBlocked"))
        const dst = pasteTarget({ src, dir: "" })
        if (op === "cut" && src === dst) {
          setClip(null)
          return
        }
        const fn = op === "cut" ? fileTreeOps.onMove : fileTreeOps.onCopy
        if (!fn) throw new Error(language.t("fileTree.toast.pasteUnavailable"))
        return Promise.resolve(fn(src, dst)).then(() => {
          if (op === "cut") setClip(null)
        })
      })
      .catch((err: unknown) => {
        showToast({
          variant: "error",
          title: language.t("fileTree.toast.pasteFailed"),
          description: err instanceof Error ? err.message : String(err),
        })
      })
  }

  createEffect(() => {
    if (!file.ready()) return

    setSessionHandoff(sessionKey(), {
      files: tabs()
        .all()
        .reduce<Record<string, SelectedLineRange | null>>((acc, tab) => {
          const path = file.pathFromTab(tab)
          if (!path) return acc

          const selected = file.selectedLines(path)
          acc[path] =
            selected && typeof selected === "object" && "start" in selected && "end" in selected
              ? (selected as SelectedLineRange)
              : null

          return acc
        }, {}),
    })
  })

  return (
    <Show when={isDesktop()}>
      <aside
        id="review-panel"
        aria-label={language.t("session.panel.reviewAndFiles")}
        aria-hidden={!open()}
        inert={!open()}
        class="relative min-w-0 h-full flex shrink-0 overflow-hidden bg-background-base"
        classList={{
          "pointer-events-none": !open(),
          "transition-[width] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
            !props.size.active() && !props.reviewSnap,
        }}
        style={{ width: panelWidth() }}
      >
        <div class="size-full flex border-l border-border-weaker-base">
          <div
            aria-hidden={!reviewOpen()}
            inert={!reviewOpen()}
            class="relative min-w-0 h-full flex-1 overflow-hidden bg-background-base"
            classList={{
              "pointer-events-none": !reviewOpen(),
            }}
          >
            <div class="size-full min-w-0 h-full bg-background-base">
              <DragDropProvider
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragOver={handleDragOver}
                collisionDetector={closestCenter}
              >
                <DragDropSensors />
                <ConstrainDragYAxis />
                <Tabs value={activeTab()} onChange={openTab}>
                  <div class="sticky top-0 shrink-0 flex">
                    <Tabs.List
                      ref={(el: HTMLDivElement) => {
                        const stop = createFileTabListSync({ el, contextOpen })
                        onCleanup(stop)
                      }}
                    >
                      <Show when={reviewTab()}>
                        <Tabs.Trigger value="review">
                          <div class="flex items-center gap-1.5">
                            <div>{language.t("session.tab.review")}</div>
                            <Show when={hasReview()}>
                              <div>{reviewCount()}</div>
                            </Show>
                          </div>
                        </Tabs.Trigger>
                      </Show>
                      <Show when={contextOpen()}>
                        <Tabs.Trigger
                          value="context"
                          closeButton={
                            <TooltipKeybind
                              title={language.t("common.closeTab")}
                              keybind={command.keybind("tab.close")}
                              placement="bottom"
                              gutter={10}
                            >
                              <IconButton
                                icon="close-small"
                                variant="ghost"
                                class="h-5 w-5"
                                onClick={() => tabs().close("context")}
                                aria-label={language.t("common.closeTab")}
                              />
                            </TooltipKeybind>
                          }
                          hideCloseButton
                          onMiddleClick={() => tabs().close("context")}
                        >
                          <div class="flex items-center gap-2">
                            <SessionContextUsage variant="indicator" />
                            <div>{language.t("session.tab.context")}</div>
                          </div>
                        </Tabs.Trigger>
                      </Show>
                      <SortableProvider ids={openedTabs()}>
                        <For each={openedTabs()}>
                          {(tab) => (
                            <SortableTab
                              tab={tab}
                              onTabClose={tabs().close}
                              menu={{
                                many: () => openedTabs().length > 1,
                                onCloseAll: (tab) => closeTabs("all", tab),
                                onCloseOthers: (tab) => closeTabs("others", tab),
                              }}
                            />
                          )}
                        </For>
                      </SortableProvider>
                      <div class="bg-background-stronger h-full shrink-0 sticky right-0 z-10 flex items-center justify-center pr-3">
                        <TooltipKeybind
                          title={language.t("command.file.open")}
                          keybind={command.keybind("file.open")}
                          class="flex items-center"
                        >
                          <IconButton
                            icon="plus-small"
                            variant="ghost"
                            iconSize="large"
                            class="!rounded-md"
                            onClick={() => {
                              void import("@/components/dialog-select-file").then((x) => {
                                dialog.show(() => <x.DialogSelectFile mode="files" onOpenFile={showAllFiles} />)
                              })
                            }}
                            aria-label={language.t("command.file.open")}
                          />
                        </TooltipKeybind>
                      </div>
                    </Tabs.List>
                  </div>

                  <Show when={reviewTab()}>
                    <Tabs.Content value="review" class="flex flex-col h-full overflow-hidden contain-strict">
                      <Show when={activeTab() === "review"}>{props.reviewPanel()}</Show>
                    </Tabs.Content>
                  </Show>

                  <Tabs.Content value="empty" class="flex flex-col h-full overflow-hidden contain-strict">
                    <Show when={activeTab() === "empty"}>
                      <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
                        <div class="h-full px-6 pb-42 -mt-4 flex flex-col items-center justify-center text-center gap-6">
                          <Mark class="w-14 opacity-10" />
                          <div class="text-14-regular text-text-weak max-w-56">
                            {language.t("session.files.selectToOpen")}
                          </div>
                        </div>
                      </div>
                    </Show>
                  </Tabs.Content>

                  <Show when={contextOpen()}>
                    <Tabs.Content value="context" class="flex flex-col h-full overflow-hidden contain-strict">
                      <Show when={activeTab() === "context"}>
                        <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
                          <SessionContextTab />
                        </div>
                      </Show>
                    </Tabs.Content>
                  </Show>

                  <Show when={activeFileTab()} keyed>
                    {(tab) => <FileTabContent tab={tab} />}
                  </Show>
                </Tabs>
                <DragOverlay>
                  <Show when={store.activeDraggable} keyed>
                    {(tab) => {
                      const path = file.pathFromTab(tab)
                      return (
                        <div data-component="tabs-drag-preview">
                          <Show when={path}>{(p) => <FileVisual active path={p()} />}</Show>
                        </div>
                      )
                    }}
                  </Show>
                </DragOverlay>
              </DragDropProvider>
            </div>
          </div>

          <div
            id="file-tree-panel"
            aria-hidden={!fileOpen()}
            inert={!fileOpen()}
            class="relative min-w-0 h-full shrink-0 overflow-hidden"
            classList={{
              "pointer-events-none": !fileOpen(),
              "transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
                !props.size.active(),
            }}
            style={{ width: treeWidth() }}
          >
            <div
              class="h-full flex flex-col overflow-hidden group/filetree"
              classList={{ "border-l border-border-weaker-base": reviewOpen() }}
            >
              <div class="h-full min-h-0 flex flex-col bg-background-stronger">
                <div class="h-12 shrink-0 px-3 flex items-center justify-between border-b border-border-weak-base">
                  <div class="min-w-0 text-12-medium text-text-strong truncate">
                    {language.t("session.files.all")}
                  </div>
                  <div class="shrink-0 flex items-center gap-1">
                    <TreeAction
                      icon="file-plus"
                      label={language.t("fileTree.toolbar.newFile")}
                      onClick={() => setRootCreate("file")}
                    />
                    <TreeAction
                      icon="folder-add-left"
                      label={language.t("fileTree.toolbar.newFolder")}
                      onClick={() => setRootCreate("folder")}
                    />
                    <TreeAction
                      icon="refresh"
                      label={language.t("fileTree.toolbar.refresh")}
                      onClick={() => file.tree.refresh("")}
                    />
                    <TreeAction
                      icon="collapse-all"
                      label={language.t("ui.sessionReview.collapseAll")}
                      onClick={() =>
                        expandedDirs({
                          children: file.tree.children,
                          expanded: (dir) => file.tree.state(dir)?.expanded ?? false,
                        }).forEach((dir) => file.tree.collapse(dir))
                      }
                    />
                  </div>
                </div>
                <div
                  class="flex-1 min-h-0 overflow-y-auto bg-background-stronger px-0 py-0"
                  onDragOver={handleUploadDragOver}
                  onDrop={handleUploadDrop}
                >
                  <ContextMenu>
                    <ContextMenu.Trigger class="flex flex-col w-full h-full px-3 py-0">
                      <Show when={rootCreate()} keyed>
                        {(type) => (
                          <RootInput
                            placeholder={
                              type === "file"
                                ? language.t("fileTree.toolbar.newFilePlaceholder")
                                : language.t("fileTree.toolbar.newFolderPlaceholder")
                            }
                            onConfirm={(name) => {
                              setRootCreate(null)
                              if (!name) return
                              if (type === "file") void fileTreeOps.onNewFile?.("", name)
                              else void fileTreeOps.onNewFolder?.("", name)
                            }}
                            onCancel={() => setRootCreate(null)}
                          />
                        )}
                      </Show>
                      <Show when={uploading()}>
                        <div class="py-2 text-center text-12-regular text-text-weak">
                          {language.t("fileTree.upload.progress")}
                        </div>
                      </Show>
                      <Switch>
                        <Match when={nofiles()}>{empty(language.t("session.files.empty"))}</Match>
                        <Match when={true}>
                          <FileTree
                            path=""
                            class="pt-3"
                            modified={diffFiles()}
                            kinds={kinds()}
                            active={path()}
                            onFileClick={(node) => openTab(file.tab(node.path))}
                            ops={fileTreeOps}
                            clip={treeClip}
                          />
                        </Match>
                      </Switch>
                    </ContextMenu.Trigger>
                    <ContextMenu.Portal>
                      <ContextMenu.Content>
                        <ContextMenu.Item onSelect={() => setRootCreate("file")}>
                          <Icon name="plus-small" />
                          <ContextMenu.ItemLabel>{language.t("fileTree.toolbar.newFile")}</ContextMenu.ItemLabel>
                        </ContextMenu.Item>
                        <ContextMenu.Item onSelect={() => setRootCreate("folder")}>
                          <Icon name="folder-add-left" />
                          <ContextMenu.ItemLabel>{language.t("fileTree.toolbar.newFolder")}</ContextMenu.ItemLabel>
                        </ContextMenu.Item>
                        <ContextMenu.Item onSelect={pasteRoot}>
                          <Icon name="arrow-down-to-line" />
                          <ContextMenu.ItemLabel>{language.t("fileTree.menu.paste")}</ContextMenu.ItemLabel>
                        </ContextMenu.Item>
                        <ContextMenu.Separator />
                        <ContextMenu.Item onSelect={() => file.tree.refresh("")}>
                          <Icon name="refresh" />
                          <ContextMenu.ItemLabel>{language.t("fileTree.toolbar.refresh")}</ContextMenu.ItemLabel>
                        </ContextMenu.Item>
                      </ContextMenu.Content>
                    </ContextMenu.Portal>
                  </ContextMenu>
                </div>
              </div>
            </div>
            <Show when={fileOpen()}>
              <div onPointerDown={() => props.size.start()}>
                <ResizeHandle
                  direction="horizontal"
                  edge="start"
                  size={layout.fileTree.width()}
                  min={200}
                  max={480}
                  onResize={(width) => {
                    props.size.touch()
                    layout.fileTree.resize(width)
                  }}
                />
              </div>
            </Show>
          </div>
        </div>
      </aside>
    </Show>
  )
}
