import { useFile } from "@/context/file"
import { encodeFilePath } from "@/context/file/path"
import { useLanguage } from "@/context/language"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { ContextMenu } from "@opencode-ai/ui/context-menu"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  Show,
  splitProps,
  Switch,
  untrack,
  type ComponentProps,
  type ParentProps,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import type { FileNode } from "@opencode-ai/sdk/v2"

const MAX_DEPTH = 128

function pathToFileUrl(filepath: string): string {
  return `file://${encodeFilePath(filepath)}`
}

type Kind = "add" | "del" | "mix"

type Filter = {
  files: Set<string>
  dirs: Set<string>
}

export function shouldListRoot(input: { level: number; dir?: { loaded?: boolean; loading?: boolean } }) {
  if (input.level !== 0) return false
  if (input.dir?.loaded) return false
  if (input.dir?.loading) return false
  return true
}

export function shouldListExpanded(input: {
  level: number
  dir?: { expanded?: boolean; loaded?: boolean; loading?: boolean }
}) {
  if (input.level === 0) return false
  if (!input.dir?.expanded) return false
  if (input.dir.loaded) return false
  if (input.dir.loading) return false
  return true
}

export function dirsToExpand(input: {
  level: number
  filter?: { dirs: Set<string> }
  expanded: (dir: string) => boolean
}) {
  if (input.level !== 0) return []
  if (!input.filter) return []
  return [...input.filter.dirs].filter((dir) => !input.expanded(dir))
}

const kindLabel = (kind: Kind) => {
  if (kind === "add") return "A"
  if (kind === "del") return "D"
  return "M"
}

const kindTextColor = (kind: Kind) => {
  if (kind === "add") return "color: var(--icon-diff-add-base)"
  if (kind === "del") return "color: var(--icon-diff-delete-base)"
  return "color: var(--icon-diff-modified-base)"
}

const kindDotColor = (kind: Kind) => {
  if (kind === "add") return "background-color: var(--icon-diff-add-base)"
  if (kind === "del") return "background-color: var(--icon-diff-delete-base)"
  return "background-color: var(--icon-diff-modified-base)"
}

const visibleKind = (node: FileNode, kinds?: ReadonlyMap<string, Kind>, marks?: Set<string>) => {
  const kind = kinds?.get(node.path)
  if (!kind) return
  if (!marks?.has(node.path)) return
  return kind
}

const buildDragImage = (target: HTMLElement) => {
  const icon = target.querySelector('[data-component="file-icon"]') ?? target.querySelector("svg")
  const text = target.querySelector("span")
  if (!icon || !text) return

  const image = document.createElement("div")
  image.className =
    "flex items-center gap-x-2 px-2 py-1 bg-surface-raised-base rounded-md border border-border-base text-12-regular text-text-strong"
  image.style.position = "absolute"
  image.style.top = "-1000px"
  image.innerHTML = (icon as SVGElement).outerHTML + (text as HTMLSpanElement).outerHTML
  return image
}

const withFileDragImage = (event: DragEvent) => {
  const image = buildDragImage(event.currentTarget as HTMLElement)
  if (!image) return
  document.body.appendChild(image)
  event.dataTransfer?.setDragImage(image, 0, 12)
  setTimeout(() => document.body.removeChild(image), 0)
}

const isHtml = (name: string) => /\.html?$/i.test(name)

function InlineInput(props: {
  level: number
  initial?: string
  onConfirm: (value: string) => void
  onCancel: () => void
}) {
  let ref: HTMLInputElement | undefined
  const [val, setVal] = createSignal(props.initial ?? "")
  let done = false

  const confirm = () => {
    if (done) return
    const v = val().trim()
    if (!v || v === props.initial) {
      done = true
      props.onCancel()
      return
    }
    done = true
    props.onConfirm(v)
  }

  createEffect(() => {
    ref?.focus()
    if (props.initial) ref?.select()
  })

  return (
    <input
      ref={ref}
      class="w-full h-6 bg-surface-raised-base border border-border-base rounded-md px-1.5 text-12-medium text-text-strong outline-none focus:ring-1 focus:ring-border-focus"
      style={`margin-left: ${Math.max(0, 8 + props.level * 12)}px`}
      value={val()}
      onInput={(e) => setVal(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") confirm()
        if (e.key === "Escape") props.onCancel()
      }}
      onBlur={confirm}
    />
  )
}

