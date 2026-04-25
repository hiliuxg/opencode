import { For, Show, createSignal, type JSX } from "solid-js"
import { utils, writeFile } from "xlsx"
import { useI18n } from "../context/i18n"
import { IconButton } from "./icon-button"
import { Tooltip } from "./tooltip"

export interface DataCol {
  key: string
  label?: string
  title?: string
}

export interface DataTableProps {
  cols: DataCol[]
  rows: unknown[][]
  empty?: string
  class?: string
  head?: JSX.Element
  file?: string
  cell?: (value: unknown, row: unknown[], col: DataCol, x: number, y: number) => JSX.Element
}

export function DataTable(props: DataTableProps) {
  const i18n = useI18n()
  const [copied, setCopied] = createSignal(false)
  const [saved, setSaved] = createSignal(false)

  const cell = (value: unknown, row: unknown[], col: DataCol, x: number, y: number) => {
    if (props.cell) return props.cell(value, row, col, x, y)
    if (value === undefined || value === null) return "-"
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value)
    return JSON.stringify(value)
  }

  const text = (value: unknown) => {
    if (value === undefined || value === null) return "-"
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return String(value).replaceAll(/[\t\r\n]+/g, " ").trim()
    }
    return JSON.stringify(value).replaceAll(/[\t\r\n]+/g, " ").trim()
  }

  const copy = async () => {
    const head = props.cols.map((col) => text(col.label || col.key || "-")).join("\t")
    const body = props.rows.map((row) => props.cols.map((_, x) => text(row[x])).join("\t")).join("\n")
    await navigator.clipboard.writeText([head, body].filter(Boolean).join("\n"))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const excel = (value: unknown) => {
    if (value === undefined || value === null) return ""
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value
    return JSON.stringify(value)
  }

  const file = () => {
    const pad = (value: number) => String(value).padStart(2, "0")
    const now = new Date()
    const stamp =
      String(now.getFullYear()) +
      pad(now.getMonth() + 1) +
      pad(now.getDate()) +
      "-" +
      pad(now.getHours()) +
      pad(now.getMinutes()) +
      pad(now.getSeconds())
    const raw = props.file || "query-result.xlsx"
    const idx = raw.lastIndexOf(".")
    if (idx < 1) return `${raw}-${stamp}.xlsx`
    return `${raw.slice(0, idx)}-${stamp}${raw.slice(idx)}`
  }

  const save = () => {
    const wb = utils.book_new()
    const data = [
      props.cols.map((col) => col.label || col.key || "-"),
      ...props.rows.map((row) => props.cols.map((_, x) => excel(row[x]))),
    ]
    const ws = utils.aoa_to_sheet(data)
    utils.book_append_sheet(wb, ws, "Sheet1")
    writeFile(wb, file())
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div data-component="datatable-wrap" classList={{ [props.class ?? ""]: !!props.class }}>
      <Show when={props.head}>
        <div data-slot="datatable-head">{props.head}</div>
      </Show>
      <div data-slot="datatable-copy">
        <Tooltip value={saved() ? i18n.t("ui.message.downloaded") : i18n.t("ui.message.download")} placement="top" gutter={4}>
          <IconButton
            type="button"
            icon={saved() ? "check" : "download"}
            variant="ghost"
            size="small"
            onClick={save}
            aria-label={saved() ? i18n.t("ui.message.downloaded") : i18n.t("ui.message.download")}
          />
        </Tooltip>
        <Tooltip value={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copy")} placement="top" gutter={4}>
          <IconButton
            type="button"
            icon={copied() ? "check" : "copy"}
            variant="ghost"
            size="small"
            onClick={copy}
            aria-label={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copy")}
          />
        </Tooltip>
      </div>
      <div data-slot="datatable-body">
        <table data-component="datatable">
          <thead>
            <tr>
              <For each={props.cols}>
                {(col) => <th title={col.title || ""}>{col.label || col.key || "-"}</th>}
              </For>
            </tr>
          </thead>
          <tbody>
            <Show when={props.rows.length > 0} fallback={<tr><td colSpan={props.cols.length}>{props.empty || "No rows"}</td></tr>}>
              <For each={props.rows}>
                {(row, y) => (
                  <tr>
                    <For each={props.cols}>
                      {(col, x) => <td>{cell(row[x()], row, col, x(), y())}</td>}
                    </For>
                  </tr>
                )}
              </For>
            </Show>
          </tbody>
        </table>
      </div>
    </div>
  )
}
