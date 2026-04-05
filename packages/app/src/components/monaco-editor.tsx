import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js"
import type * as Monaco from "monaco-editor"
import { useTheme } from "@opencode-ai/ui/theme/context"
import { LineCommentEditor } from "@opencode-ai/ui/line-comment"
import type { FileSearchControl } from "@opencode-ai/ui/file"
import type { SelectedLineRange } from "@/context/file"

function monacoLanguage(filePath: string): string {
  const name = filePath.split("/").pop()?.toLowerCase() ?? ""
  if (name === "dockerfile") return "dockerfile"
  const ext = name.split(".").pop() ?? ""
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    json: "json",
    jsonc: "json",
    yaml: "yaml",
    yml: "yaml",
    html: "html",
    htm: "html",
    css: "css",
    scss: "scss",
    less: "less",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    c: "c",
    cpp: "cpp",
    h: "cpp",
    hpp: "cpp",
    cs: "csharp",
    rb: "ruby",
    php: "php",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    fish: "shell",
    sql: "sql",
    md: "markdown",
    toml: "ini",
    xml: "xml",
    svg: "xml",
    dockerfile: "dockerfile",
  }
  return map[ext] ?? "plaintext"
}

// Approximate height of the LineCommentEditor popup (textarea + actions + padding)
const EDITOR_POPUP_HEIGHT = 160

type SelectionOverlay = {
  range: SelectedLineRange
  top: number
  selBottom: number
  left: number
}

export function MonacoEditor(props: {
  value: string
  filePath?: string
  onChange?: (value: string) => void
  onSave?: (value: string, source: "shortcut" | "auto") => void
  onSelectionAdd?: (range: SelectedLineRange, comment?: string) => void
  addToChatLabel?: string
  class?: string
  autoSaveDelay?: number
  search?: FileSearchControl
}) {
  const theme = useTheme()
  let container: HTMLDivElement | undefined
  let editor: Monaco.editor.IStandaloneCodeEditor | undefined
  let monacoRef: typeof Monaco | undefined
  const [loading, setLoading] = createSignal(true)
  const [overlay, setOverlay] = createSignal<SelectionOverlay | null>(null)
  const [commenting, setCommenting] = createSignal(false)
  let autoSaveTimer: ReturnType<typeof setTimeout> | undefined

  const save = (source: "shortcut" | "auto") => {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer)
      autoSaveTimer = undefined
    }
    if (!editor) return
    props.onSave?.(editor.getValue(), source)
  }

  onMount(async () => {
    const monaco = await import("monaco-editor")
    monacoRef = monaco

    if (!container) return

    // Define custom themes to ensure background colors update correctly
    monaco.editor.defineTheme("oc-light", {
      base: "vs",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#ffffff",
      },
    })
    monaco.editor.defineTheme("oc-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#1e1e1e",
      },
    })

    editor = monaco.editor.create(container, {
      value: props.value,
      language: monacoLanguage(props.filePath ?? ""),
      theme: theme.mode() === "dark" ? "oc-dark" : "oc-light",
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      lineNumbers: "on",
      wordWrap: "off",
      readOnly: false,
      contextmenu: false,
      scrollbar: {
        horizontal: "auto",
        vertical: "auto",
      },
    })

    editor.onDidChangeModelContent(() => {
      const val = editor!.getValue()
      props.onChange?.(val)

      const delay = props.autoSaveDelay ?? 3000
      if (delay > 0) {
        if (autoSaveTimer) clearTimeout(autoSaveTimer)
        autoSaveTimer = setTimeout(() => save("auto"), delay)
      }
    })

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => save("shortcut"))

    props.search?.register({ focus: () => editor!.getAction("actions.find")?.run() })

    // Show "add to chat" overlay on mouse-up after selection
    if (props.onSelectionAdd) {
      editor.onMouseUp(() => {
        if (commenting()) return
        const sel = editor!.getSelection()
        if (!sel || sel.isEmpty()) {
          setOverlay(null)
          return
        }
        const pos = editor!.getScrolledVisiblePosition({
          lineNumber: sel.startLineNumber,
          column: 1,
        })
        if (!pos) {
          setOverlay(null)
          return
        }
        const posEnd = editor!.getScrolledVisiblePosition({
          lineNumber: sel.endLineNumber,
          column: 1,
        })
        const lineH = pos.height ?? 19
        setOverlay({
          range: { start: sel.startLineNumber, end: sel.endLineNumber },
          top: Math.max(4, pos.top),
          selBottom: (posEnd?.top ?? pos.top) + lineH,
          left: Math.max(8, pos.left),
        })
      })

      editor.onDidChangeCursorSelection((e) => {
        if (e.selection.isEmpty() && !commenting()) setOverlay(null)
      })
      editor.onDidBlurEditorWidget(() => {
        if (!commenting()) setOverlay(null)
      })
    }

    setLoading(false)
  })

  // Reactively sync Monaco theme when app theme changes
  createEffect(() => {
    if (!monacoRef || !editor) return
    monacoRef.editor.setTheme(theme.mode() === "dark" ? "oc-dark" : "oc-light")
  })

  // Reactively sync external value changes (e.g. file watcher reload)
  createEffect(() => {
    const next = props.value
    if (!editor) return
    if (editor.hasTextFocus()) return
    const cur = editor.getValue()
    if (cur === next) return
    editor.setValue(next)
  })

  onCleanup(() => {
    if (autoSaveTimer) clearTimeout(autoSaveTimer)
    props.search?.register(null)
    editor?.dispose()
    editor = undefined
  })

  return (
    <div class={`relative ${props.class ?? ""}`} style={{ height: "100%" }} data-prevent-autofocus="true">
      {loading() && (
        <div class="absolute inset-0 flex items-center justify-center text-text-weak text-sm">Loading editor...</div>
      )}
      <div ref={(el) => (container = el)} style={{ width: "100%", height: "100%" }} />
      <Show when={overlay()}>
        {(o) => (
          <Show
            when={commenting()}
            fallback={
              <div
                class="absolute z-50 pointer-events-none"
                style={{ top: `${o().top}px`, left: `${o().left}px` }}
              >
                <button
                  class="pointer-events-auto px-2 py-1 text-xs rounded-md bg-surface-raised-base border border-border-base text-text-strong shadow-sm transition-all duration-150 hover:bg-surface-raised-hover hover:border-border-focus hover:shadow-md hover:cursor-pointer whitespace-nowrap"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    setCommenting(true)
                  }}
                >
                  {props.addToChatLabel ?? "添加到聊天中"}
                </button>
              </div>
            }
          >
            <div
              class="absolute z-50"
              style={
                o().top >= EDITOR_POPUP_HEIGHT
                  ? { bottom: `calc(100% - ${o().top - 6}px)`, left: `${o().left}px`, width: "300px" }
                  : { top: `${o().selBottom + 6}px`, left: `${o().left}px`, width: "300px" }
              }
            >
              <LineCommentEditor
                inline={true}
                value=""
                selection={
                  <>
                    L{o().range.start}–L{o().range.end}
                  </>
                }
                onInput={() => {}}
                onCancel={() => {
                  setCommenting(false)
                  setOverlay(null)
                }}
                onSubmit={(text: string) => {
                  props.onSelectionAdd?.(o().range, text)
                  setCommenting(false)
                  setOverlay(null)
                }}
                onPopoverFocusOut={(e: FocusEvent & { currentTarget: HTMLDivElement }) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setCommenting(false)
                    setOverlay(null)
                  }
                }}
              />
            </div>
          </Show>
        )}
      </Show>
    </div>
  )
}
