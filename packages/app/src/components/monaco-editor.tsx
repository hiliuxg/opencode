import { createSignal, onCleanup, onMount } from "solid-js"
import type * as Monaco from "monaco-editor"

interface MonacoEditorProps {
    value: string
    language?: string
    filePath?: string
    onChange?: (value: string) => void
    onSave?: (value: string, source: "shortcut" | "auto") => void
    class?: string
}

function getMonacoLanguage(filePath: string): string {
    const ext = filePath.split(".").pop()?.toLowerCase() ?? ""
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
    // special case for Dockerfile without extension
    const name = filePath.split("/").pop()?.toLowerCase() ?? ""
    if (name === "dockerfile") return "dockerfile"
    return map[ext] ?? "plaintext"
}

export function MonacoEditor(props: MonacoEditorProps & { autoSaveDelay?: number }) {
    let container: HTMLDivElement | undefined
    let editor: Monaco.editor.IStandaloneCodeEditor | undefined
    let monacoRef: typeof Monaco | undefined
    const [isLoading, setIsLoading] = createSignal(true)
    let autoSaveTimer: any

    const save = (source: "shortcut" | "auto") => {
        if (autoSaveTimer) {
            clearTimeout(autoSaveTimer)
            autoSaveTimer = null
        }
        if (editor) {
            const value = editor.getValue()
            props.onSave?.(value, source)
        }
    }

    onMount(async () => {
        // Dynamically import Monaco to avoid SSR issues and keep the bundle lean
        const monaco = await import("monaco-editor")
        monacoRef = monaco

        if (!container) return

        editor = monaco.editor.create(container, {
            value: props.value,
            language: getMonacoLanguage(props.filePath ?? ""),
            theme: "vs",
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

        // Handle content changes with debounce auto-save
        editor.onDidChangeModelContent(() => {
            const value = editor!.getValue()
            props.onChange?.(value)

            // Auto save logic
            const delay = props.autoSaveDelay ?? 3000 // Default to 1.5s
            if (delay > 0) {
                if (autoSaveTimer) clearTimeout(autoSaveTimer)
                autoSaveTimer = setTimeout(() => {
                    save("auto")
                }, delay)
            }
        })

        // Intercept Cmd+S / Ctrl+S for save
        editor.addCommand(
            monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
            () => {
                save("shortcut")
            },
        )

        setIsLoading(false)
    })

    // Update editor content when `value` prop changes from outside (e.g. server reload)
    // Use a reactive effect-like pattern via getter accessor
    let prevValue = props.value
    const syncValue = () => {
        if (!editor) return
        // Do not overwrite editor content if the user is currently focused on it.
        // This prevents cursor jumping when the file watcher detects a save
        // and reloads the identical content.
        if (editor.hasTextFocus()) return

        const current = editor.getValue()
        if (props.value !== current && props.value !== prevValue) {
            prevValue = props.value
            editor.setValue(props.value)
        }
    }
    // We poll via setInterval because solid-js createEffect would need special wrapping
    // A smpler alternative is to watch props in a createEffect from the parent
    const interval = setInterval(syncValue, 500)

    onCleanup(() => {
        if (autoSaveTimer) clearTimeout(autoSaveTimer)
        clearInterval(interval)
        editor?.dispose()
        editor = undefined
    })

    return (
        <div class={`relative ${props.class ?? ""}`} style={{ height: "100%" }} data-prevent-autofocus="true">
            {isLoading() && (
                <div class="absolute inset-0 flex items-center justify-center text-text-weak text-sm">
                    Loading editor...
                </div>
            )}
            <div
                ref={(el) => {
                    container = el
                }}
                style={{ width: "100%", height: "100%" }}
            />
        </div>
    )
}
