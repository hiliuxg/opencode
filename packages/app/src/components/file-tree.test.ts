import { beforeAll, describe, expect, mock, test } from "bun:test"

let shouldListRoot: typeof import("./file-tree").shouldListRoot
let shouldListExpanded: typeof import("./file-tree").shouldListExpanded
let dirsToExpand: typeof import("./file-tree").dirsToExpand
let clipboardPath: typeof import("./file-tree").clipboardPath
let pasteTarget: typeof import("./file-tree").pasteTarget
let pasteBlocked: typeof import("./file-tree").pasteBlocked

beforeAll(async () => {
  mock.module("@solidjs/router", () => ({
    useNavigate: () => () => undefined,
    useParams: () => ({}),
  }))
  mock.module("@/context/file", () => ({
    useFile: () => ({
      tree: {
        state: () => undefined,
        list: () => Promise.resolve(),
        children: () => [],
        expand: () => {},
        collapse: () => {},
      },
    }),
  }))
  mock.module("@opencode-ai/ui/collapsible", () => ({
    Collapsible: {
      Trigger: (props: { children?: unknown }) => props.children,
      Content: (props: { children?: unknown }) => props.children,
    },
  }))
  mock.module("@opencode-ai/ui/context-menu", () => ({
    ContextMenu: Object.assign((props: { children?: unknown }) => props.children, {
      Trigger: (props: { children?: unknown }) => props.children,
      Portal: (props: { children?: unknown }) => props.children,
      Content: (props: { children?: unknown }) => props.children,
      Item: (props: { children?: unknown }) => props.children,
      ItemLabel: (props: { children?: unknown }) => props.children,
      Separator: () => null,
    }),
  }))
  mock.module("@opencode-ai/ui/file-icon", () => ({ FileIcon: () => null }))
  mock.module("@opencode-ai/ui/icon", () => ({ Icon: () => null }))
  mock.module("@opencode-ai/ui/toast", () => ({ showToast: () => undefined }))
  mock.module("@opencode-ai/ui/tooltip", () => ({ Tooltip: (props: { children?: unknown }) => props.children }))
  const mod = await import("./file-tree")
  shouldListRoot = mod.shouldListRoot
  shouldListExpanded = mod.shouldListExpanded
  dirsToExpand = mod.dirsToExpand
  clipboardPath = mod.clipboardPath
  pasteTarget = mod.pasteTarget
  pasteBlocked = mod.pasteBlocked
})

describe("file tree fetch discipline", () => {
  test("root lists on mount unless already loaded or loading", () => {
    expect(shouldListRoot({ level: 0 })).toBe(true)
    expect(shouldListRoot({ level: 0, dir: { loaded: true } })).toBe(false)
    expect(shouldListRoot({ level: 0, dir: { loading: true } })).toBe(false)
    expect(shouldListRoot({ level: 1 })).toBe(false)
  })

  test("nested dirs list only when expanded and stale", () => {
    expect(shouldListExpanded({ level: 1 })).toBe(false)
    expect(shouldListExpanded({ level: 1, dir: { expanded: false } })).toBe(false)
    expect(shouldListExpanded({ level: 1, dir: { expanded: true } })).toBe(true)
    expect(shouldListExpanded({ level: 1, dir: { expanded: true, loaded: true } })).toBe(false)
    expect(shouldListExpanded({ level: 1, dir: { expanded: true, loading: true } })).toBe(false)
    expect(shouldListExpanded({ level: 0, dir: { expanded: true } })).toBe(false)
  })

  test("allowed auto-expand picks only collapsed dirs", () => {
    const expanded = new Set<string>()
    const filter = { dirs: new Set(["src", "src/components"]) }

    const first = dirsToExpand({
      level: 0,
      filter,
      expanded: (dir) => expanded.has(dir),
    })

    expect(first).toEqual(["src", "src/components"])

    for (const dir of first) expanded.add(dir)

    const second = dirsToExpand({
      level: 0,
      filter,
      expanded: (dir) => expanded.has(dir),
    })

    expect(second).toEqual([])
    expect(dirsToExpand({ level: 1, filter, expanded: () => false })).toEqual([])
  })

  test("active file auto-expand picks parent dirs", () => {
    const expanded = new Set(["src"])

    expect(
      dirsToExpand({
        level: 0,
        active: "src/components/file-tree.tsx",
        expanded: (dir) => expanded.has(dir),
      }),
    ).toEqual(["src/components"])
  })
})

describe("file tree clipboard operations", () => {
  test("reads the first usable path from clipboard text", () => {
    expect(clipboardPath("")).toBeUndefined()
    expect(clipboardPath("\n  src/file.ts  \n")).toBe("src/file.ts")
    expect(clipboardPath("\nfile://src/file.ts\nfile://other.ts")).toBe("file://src/file.ts")
  })

  test("pastes with the source basename inside the selected directory", () => {
    expect(pasteTarget({ src: "src/file.ts", dir: "" })).toBe("file.ts")
    expect(pasteTarget({ src: "src/file.ts", dir: "lib" })).toBe("lib/file.ts")
    expect(pasteTarget({ src: "src/components", dir: "lib" })).toBe("lib/components")
  })

  test("blocks cutting a directory into itself", () => {
    expect(pasteBlocked({ op: "cut", src: "src", dir: "src" })).toBe(true)
    expect(pasteBlocked({ op: "cut", src: "src", dir: "src/components" })).toBe(true)
    expect(pasteBlocked({ op: "copy", src: "src", dir: "src/components" })).toBe(false)
    expect(pasteBlocked({ op: "cut", src: "src", dir: "lib" })).toBe(false)
  })
})
