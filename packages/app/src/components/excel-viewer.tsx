import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { read, utils, type WorkBook } from "xlsx"
import { useTheme } from "@opencode-ai/ui/theme/context"
import { useLanguage } from "@/context/language"

function parse(base64: string): WorkBook | undefined {
  try {
    const raw = atob(base64)
    const bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
    return read(bytes, { type: "array" })
  } catch {
    return undefined
  }
}

function sheetToRows(wb: WorkBook, name: string): string[][] {
  const sheet = wb.Sheets[name]
  if (!sheet) return []
  return utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "" })
}

export function ExcelViewer(props: { content: string; filePath?: string; class?: string }) {
  const theme = useTheme()
  const language = useLanguage()
  const dark = () => theme.mode() === "dark"

  const wb = createMemo(() => parse(props.content))
  const sheets = createMemo(() => wb()?.SheetNames ?? [])
  const [active, setActive] = createSignal("")

  createEffect(() => {
    const names = sheets()
    if (names.length && !names.includes(active())) setActive(names[0])
  })

  const rows = createMemo(() => {
    const book = wb()
    const name = active()
    if (!book || !name) return []
    return sheetToRows(book, name)
  })

  const maxCols = createMemo(() => {
    let max = 0
    for (const row of rows()) if (row.length > max) max = row.length
    return max
  })

  return (
    <div class={`flex flex-col h-full ${props.class ?? ""}`}>
      <Show
        when={wb()}
        fallback={
          <div class="flex items-center justify-center h-full text-text-weak text-14-regular">
            {language.t("excel.error")}
          </div>
        }
      >
        <Show when={sheets().length > 1}>
          <div
            class="flex gap-0 border-b overflow-x-auto shrink-0"
            classList={{
              "border-border-weak-base bg-surface-base": true,
            }}
          >
            <For each={sheets()}>
              {(name) => (
                <button
                  class="px-3 py-1.5 text-13-medium whitespace-nowrap transition-colors border-b-2 cursor-pointer"
                  classList={{
                    "border-interactive-base text-text-strong": active() === name,
                    "border-transparent text-text-weak hover:text-text-base": active() !== name,
                  }}
                  onClick={() => setActive(name)}
                >
                  {name}
                </button>
              )}
            </For>
          </div>
        </Show>

        <div class="flex-1 overflow-auto">
          <table
            class="border-collapse text-13-regular w-full"
            classList={{
              "text-text-base": true,
            }}
          >
            <Show when={rows().length > 0}>
              <thead class="sticky top-0 z-10">
                <tr>
                  <th
                    class="px-3 py-1.5 text-left font-medium border border-border-weak-base whitespace-nowrap"
                    classList={{
                      "bg-surface-raised-base": true,
                    }}
                  >
                    #
                  </th>
                  <For each={Array.from({ length: maxCols() }, (_, i) => i)}>
                    {(col) => (
                      <th
                        class="px-3 py-1.5 text-left font-medium border border-border-weak-base whitespace-nowrap"
                        classList={{
                          "bg-surface-raised-base": true,
                        }}
                      >
                        {colLabel(col)}
                      </th>
                    )}
                  </For>
                </tr>
              </thead>
              <tbody>
                <For each={rows()}>
                  {(row, idx) => (
                    <tr
                      class="transition-colors"
                      classList={{
                        "hover:bg-surface-raised-base": true,
                      }}
                    >
                      <td
                        class="px-3 py-1 border border-border-weak-base text-text-weak text-right tabular-nums select-none"
                        classList={{
                          "bg-surface-base": !dark(),
                          "bg-surface-raised-base": dark(),
                        }}
                      >
                        {idx() + 1}
                      </td>
                      <For each={Array.from({ length: maxCols() }, (_, i) => i)}>
                        {(col) => (
                          <td class="px-3 py-1 border border-border-weak-base whitespace-pre-wrap max-w-xs truncate">
                            {String(row[col] ?? "")}
                          </td>
                        )}
                      </For>
                    </tr>
                  )}
                </For>
              </tbody>
            </Show>
          </table>

          <Show when={rows().length === 0}>
            <div class="flex items-center justify-center py-10 text-text-weak text-14-regular">
              {language.t("excel.empty")}
            </div>
          </Show>
        </div>

        <Show when={sheets().length > 0}>
          <div class="shrink-0 px-3 py-1.5 border-t border-border-weak-base text-12-regular text-text-weak flex gap-3">
            <span>
              {language.t("excel.stats.rows", { count: rows().length.toLocaleString() })}
            </span>
            <span>
              {language.t("excel.stats.cols", { count: maxCols().toLocaleString() })}
            </span>
            <span>
              {language.t("excel.stats.sheets", { count: sheets().length.toString() })}
            </span>
          </div>
        </Show>
      </Show>
    </div>
  )
}

function colLabel(idx: number): string {
  let label = ""
  let n = idx
  while (true) {
    label = String.fromCharCode(65 + (n % 26)) + label
    n = Math.floor(n / 26) - 1
    if (n < 0) break
  }
  return label
}