const FileTreeNode = (
  p: ParentProps &
    ComponentProps<"div"> &
    ComponentProps<"button"> & {
      node: FileNode
      level: number
      active?: string
      nodeClass?: string
      draggable: boolean
      kinds?: ReadonlyMap<string, Kind>
      marks?: Set<string>
      as?: "div" | "button"
      dropTarget?: boolean
    },
) => {
  const [local, rest] = splitProps(p, [
    "node",
    "level",
    "active",
    "nodeClass",
    "draggable",
    "kinds",
    "marks",
    "as",
    "children",
    "class",
    "classList",
    "dropTarget",
  ])
  const kind = () => visibleKind(local.node, local.kinds, local.marks)
  const active = () => !!kind() && !local.node.ignored
  const color = () => {
    const value = kind()
    if (!value) return
    return kindTextColor(value)
  }

  return (
    <Dynamic
      component={local.as ?? "div"}
      classList={{
        "w-full min-w-0 h-6 flex items-center justify-start gap-x-1.5 rounded-md px-1.5 py-0 text-left hover:bg-surface-raised-base-hover active:bg-surface-base-active transition-colors cursor-pointer": true,
        "bg-surface-base-active": local.node.path === local.active,
        "ring-1 ring-border-focus": !!local.dropTarget,
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
        [local.nodeClass ?? ""]: !!local.nodeClass,
      }}
      style={`padding-left: ${Math.max(0, 8 + local.level * 12 - (local.node.type === "file" ? 24 : 4))}px`}
      draggable={local.draggable}
      onDragStart={(event: DragEvent) => {
        if (!local.draggable) return
        event.dataTransfer?.setData("text/plain", `file:${local.node.path}`)
        event.dataTransfer?.setData("text/uri-list", pathToFileUrl(local.node.path))
        event.dataTransfer?.setData("application/x-filetree-move", "1")
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "copyMove"
        withFileDragImage(event)
      }}
      {...rest}
    >
      {local.children}
      <span
        classList={{
          "flex-1 min-w-0 text-12-medium whitespace-nowrap truncate": true,
          "text-text-weaker": local.node.ignored,
          "text-text-weak": !local.node.ignored && !active(),
        }}
        style={active() ? color() : undefined}
      >
        {local.node.name}
      </span>
      {(() => {
        const value = kind()
        if (!value) return null
        if (local.node.type === "file") {
          return (
            <span class="shrink-0 w-4 text-center text-12-medium" style={kindTextColor(value)}>
              {kindLabel(value)}
            </span>
          )
        }
        return <div class="shrink-0 size-1.5 mr-1.5 rounded-full" style={kindDotColor(value)} />
      })()}
    </Dynamic>
  )
}

export type FileTreeOps = {
  onRename?: (node: FileNode, name: string) => void
  onDelete?: (node: FileNode) => void
  onDeleteMany?: (nodes: { path: string }[]) => void
  onNewFile?: (dir: string, name: string) => void
  onNewFolder?: (dir: string, name: string) => void
  onMove?: (src: string, dst: string) => void
  onDownload?: (node: FileNode) => void
  onPreview?: (node: FileNode) => void
  onUpload?: (dir: string, items: DataTransferItemList) => void
}

export default function FileTree(props: {
  path: string
  class?: string
  nodeClass?: string
  active?: string
  level?: number
  allowed?: readonly string[]
  modified?: readonly string[]
  kinds?: ReadonlyMap<string, Kind>
  draggable?: boolean
  onFileClick?: (file: FileNode) => void
  ops?: FileTreeOps

  _filter?: Filter
  _marks?: Set<string>
  _deeps?: Map<string, number>
  _kinds?: ReadonlyMap<string, Kind>
  _chain?: readonly string[]
}) {
  const file = useFile()
  const language = useLanguage()
  const level = props.level ?? 0
  const draggable = () => props.draggable ?? true

  const key = (p: string) =>
    file
      .normalize(p)
      .replace(/[\\/]+$/, "")
      .replaceAll("\\", "/")
  const chain = props._chain ? [...props._chain, key(props.path)] : [key(props.path)]

  const [editing, setEditing] = createSignal<{ path: string; type: "rename" | "newFile" | "newFolder" } | null>(null)
  const [dropTarget, setDropTarget] = createSignal<string | null>(null)

  const filter = createMemo(() => {
    if (props._filter) return props._filter

    const allowed = props.allowed
    if (!allowed) return

    const files = new Set(allowed)
    const dirs = new Set<string>()

    for (const item of allowed) {
      const parts = item.split("/")
      const parents = parts.slice(0, -1)
      for (const [idx] of parents.entries()) {
        const dir = parents.slice(0, idx + 1).join("/")
        if (dir) dirs.add(dir)
      }
    }

    return { files, dirs }
  })

  const marks = createMemo(() => {
    if (props._marks) return props._marks

    const out = new Set<string>()
    for (const item of props.modified ?? []) out.add(item)
    for (const item of props.kinds?.keys() ?? []) out.add(item)
    if (out.size === 0) return
    return out
  })

  const kinds = createMemo(() => {
    if (props._kinds) return props._kinds
    return props.kinds
  })

  const deeps = createMemo(() => {
    if (props._deeps) return props._deeps

    const out = new Map<string, number>()

    const root = props.path
    if (!(file.tree.state(root)?.expanded ?? false)) return out

    const seen = new Set<string>()
    const stack: { dir: string; lvl: number; i: number; kids: string[]; max: number }[] = []

    const push = (dir: string, lvl: number) => {
      const id = key(dir)
      if (seen.has(id)) return
      seen.add(id)

      const kids = file.tree
        .children(dir)
        .filter((node) => node.type === "directory" && (file.tree.state(node.path)?.expanded ?? false))
        .map((node) => node.path)

      stack.push({ dir, lvl, i: 0, kids, max: lvl })
    }

    push(root, level - 1)

    while (stack.length > 0) {
      const top = stack[stack.length - 1]!

      if (top.i < top.kids.length) {
        const next = top.kids[top.i]!
        top.i++
        push(next, top.lvl + 1)
        continue
      }

      out.set(top.dir, top.max)
      stack.pop()

      const parent = stack[stack.length - 1]
      if (!parent) continue
      parent.max = Math.max(parent.max, top.max)
    }

    return out
  })

  createEffect(() => {
    const current = filter()
    const dirs = dirsToExpand({
      level,
      filter: current,
      expanded: (dir) => untrack(() => file.tree.state(dir)?.expanded) ?? false,
    })
    for (const dir of dirs) file.tree.expand(dir)
  })

  createEffect(
    on(
      () => props.path,
      (path) => {
        const dir = untrack(() => file.tree.state(path))
        if (!shouldListRoot({ level, dir })) return
        void file.tree.list(path)
      },
      { defer: false },
    ),
  )

  const nodes = createMemo(() => {
    const raw = file.tree.children(props.path)
    const nodes = level === 0 ? raw.filter((n) => !(n.type === "file" && n.name === "opencode.json")) : raw
    const current = filter()
    if (!current) return nodes

    const parent = (path: string) => {
      const idx = path.lastIndexOf("/")
      if (idx === -1) return ""
      return path.slice(0, idx)
    }

    const leaf = (path: string) => {
      const idx = path.lastIndexOf("/")
      return idx === -1 ? path : path.slice(idx + 1)
    }

    const out = nodes.filter((node) => {
      if (node.type === "file") return current.files.has(node.path)
      return current.dirs.has(node.path)
    })

    const seen = new Set(out.map((node) => node.path))

    for (const dir of current.dirs) {
      if (parent(dir) !== props.path) continue
      if (seen.has(dir)) continue
      out.push({
        name: leaf(dir),
        path: dir,
        absolute: dir,
        type: "directory",
        ignored: false,
      })
      seen.add(dir)
    }

    for (const item of current.files) {
      if (parent(item) !== props.path) continue
      if (seen.has(item)) continue
      out.push({
        name: leaf(item),
        path: item,
        absolute: item,
        type: "file",
        ignored: false,
      })
      seen.add(item)
    }

    out.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })

    return out
  })

  const handleDirDragOver = (dirPath: string, e: DragEvent) => {
    const types = e.dataTransfer?.types
    const isTree = types?.includes("text/plain")
    const isOs = types?.includes("Files")
    if (!isTree && !isOs) return
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer) e.dataTransfer.dropEffect = isOs ? "copy" : "move"
    setDropTarget(dirPath)
  }

  const handleDirDragLeave = (dirPath: string) => {
    if (dropTarget() === dirPath) setDropTarget(null)
  }

  const handleDirDrop = (dirPath: string, e: DragEvent) => {
    setDropTarget(null)
    const raw = e.dataTransfer?.getData("text/plain")
    if (raw?.startsWith("file:")) {
      e.preventDefault()
      e.stopPropagation()
      const src = raw.slice(5)
      if (src === dirPath) return
      if (dirPath.startsWith(src + "/")) return
      const name = src.split("/").pop()
      if (!name) return
      const dst = dirPath ? `${dirPath}/${name}` : name
      if (src === dst) return
      props.ops?.onMove?.(src, dst)
      return
    }
    const items = e.dataTransfer?.items
    if (!items || !Array.from(items).some((i) => i.kind === "file")) return
    e.preventDefault()
    e.stopPropagation()
    props.ops?.onUpload?.(dirPath, items)
  }

  const fileMenu = (node: FileNode) => (
    <>
      <ContextMenu.Item onSelect={() => props.onFileClick?.(node)}>
        <Icon name="open-file" />
        <ContextMenu.ItemLabel>{language.t("fileTree.menu.open")}</ContextMenu.ItemLabel>
      </ContextMenu.Item>
      <ContextMenu.Item onSelect={() => props.ops?.onDownload?.(node)}>
        <Icon name="download" />
        <ContextMenu.ItemLabel>{language.t("fileTree.menu.download")}</ContextMenu.ItemLabel>
      </ContextMenu.Item>
      <ContextMenu.Item onSelect={() => setEditing({ path: node.path, type: "rename" })}>
        <Icon name="pencil-line" />
        <ContextMenu.ItemLabel>{language.t("fileTree.menu.rename")}</ContextMenu.ItemLabel>
      </ContextMenu.Item>
      <ContextMenu.Item onSelect={() => props.ops?.onDelete?.(node)}>
        <Icon name="trash" />
        <ContextMenu.ItemLabel>{language.t("fileTree.menu.delete")}</ContextMenu.ItemLabel>
      </ContextMenu.Item>
      <Show when={isHtml(node.name)}>
        <ContextMenu.Separator />
        <ContextMenu.Item onSelect={() => props.ops?.onPreview?.(node)}>
          <Icon name="eye" />
          <ContextMenu.ItemLabel>{language.t("fileTree.menu.preview")}</ContextMenu.ItemLabel>
        </ContextMenu.Item>
      </Show>
    </>
  )

  const dirMenu = (node: FileNode) => (
    <>
      <ContextMenu.Item onSelect={() => props.ops?.onDownload?.(node)}>
        <Icon name="download" />
        <ContextMenu.ItemLabel>{language.t("fileTree.menu.download")}</ContextMenu.ItemLabel>
      </ContextMenu.Item>
      <ContextMenu.Separator />
      <ContextMenu.Item onSelect={() => setEditing({ path: node.path, type: "newFile" })}>
        <Icon name="plus-small" />
        <ContextMenu.ItemLabel>{language.t("fileTree.menu.newFile")}</ContextMenu.ItemLabel>
      </ContextMenu.Item>
      <ContextMenu.Item onSelect={() => setEditing({ path: node.path, type: "newFolder" })}>
        <Icon name="folder-add-left" />
        <ContextMenu.ItemLabel>{language.t("fileTree.menu.newFolder")}</ContextMenu.ItemLabel>
      </ContextMenu.Item>
      <ContextMenu.Separator />
      <ContextMenu.Item onSelect={() => setEditing({ path: node.path, type: "rename" })}>
        <Icon name="pencil-line" />
        <ContextMenu.ItemLabel>{language.t("fileTree.menu.rename")}</ContextMenu.ItemLabel>
      </ContextMenu.Item>
      <ContextMenu.Item onSelect={() => props.ops?.onDelete?.(node)}>
        <Icon name="trash" />
        <ContextMenu.ItemLabel>{language.t("fileTree.menu.deleteFolder")}</ContextMenu.ItemLabel>
      </ContextMenu.Item>
    </>
  )

  const handleRename = (node: FileNode, name: string) => {
    setEditing(null)
    if (name === node.name) return
    const parent = node.path.lastIndexOf("/") === -1 ? "" : node.path.slice(0, node.path.lastIndexOf("/"))
    const next = parent ? `${parent}/${name}` : name
    props.ops?.onRename?.(node, next)
  }

  const handleNew = (dir: string, type: "newFile" | "newFolder", name: string) => {
    setEditing(null)
    if (type === "newFile") props.ops?.onNewFile?.(dir, name)
    else props.ops?.onNewFolder?.(dir, name)
  }

  const hasOps = () => !!props.ops

  const renderNode = (node: FileNode) => {
    const expanded = () => file.tree.state(node.path)?.expanded ?? false
    const deep = () => deeps().get(node.path) ?? -1
    const ed = () => editing()
    const isRenaming = () => ed()?.path === node.path && ed()?.type === "rename"
    const isNewInDir = () => ed()?.path === node.path && (ed()?.type === "newFile" || ed()?.type === "newFolder")

    return (
      <Switch>
        <Match when={node.type === "directory"}>
          <Show when={hasOps()} fallback={renderDirNoMenu(node, expanded, deep)}>
            <ContextMenu>
              <ContextMenu.Trigger class="w-full">
                {renderDirCore(node, expanded, deep, isRenaming, isNewInDir)}
              </ContextMenu.Trigger>
              <ContextMenu.Portal>
                <ContextMenu.Content class="context-menu-content">{dirMenu(node)}</ContextMenu.Content>
              </ContextMenu.Portal>
            </ContextMenu>
          </Show>
        </Match>
        <Match when={node.type === "file"}>
          <Show when={hasOps()} fallback={renderFileNoMenu(node)}>
            <Show when={!isRenaming()} fallback={<InlineInput level={level} initial={node.name} onConfirm={(v) => handleRename(node, v)} onCancel={() => setEditing(null)} />}>
              <ContextMenu>
                <ContextMenu.Trigger class="w-full">
                  {renderFileCore(node)}
                </ContextMenu.Trigger>
                <ContextMenu.Portal>
                  <ContextMenu.Content class="context-menu-content">{fileMenu(node)}</ContextMenu.Content>
                </ContextMenu.Portal>
              </ContextMenu>
            </Show>
          </Show>
        </Match>
      </Switch>
    )
  }

  const renderFileIcon = (node: FileNode) => {
    const kind = () => visibleKind(node, kinds(), marks())
    const active = () => !!kind() && !node.ignored

    return (
      <Switch>
        <Match when={node.ignored}>
          <FileIcon node={node} class="size-4 filetree-icon filetree-icon--mono" style="color: var(--icon-weak-base)" mono />
        </Match>
        <Match when={active()}>
          <FileIcon node={node} class="size-4 filetree-icon filetree-icon--mono" style={kindTextColor(kind()!)} mono />
        </Match>
        <Match when={!node.ignored}>
          <span class="filetree-iconpair size-4">
            <FileIcon node={node} class="size-4 filetree-icon filetree-icon--color opacity-0 group-hover/filetree:opacity-100" />
            <FileIcon node={node} class="size-4 filetree-icon filetree-icon--mono group-hover/filetree:opacity-0" mono />
          </span>
        </Match>
      </Switch>
    )
  }

  const renderFileCore = (node: FileNode) => (
    <FileTreeNode
      node={node}
      level={level}
      active={props.active}
      nodeClass={props.nodeClass}
      draggable={draggable()}
      kinds={kinds()}
      marks={marks()}
      as="button"
      type="button"
      onClick={() => props.onFileClick?.(node)}
    >
      <div class="w-4 shrink-0" />
      {renderFileIcon(node)}
    </FileTreeNode>
  )

  const renderFileNoMenu = (node: FileNode) => renderFileCore(node)

  const renderDirCore = (
    node: FileNode,
    expanded: () => boolean,
    deep: () => number,
    isRenaming: () => boolean,
    isNewInDir: () => boolean,
  ) => (
    <Collapsible
      variant="ghost"
      class="w-full"
      data-scope="filetree"
      forceMount={false}
      open={expanded()}
      onOpenChange={(open) => (open ? file.tree.expand(node.path) : file.tree.collapse(node.path))}
    >
      <Collapsible.Trigger>
        <Show
          when={!isRenaming()}
          fallback={<InlineInput level={level} initial={node.name} onConfirm={(v) => handleRename(node, v)} onCancel={() => setEditing(null)} />}
        >
          <FileTreeNode
            node={node}
            level={level}
            active={props.active}
            nodeClass={props.nodeClass}
            draggable={draggable()}
            kinds={kinds()}
            marks={marks()}
            dropTarget={dropTarget() === node.path}
            onDragOver={(e: DragEvent) => handleDirDragOver(node.path, e)}
            onDragLeave={() => handleDirDragLeave(node.path)}
            onDrop={(e: DragEvent) => handleDirDrop(node.path, e)}
          >
            <div class="size-4 flex items-center justify-center text-icon-weak">
              <Icon name={expanded() ? "chevron-down" : "chevron-right"} size="small" />
            </div>
          </FileTreeNode>
        </Show>
      </Collapsible.Trigger>
      <Collapsible.Content class="relative pt-0.5">
        <div
          classList={{
            "absolute top-0 bottom-0 w-px pointer-events-none bg-border-weak-base opacity-0 transition-opacity duration-150 ease-out motion-reduce:transition-none": true,
            "group-hover/filetree:opacity-100": expanded() && deep() === level,
            "group-hover/filetree:opacity-50": !(expanded() && deep() === level),
          }}
          style={`left: ${Math.max(0, 8 + level * 12 - 4) + 8}px`}
        />
        <Show when={isNewInDir()}>
          <InlineInput
            level={level + 1}
            onConfirm={(v) => handleNew(node.path, editing()!.type as "newFile" | "newFolder", v)}
            onCancel={() => setEditing(null)}
          />
        </Show>
        <Show
          when={level < MAX_DEPTH && !chain.includes(key(node.path))}
          fallback={<div class="px-2 py-1 text-12-regular text-text-weak">...</div>}
        >
          <FileTree
            path={node.path}
            level={level + 1}
            allowed={props.allowed}
            modified={props.modified}
            kinds={props.kinds}
            active={props.active}
            draggable={props.draggable}
            onFileClick={props.onFileClick}
            ops={props.ops}
            _filter={filter()}
            _marks={marks()}
            _deeps={deeps()}
            _kinds={kinds()}
            _chain={chain}
          />
        </Show>
      </Collapsible.Content>
    </Collapsible>
  )

  const renderDirNoMenu = (node: FileNode, expanded: () => boolean, deep: () => number) =>
    renderDirCore(node, expanded, deep, () => false, () => false)

  return (
    <div
      data-component="filetree"
      class={`flex flex-col gap-0.5 ${props.class ?? ""}`}
      classList={{
        "flex-1 min-h-0": level === 0,
        "ring-1 ring-inset ring-border-focus rounded-sm": level === 0 && dropTarget() === "",
      }}
      onDragOver={(e: DragEvent) => {
        if (level !== 0) return
        handleDirDragOver("", e)
      }}
      onDragLeave={(e: DragEvent) => {
        if (level !== 0) return
        if (dropTarget() === "") setDropTarget(null)
      }}
      onDrop={(e: DragEvent) => {
        if (level !== 0) return
        handleDirDrop("", e)
      }}
    >
      <For each={nodes()}>{renderNode}</For>
    </div>
  )
}
