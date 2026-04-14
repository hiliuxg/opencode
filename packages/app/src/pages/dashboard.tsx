import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { A, useSearchParams } from "@solidjs/router"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import type { AssistantMessage, GlobalSession } from "@opencode-ai/sdk/v2/client"
import { base64Encode } from "@opencode-ai/util/encode"
import { Button } from "@opencode-ai/ui/button"

// ECharts imports (tree-shaking friendly)
import * as echarts from "echarts/core"
import { LineChart, BarChart } from "echarts/charts"
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
} from "echarts/components"
import { CanvasRenderer } from "echarts/renderers"

// Register ECharts components
echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, CanvasRenderer])

// ─── Types ────────────────────────────────────────────────────────────────────

type DayStats = { tokens: number; questions: number; sessions: number; dirs: Record<string, true> }
type DirStats = { sessions: number; questions: number; tokens: number }
type SessionStat = { id: string; title: string; directory: string; tokens: number; questions: number }

type ModelStat = { tokens: number; count: number }
type ProviderModelKey = `${string}/${string}`
type DayModelTokens = { input: number; output: number }

type AccStats = {
  byDay: Record<string, DayStats>
  byDir: Record<string, DirStats>
  bySession: Record<string, SessionStat>
  byProviderModel: Record<ProviderModelKey, ModelStat>
  byDayModel: Record<string, Record<ProviderModelKey, DayModelTokens>>
  totalTokens: number
  totalQuestions: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000
const CONCURRENCY = 5
const CHART_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#ef4444"]

// ─── Helpers ─────────────────────────────────────────────────────────────────

const formatDate = (d: Date) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

const toDateStr = (ts: number) => formatDate(new Date(ts))

const tokenSum = (msg: AssistantMessage) => {
  const t = msg.tokens
  return t.input + t.output + t.reasoning
}

const formatNum = (n: number) => {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K"
  return String(Math.round(n))
}

const buildDateRange = (from: Date, to: Date) => {
  const days: string[] = []
  let cur = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate())
  while (cur <= end) {
    days.push(toDateStr(cur.getTime()))
    cur = new Date(cur.getTime() + DAY_MS)
  }
  return days
}

const defaultFrom = () => {
  const d = new Date()
  d.setDate(d.getDate() - 6)
  d.setHours(0, 0, 0, 0)
  return d
}

const defaultTo = () => {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d
}

const shortDir = (dir: string) => {
  const parts = dir.split("/").filter(Boolean)
  if (parts.length === 0) return dir
  if (parts.length === 1) return parts[0]
  return parts[parts.length - 1]
}

// ─── ECharts Components ───────────────────────────────────────────────────────

function EChart(props: { option: echarts.EChartsCoreOption; class?: string }) {
  let container!: HTMLDivElement
  let chart: echarts.ECharts | null = null

  // Init once on mount
  createEffect(() => {
    if (!container) return
    chart = echarts.init(container)

    const resize = () => chart?.resize()
    window.addEventListener("resize", resize)

    onCleanup(() => {
      window.removeEventListener("resize", resize)
      chart?.dispose()
      chart = null
    })
  })

  // Update option reactively without re-initializing
  createEffect(() => {
    chart?.setOption(props.option, { notMerge: true, lazyUpdate: true })
  })

  return <div ref={container} class={`w-full ${props.class || ""}`} style={{ height: "240px" }} />
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard(props: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div class="bg-surface-base border border-border-weak-base rounded-xl p-5 flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <div class="w-1.5 h-5 rounded-full" style={{ background: props.accent }} />
        <span class="text-xs text-text-weak">{props.label}</span>
      </div>
      <div class="text-3xl font-semibold text-text-strong tabular-nums">{props.value}</div>
      <div class="text-xs text-text-faint">{props.sub}</div>
    </div>
  )
}

// ─── Chart Section ────────────────────────────────────────────────────────────

function ChartSection(props: { title: string; sub: string; children: unknown }) {
  return (
    <div class="bg-surface-base border border-border-weak-base rounded-xl p-6">
      <div class="mb-1 text-sm font-medium text-text-strong">{props.title}</div>
      <div class="mb-5 text-xs text-text-faint">{props.sub}</div>
      {props.children as any}
    </div>
  )
}

// ─── Chart With Table Tabs ────────────────────────────────────────────────────

type ViewMode = "chart" | "table"

function ChartWithTable(props: {
  option: echarts.EChartsCoreOption
  class?: string
  columns: { key: string; title: string; align?: "left" | "right"; formatter?: (v: number) => string }[]
  data: () => Record<string, number | string>[]
}) {
  const language = useLanguage()
  const [mode, setMode] = createSignal<ViewMode>("chart")

  return (
    <div class="flex flex-col gap-3">
      <div class="flex gap-1">
        <Button
          size="small"
          variant={mode() === "chart" ? "primary" : "secondary"}
          onClick={() => setMode("chart")}
        >
          {language.t("common.chart")}
        </Button>
        <Button
          size="small"
          variant={mode() === "table" ? "primary" : "secondary"}
          onClick={() => setMode("table")}
        >
          {language.t("common.table")}
        </Button>
      </div>
      <Show when={mode() === "chart"}>
        <EChart option={props.option} class={props.class} />
      </Show>
      <Show when={mode() === "table"}>
        <div class="overflow-x-auto" style={{ "max-height": "240px" }}>
          <table class="w-full text-sm">
            <thead class="sticky top-0 bg-surface-base">
              <tr class="border-b border-border-weak-base">
                <For each={props.columns}>
                  {(col) => (
                    <th
                      class="py-2 px-2 text-xs font-medium text-text-weak"
                      classList={{ "text-left": col.align !== "right", "text-right": col.align === "right" }}
                    >
                      {col.title}
                    </th>
                  )}
                </For>
              </tr>
            </thead>
            <tbody>
              <For each={props.data()}>
                {(row) => (
                  <tr class="border-b border-border-weak-base/50 hover:bg-surface-hover-base">
                    <For each={props.columns}>
                      {(col) => {
                        const val = row[col.key]
                        const display = col.formatter && typeof val === "number" ? col.formatter(val) : String(val)
                        return (
                          <td
                            class="py-2 px-2 tabular-nums"
                            classList={{
                              "text-left": col.align !== "right",
                              "text-right": col.align === "right",
                              "text-text-strong": col.key !== "date",
                              "text-text-weak": col.key === "date",
                            }}
                          >
                            {display}
                          </td>
                        )
                      }}
                    </For>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </div>
  )
}

// ─── Quick Range Button ───────────────────────────────────────────────────────

function QuickBtn(props: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      class="px-2.5 py-1 rounded text-xs border transition-colors"
      classList={{
        "border-border-strong-base bg-surface-stronger text-text-strong": props.active,
        "border-border-weak-base text-text-weak hover:bg-surface-hover-base": !props.active,
      }}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  )
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const globalSDK = useGlobalSDK()
  const language = useLanguage()

  const [from, setFrom] = createSignal(defaultFrom())
  const [to, setTo] = createSignal(defaultTo())
  const [quickDays, setQuickDays] = createSignal(7)
  const [progress, setProgress] = createSignal({ loaded: 0, total: 0 })

  const [stats, setStats] = createStore<AccStats>({
    byDay: {},
    byDir: {},
    bySession: {},
    byProviderModel: {},
    byDayModel: {},
    totalTokens: 0,
    totalQuestions: 0,
  })

  // Monotonic version – used to cancel stale parallel workers
  let ver = 0

  const [searchParams] = useSearchParams()
  const filterDirectory = createMemo(() => {
    const d = searchParams.directory
    return Array.isArray(d) ? d[0] : d
  })

  const [sessionsRes] = createResource(
    () => ({ from: from().getTime(), to: to().getTime(), dir: filterDirectory() }),
    async (range) => {
      const myVer = ++ver

      setStats({ byDay: {}, byDir: {}, bySession: {}, byProviderModel: {}, byDayModel: {}, totalTokens: 0, totalQuestions: 0 })
      setProgress({ loaded: 0, total: 0 })

      const result = await globalSDK.client.experimental.session.list({
        start: range.from,
        limit: 3000,
        archived: true,
        directory: range.dir,
      })
      if (myVer !== ver) return [] as GlobalSession[]

      const all = (result.data ?? []).filter((s) => s.time.updated >= range.from && s.time.updated <= range.to)

      setProgress({ loaded: 0, total: all.length })

      let idx = 0
      const worker = async () => {
        while (idx < all.length) {
          if (myVer !== ver) return
          const session = all[idx++]
          try {
            const r = await globalSDK.client.session.messages({
              sessionID: session.id,
              directory: session.directory,
              limit: 3000,
            })
            if (myVer !== ver) return

            const msgs = r.data ?? []
            let sTokens = 0
            let sQuestions = 0

            for (const item of msgs) {
              const msg = item.info
              if (!msg) continue
              // Only count messages within the selected date range
              if (msg.time.created < range.from || msg.time.created > range.to) continue
              const day = toDateStr(msg.time.created)
              if (msg.role === "user") {
                sQuestions++
                setStats(
                  produce((s) => {
                    if (!s.byDay[day]) s.byDay[day] = { tokens: 0, questions: 0, sessions: 0, dirs: {} }
                    s.byDay[day].questions++
                  }),
                )
              } else if (msg.role === "assistant") {
                const assistantMsg = msg as AssistantMessage
                const t = tokenSum(assistantMsg)
                if (t > 0) {
                  sTokens += t
                  const key: ProviderModelKey = `${assistantMsg.providerID}/${assistantMsg.modelID}`
                  const inp = assistantMsg.tokens.input
                  const out = assistantMsg.tokens.output + assistantMsg.tokens.reasoning
                  setStats(
                    produce((s) => {
                      if (!s.byDay[day]) s.byDay[day] = { tokens: 0, questions: 0, sessions: 0, dirs: {} }
                      s.byDay[day].tokens += t
                      if (!s.byProviderModel[key]) s.byProviderModel[key] = { tokens: 0, count: 0 }
                      s.byProviderModel[key].tokens += t
                      s.byProviderModel[key].count++
                      if (!s.byDayModel[day]) s.byDayModel[day] = {}
                      if (!s.byDayModel[day][key]) s.byDayModel[day][key] = { input: 0, output: 0 }
                      s.byDayModel[day][key].input += inp
                      s.byDayModel[day][key].output += out
                    }),
                  )
                }
              }
            }

            const sDay = toDateStr(session.time.updated)
            const dir = session.directory
            setStats(
              produce((s) => {
                if (!s.byDay[sDay]) s.byDay[sDay] = { tokens: 0, questions: 0, sessions: 0, dirs: {} }
                s.byDay[sDay].sessions++
                s.byDay[sDay].dirs[dir] = true
                if (!s.byDir[dir]) s.byDir[dir] = { sessions: 0, questions: 0, tokens: 0 }
                s.byDir[dir].sessions++
                s.byDir[dir].questions += sQuestions
                s.byDir[dir].tokens += sTokens
                s.totalTokens += sTokens
                s.totalQuestions += sQuestions
                s.bySession[session.id] = {
                  id: session.id,
                  title: session.title,
                  directory: dir,
                  tokens: sTokens,
                  questions: sQuestions,
                }
              }),
            )
          } catch {
            // skip failed sessions silently
          }
          setProgress((p) => ({ ...p, loaded: p.loaded + 1 }))
        }
      }

      await Promise.all(Array.from({ length: CONCURRENCY }, worker))
      return all
    },
  )

  // ── Derived ───────────────────────────────────────────────────────────────

  const days = createMemo(() => buildDateRange(from(), to()))

  const dailyTokens = createMemo(() => days().map((d) => stats.byDay[d]?.tokens ?? 0))
  const dailyQuestions = createMemo(() => days().map((d) => stats.byDay[d]?.questions ?? 0))
  const dailySessions = createMemo(() => days().map((d) => stats.byDay[d]?.sessions ?? 0))

  const dirList = createMemo(() =>
    Object.entries(stats.byDir)
      .sort((a, b) => b[1].sessions - a[1].sessions)
      .slice(0, 20),
  )

  const topSessions = createMemo(() =>
    Object.values(stats.bySession)
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 20),
  )

  const topDirs = createMemo(() =>
    Object.entries(stats.byDir)
      .map(([dir, stats]) => ({ dir, ...stats }))
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 20),
  )

  const allDirs = createMemo(() =>
    Object.entries(stats.byDir)
      .map(([dir, stats]) => ({ dir, ...stats }))
      .sort((a, b) => b.tokens - a.tokens),
  )

  const topProviderModels = createMemo(() =>
    Object.entries(stats.byProviderModel)
      .map(([key, stats]) => {
        const [providerID, modelID] = key.split("/")
        return { key, providerID, modelID, ...stats }
      })
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 20),
  )

  // Daily active directory count
  const dailyDirCounts = createMemo(() => days().map((d) => Object.keys(stats.byDay[d]?.dirs ?? {}).length))

  // Daily directory detail rows (date asc)
  const dailyDirRows = createMemo(() =>
    [...days()]
      .sort()
      .flatMap((d) =>
        Object.keys(stats.byDay[d]?.dirs ?? {}).map((dir) => ({ date: d, dir })),
      ),
  )

  // ── ECharts Options ────────────────────────────────────────────────────────

  const tokenChartOption = createMemo<echarts.EChartsCoreOption>(() => ({
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(255,255,255,0.95)",
      borderColor: "#e5e7eb",
      textStyle: { color: "#374151", fontSize: 12 },
      formatter: (params: any) => {
        const p = params?.[0]
        if (!p) return ""
        return `${p.name}<br/><span style="color:${CHART_COLORS[2]}">●</span> Tokens: ${formatNum(p.value)}`
      },
    },
    grid: { left: 60, right: 20, top: 30, bottom: 30 },
    xAxis: {
      type: "category",
      data: days(),
      axisLine: { lineStyle: { color: "#d1d5db" } },
      axisLabel: { color: "#6b7280", fontSize: 10, formatter: (v: string) => v.slice(5) },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: "#f3f4f6" } },
      axisLabel: { color: "#9ca3af", fontSize: 10, formatter: (v: number) => formatNum(v) },
    },
    series: [
      {
        type: "line",
        data: dailyTokens(),
        smooth: true,
        symbol: "circle",
        symbolSize: 6,
        lineStyle: { color: CHART_COLORS[2], width: 2 },
        itemStyle: { color: CHART_COLORS[2] },
        areaStyle: {
          color: new (echarts as any).graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "rgba(245, 158, 11, 0.3)" },
            { offset: 1, color: "rgba(245, 158, 11, 0.05)" },
          ]),
        },
      },
    ],
  }))

  const dailyChartOption = createMemo<echarts.EChartsCoreOption>(() => ({
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(255,255,255,0.95)",
      borderColor: "#e5e7eb",
      textStyle: { color: "#374151", fontSize: 12 },
    },
    legend: {
      data: ["问题数", "会话数"],
      bottom: 0,
      textStyle: { color: "#6b7280", fontSize: 11 },
    },
    grid: { left: 60, right: 20, top: 30, bottom: 40 },
    xAxis: {
      type: "category",
      data: days(),
      axisLine: { lineStyle: { color: "#d1d5db" } },
      axisLabel: { color: "#6b7280", fontSize: 10, formatter: (v: string) => v.slice(5) },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: "#f3f4f6" } },
      axisLabel: { color: "#9ca3af", fontSize: 10 },
    },
    series: [
      {
        name: "问题数",
        type: "line",
        data: dailyQuestions(),
        smooth: true,
        symbol: "circle",
        symbolSize: 5,
        lineStyle: { color: CHART_COLORS[0], width: 2 },
        itemStyle: { color: CHART_COLORS[0] },
      },
      {
        name: "会话数",
        type: "line",
        data: dailySessions(),
        smooth: true,
        symbol: "circle",
        symbolSize: 5,
        lineStyle: { color: CHART_COLORS[1], width: 2 },
        itemStyle: { color: CHART_COLORS[1] },
      },
    ],
  }))

  const dirSessionChartOption = createMemo<echarts.EChartsCoreOption>(() => {
    const dirs = dirList()
    const labels = dirs.map(([dir]) => shortDir(dir))
    const sessionData = dirs.map(([, s]) => s.sessions)
    const questionData = dirs.map(([, s]) => s.questions)

    return {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: "rgba(255,255,255,0.95)",
        borderColor: "#e5e7eb",
        textStyle: { color: "#374151", fontSize: 12 },
      },
      legend: {
        data: ["会话数", "问题数"],
        bottom: 0,
        textStyle: { color: "#6b7280", fontSize: 11 },
      },
      grid: { left: 60, right: 20, top: 30, bottom: 60 },
      dataZoom: dirs.length > 10 ? [{ type: "inside", start: 0, end: 50 }] : undefined,
      xAxis: {
        type: "category",
        data: labels,
        axisLine: { lineStyle: { color: "#d1d5db" } },
        axisLabel: {
          color: "#6b7280",
          fontSize: 9,
          rotate: 30,
          interval: 0,
          formatter: (v: string) => (v.length > 12 ? v.slice(0, 10) + "…" : v),
        },
      },
      yAxis: {
        type: "value",
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: "#f3f4f6" } },
        axisLabel: { color: "#9ca3af", fontSize: 10 },
      },
      series: [
        {
          name: "会话数",
          type: "bar",
          data: sessionData,
          barMaxWidth: 24,
          itemStyle: { color: CHART_COLORS[0], borderRadius: [2, 2, 0, 0] },
        },
        {
          name: "问题数",
          type: "bar",
          data: questionData,
          barMaxWidth: 24,
          itemStyle: { color: CHART_COLORS[1], borderRadius: [2, 2, 0, 0] },
        },
      ],
    }
  })

  const dirTokenChartOption = createMemo<echarts.EChartsCoreOption>(() => {
    const dirs = dirList()
    const labels = dirs.map(([dir]) => shortDir(dir))
    const tokenData = dirs.map(([, s]) => s.tokens)

    return {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: "rgba(255,255,255,0.95)",
        borderColor: "#e5e7eb",
        textStyle: { color: "#374151", fontSize: 12 },
        formatter: (params: any) => {
          const p = params?.[0]
          if (!p) return ""
          return `${p.name}<br/><span style="color:${CHART_COLORS[2]}">●</span> Tokens: ${formatNum(p.value)}`
        },
      },
      grid: { left: 60, right: 20, top: 30, bottom: 60 },
      dataZoom: dirs.length > 10 ? [{ type: "inside", start: 0, end: 50 }] : undefined,
      xAxis: {
        type: "category",
        data: labels,
        axisLine: { lineStyle: { color: "#d1d5db" } } ,
        axisLabel: {
          color: "#6b7280",
          fontSize: 9,
          rotate: 30,
          interval: 0,
          formatter: (v: string) => (v.length > 12 ? v.slice(0, 10) + "…" : v),
        },
      },
      yAxis: {
        type: "value",
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: "#f3f4f6" } },
        axisLabel: { color: "#9ca3af", fontSize: 10, formatter: (v: number) => formatNum(v) },
      },
      series: [
        {
          type: "bar",
          data: tokenData,
          barWidth: "50%",
          itemStyle: {
            color: new (echarts as any).graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "#f59e0b" },
              { offset: 1, color: "#fbbf24" },
            ]),
            borderRadius: [3, 3, 0, 0],
          },
        },
      ],
    }
  })

  const providerModelChartOption = createMemo<echarts.EChartsCoreOption>(() => {
    const models = topProviderModels()
    const labels = models.map((m) => `${m.providerID}/${m.modelID}`)
    const tokenData = models.map((m) => m.tokens)

    return {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: "rgba(255,255,255,0.95)",
        borderColor: "#e5e7eb",
        textStyle: { color: "#374151", fontSize: 12 },
        formatter: (params: any) => {
          const p = params?.[0]
          if (!p) return ""
          return `${p.name}<br/><span style="color:${CHART_COLORS[3]}">●</span> Tokens: ${formatNum(p.value)}`
        },
      },
      grid: { left: 80, right: 20, top: 30, bottom: 80 },
      dataZoom: models.length > 10 ? [{ type: "inside", start: 0, end: 70 }] : undefined,
      xAxis: {
        type: "category",
        data: labels,
        axisLine: { lineStyle: { color: "#d1d5db" } },
        axisLabel: {
          color: "#6b7280",
          fontSize: 9,
          rotate: 45,
          interval: 0,
          formatter: (v: string) => {
            const parts = v.split("/")
            if (parts.length === 2) {
              return `${parts[0].slice(0, 8)}…/${parts[1].slice(0, 12)}`
            }
            return v.length > 20 ? v.slice(0, 18) + "…" : v
          },
        },
      },
      yAxis: {
        type: "value",
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: "#f3f4f6" } },
        axisLabel: { color: "#9ca3af", fontSize: 10, formatter: (v: number) => formatNum(v) },
      },
      series: [
        {
          type: "bar",
          data: tokenData,
          barWidth: "60%",
          itemStyle: {
            color: new (echarts as any).graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: CHART_COLORS[3] },
              { offset: 1, color: "#a78bfa" },
            ]),
            borderRadius: [3, 3, 0, 0],
          },
        },
      ],
    }
  })

  // Daily active directory count line chart
  const dailyDirChartOption = createMemo<echarts.EChartsCoreOption>(() => ({
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(255,255,255,0.95)",
      borderColor: "#e5e7eb",
      textStyle: { color: "#374151", fontSize: 12 },
      formatter: (params: any) => {
        const p = params?.[0]
        if (!p) return ""
        return `${p.name}<br/><span style="color:${CHART_COLORS[4]}">●</span> 活跃目录数: ${p.value}`
      },
    },
    grid: { left: 60, right: 20, top: 30, bottom: 30 },
    xAxis: {
      type: "category",
      data: days(),
      axisLine: { lineStyle: { color: "#d1d5db" } },
      axisLabel: { color: "#6b7280", fontSize: 10, formatter: (v: string) => v.slice(5) },
    },
    yAxis: {
      type: "value",
      minInterval: 1,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: "#f3f4f6" } },
      axisLabel: { color: "#9ca3af", fontSize: 10 },
    },
    series: [
      {
        type: "line",
        data: dailyDirCounts(),
        smooth: true,
        symbol: "circle",
        symbolSize: 6,
        lineStyle: { color: CHART_COLORS[4], width: 2 },
        itemStyle: { color: CHART_COLORS[4] },
        areaStyle: {
          color: new (echarts as any).graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "rgba(236, 72, 153, 0.3)" },
            { offset: 1, color: "rgba(236, 72, 153, 0.05)" },
          ]),
        },
      },
    ],
  }))

  // Top models for the day-model chart (by total tokens, capped at 8 for readability)
  const topDayModels = createMemo(() =>
    (Object.keys(stats.byProviderModel) as ProviderModelKey[])
      .sort((a, b) => stats.byProviderModel[b].tokens - stats.byProviderModel[a].tokens)
      .slice(0, 8),
  )

  const dayModelChartOption = createMemo<echarts.EChartsCoreOption>(() => {
    const models = topDayModels()
    const label = (k: string) => {
      const parts = k.split("/")
      return parts.length >= 2 ? parts[1] : k
    }
    return {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: "rgba(255,255,255,0.95)",
        borderColor: "#e5e7eb",
        textStyle: { color: "#374151", fontSize: 12 },
        formatter: (params: any[]) => {
          if (!params?.length) return ""
          const date = params[0].name
          const lines = params
            .filter((p) => p.value > 0)
            .map((p) => `<span style="color:${p.color}">●</span> ${p.seriesName}: ${formatNum(p.value)}`)
          return [date, ...lines].join("<br/>")
        },
      },
      legend: {
        data: models.map(label),
        bottom: 0,
        textStyle: { color: "#6b7280", fontSize: 10 },
        type: "scroll",
      },
      grid: { left: 60, right: 20, top: 30, bottom: 50 },
      xAxis: {
        type: "category",
        data: days(),
        axisLine: { lineStyle: { color: "#d1d5db" } },
        axisLabel: { color: "#6b7280", fontSize: 10, formatter: (v: string) => v.slice(5) },
      },
      yAxis: {
        type: "value",
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: "#f3f4f6" } },
        axisLabel: { color: "#9ca3af", fontSize: 10, formatter: (v: number) => formatNum(v) },
      },
      series: models.map((model, i) => ({
        name: label(model),
        type: "bar",
        stack: "total",
        data: days().map((d) => {
          const m = stats.byDayModel[d]?.[model]
          return m ? m.input + m.output : 0
        }),
        barMaxWidth: 40,
        itemStyle: { color: CHART_COLORS[i % CHART_COLORS.length], borderRadius: i === models.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0] },
      })),
    }
  })

  const dayModelTableRows = createMemo(() =>
    days().flatMap((d) =>
      Object.entries(stats.byDayModel[d] ?? {})
        .sort((a, b) => b[1].input + b[1].output - (a[1].input + a[1].output))
        .map(([model, t]) => ({ date: d, model, input: t.input, output: t.output })),
    ),
  )

  const totalDirs = createMemo(() => Object.keys(stats.byDir).length)
  const totalSessions = createMemo(() =>
    Object.values(stats.byDir).reduce((sum, d) => sum + d.sessions, 0),
  )
  const isLoading = createMemo(() => {
    const p = progress()
    return sessionsRes.loading || (p.total > 0 && p.loaded < p.total)
  })
  const progressPct = createMemo(() => {
    const p = progress()
    return p.total > 0 ? Math.round((p.loaded / p.total) * 100) : 0
  })

  // ── Quick range ───────────────────────────────────────────────────────────

  const applyQuick = (n: number) => {
    setQuickDays(n)
    const t = defaultTo()
    const f = new Date(t.getTime() - (n - 1) * DAY_MS)
    f.setHours(0, 0, 0, 0)
    setFrom(f)
    setTo(t)
  }

  const onFromInput = (e: InputEvent) => {
    const v = (e.currentTarget as HTMLInputElement).value
    if (!v) return
    const d = new Date(v)
    d.setHours(0, 0, 0, 0)
    setFrom(d)
    setQuickDays(0)
  }

  const onToInput = (e: InputEvent) => {
    const v = (e.currentTarget as HTMLInputElement).value
    if (!v) return
    const d = new Date(v)
    d.setHours(23, 59, 59, 999)
    setTo(d)
    setQuickDays(0)
  }

  return (
    <div class="h-full overflow-y-auto bg-background-base">
      <div class="max-w-5xl mx-auto px-6 py-8 space-y-6">

        {/* ── Header ── */}
        <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 class="text-xl font-semibold text-text-strong">使用看板</h1>
            <p class="mt-0.5 text-xs text-text-weak">
              统计 OpenCode 的使用情况
              <Show when={filterDirectory()}>
                <span class="ml-2 px-1.5 py-0.5 bg-surface-stronger rounded text-text-strong">
                  目录: {filterDirectory()}
                </span>
              </Show>
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <For each={[{ label: "近 7 天", n: 7 }, { label: "近 30 天", n: 30 }, { label: "近 90 天", n: 90 }]}>
              {(q) => <QuickBtn label={q.label} active={quickDays() === q.n} onClick={() => applyQuick(q.n)} />}
            </For>
            <div class="flex items-center gap-1.5 text-xs text-text-weak">
              <input
                type="date"
                value={formatDate(from())}
                onInput={onFromInput}
                class="bg-transparent border border-border-weak-base rounded px-2 py-1 text-xs text-text-base focus:outline-none focus:border-border-strong-base"
              />
              <span class="text-text-faint">—</span>
              <input
                type="date"
                value={formatDate(to())}
                onInput={onToInput}
                class="bg-transparent border border-border-weak-base rounded px-2 py-1 text-xs text-text-base focus:outline-none focus:border-border-strong-base"
              />
            </div>
          </div>
        </div>

        {/* ── Progress bar ── */}
        <Show when={isLoading()}>
          <div class="space-y-1.5">
            <div class="flex items-center justify-between text-xs text-text-weak">
              <span>正在加载消息数据…</span>
              <span class="tabular-nums">
                {progress().loaded} / {progress().total} 会话 ({progressPct()}%)
              </span>
            </div>
            <div class="h-1 bg-surface-stronger rounded-full overflow-hidden">
              <div
                class="h-full rounded-full transition-all duration-200"
                style={{ width: `${progressPct()}%`, background: CHART_COLORS[0] }}
              />
            </div>
          </div>
        </Show>

        {/* ── Stats Cards ── */}
        <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="目录数"
            value={String(totalDirs())}
            sub="活跃工作目录"
            accent={CHART_COLORS[0]}
          />
          <StatCard
            label="会话数"
            value={formatNum(totalSessions())}
            sub="对话会话总数"
            accent={CHART_COLORS[1]}
          />
          <StatCard
            label="总 Token"
            value={formatNum(stats.totalTokens)}
            sub="Input + Output + Reasoning"
            accent={CHART_COLORS[2]}
          />
          <StatCard
            label="问题数"
            value={formatNum(stats.totalQuestions)}
            sub="用户发送的消息数"
            accent={CHART_COLORS[3]}
          />
        </div>

        {/* ── Daily Token Chart ── */}
        <ChartSection title="每日 Token 消耗" sub="每天消耗的模型 token 总量（input + output + reasoning）">
          <ChartWithTable
            option={tokenChartOption()}
            columns={[
              { key: "date", title: language.t("common.date"), align: "left" },
              { key: "tokens", title: "Tokens", align: "right", formatter: formatNum },
            ]}
            data={() =>
              days().map((d, i) => ({
                date: d,
                tokens: dailyTokens()[i] ?? 0,
              }))
            }
          />
        </ChartSection>

        {/* ── Daily Questions & Sessions Chart ── */}
        <ChartSection title="每日问题数与会话数" sub="每天用户发送的消息数（role=user）以及活跃会话数">
          <ChartWithTable
            option={dailyChartOption()}
            columns={[
              { key: "date", title: language.t("common.date"), align: "left" },
              { key: "questions", title: "问题数", align: "right", formatter: formatNum },
              { key: "sessions", title: "会话数", align: "right", formatter: formatNum },
            ]}
            data={() =>
              days().map((d, i) => ({
                date: d,
                questions: dailyQuestions()[i] ?? 0,
                sessions: dailySessions()[i] ?? 0,
              }))
            }
          />
        </ChartSection>

        {/* ── Daily Active Directory Count Chart ── */}
        <ChartSection
          title={language.t("dashboard.dailyDirs.title")}
          sub={language.t("dashboard.dailyDirs.sub")}
        >
          <ChartWithTable
            option={dailyDirChartOption()}
            columns={[
              { key: "date", title: language.t("common.date"), align: "left" },
              { key: "dirs", title: "活跃目录数", align: "right" },
            ]}
            data={() =>
              days().map((d, i) => ({
                date: d,
                dirs: dailyDirCounts()[i] ?? 0,
              }))
            }
          />
        </ChartSection>

        {/* ── Daily Token by ProviderModel Chart ── */}
        <Show when={topDayModels().length > 0}>
          <ChartSection
            title={language.t("dashboard.dayModel.title")}
            sub={language.t("dashboard.dayModel.sub")}
          >
            <ChartWithTable
              option={dayModelChartOption()}
              columns={[
                { key: "date", title: language.t("common.date"), align: "left" },
                { key: "model", title: language.t("dashboard.dayModel.colModel"), align: "left" },
                { key: "input", title: language.t("dashboard.dayModel.colInput"), align: "right", formatter: formatNum },
                { key: "output", title: language.t("dashboard.dayModel.colOutput"), align: "right", formatter: formatNum },
              ]}
              data={dayModelTableRows}
            />
          </ChartSection>
        </Show>

        {/* ── Per-Directory Bar Charts ── */}
        <Show when={dirList().length > 0}>
          <ChartSection
            title="各目录对比 — 会话数 & 问题数"
            sub="各工作目录下的会话数与用户问题数（最多显示 20 个目录，按会话数降序）"
          >
            <EChart option={dirSessionChartOption()} />
          </ChartSection>

          <ChartSection title="各目录对比 — Token 消耗" sub="各工作目录累计消耗的模型 token 数量（最多显示 20 个目录）">
            <EChart option={dirTokenChartOption()} />
          </ChartSection>
        </Show>

        {/* ── Provider/Model Token Chart ── */}
        <Show when={topProviderModels().length > 0}>
          <ChartSection
            title="Provider / Model Token 消耗"
            sub="各模型提供商的 Token 消耗排行（Top 20）"
          >
            <EChart option={providerModelChartOption()} />
          </ChartSection>
        </Show>

        {/* ── Top 20Tables (Side by Side) ── */}
        <Show when={topSessions().length > 0 || topDirs().length > 0}>
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top 20Sessions */}
            <ChartSection title="Top 20会话" sub="Token 消耗最多的会话">
              <div class="overflow-x-auto">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="border-b border-border-weak-base">
                      <th class="text-left py-2 px-2 text-xs font-medium text-text-weak">排名</th>
                      <th class="text-left py-2 px-2 text-xs font-medium text-text-weak">目录</th>
                      <th class="text-left py-2 px-2 text-xs font-medium text-text-weak">会话</th>
                      <th class="text-right py-2 px-2 text-xs font-medium text-text-weak">问题数</th>
                      <th class="text-right py-2 px-2 text-xs font-medium text-text-weak">Token</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={topSessions()}>
                      {(session, index) => (
                        <tr class="border-b border-border-weak-base/50 hover:bg-surface-hover-base">
                          <td class="py-2 px-2 text-text-faint tabular-nums">{index() + 1}</td>
                          <td class="py-2 px-2 text-text-weak truncate max-w-[120px]" title={session.directory}>
                            <A
                              href={`/${base64Encode(session.directory)}`}
                              class="hover:text-text-strong hover:underline"
                              target="_blank"
                            >
                              {shortDir(session.directory)}
                            </A>
                          </td>
                          <td class="py-2 px-2 text-text-strong truncate max-w-[180px]" title={session.title}>
                            <A
                              href={`/${base64Encode(session.directory)}/session/${session.id}`}
                              class="hover:underline text-text-strong"
                              target="_blank"
                            >
                              {session.title}
                            </A>
                          </td>
                          <td class="py-2 px-2 text-right text-text-weak tabular-nums">
                            {session.questions}
                          </td>
                          <td class="py-2 px-2 text-right text-text-strong tabular-nums font-medium">
                            {formatNum(session.tokens)}
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </ChartSection>

            {/* Top 20Directories */}
            <ChartSection title="Top 20目录" sub="Token 消耗最多的工作目录">
              <div class="overflow-x-auto">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="border-b border-border-weak-base">
                      <th class="text-left py-2 px-2 text-xs font-medium text-text-weak">排名</th>
                      <th class="text-left py-2 px-2 text-xs font-medium text-text-weak">目录</th>
                      <th class="text-right py-2 px-2 text-xs font-medium text-text-weak">会话数</th>
                      <th class="text-right py-2 px-2 text-xs font-medium text-text-weak">问题数</th>
                      <th class="text-right py-2 px-2 text-xs font-medium text-text-weak">Token</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={topDirs()}>
                      {(dir, index) => (
                        <tr class="border-b border-border-weak-base/50 hover:bg-surface-hover-base">
                          <td class="py-2 px-2 text-text-faint tabular-nums">{index() + 1}</td>
                          <td class="py-2 px-2 text-text-strong truncate max-w-[200px]" title={dir.dir}>
                            <A
                              href={`/${base64Encode(dir.dir)}`}
                              class="hover:underline"
                              target="_blank"
                            >
                              {shortDir(dir.dir)}
                            </A>
                          </td>
                          <td class="py-2 px-2 text-right text-text-weak tabular-nums">{dir.sessions}</td>
                          <td class="py-2 px-2 text-right text-text-weak tabular-nums">{dir.questions}</td>
                          <td class="py-2 px-2 text-right text-text-strong tabular-nums font-medium">
                            {formatNum(dir.tokens)}
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </ChartSection>

            {/* All Directories */}
            <ChartSection title={language.t("dashboard.allDirs.title")} sub={language.t("dashboard.allDirs.sub")}>
              <div class="overflow-x-auto max-h-[600px]">
                <table class="w-full text-sm">
                  <thead class="sticky top-0 bg-surface-base z-10">
                    <tr class="border-b border-border-weak-base">
                      <th class="text-left py-2 px-2 text-xs font-medium text-text-weak">排名</th>
                      <th class="text-left py-2 px-2 text-xs font-medium text-text-weak">目录</th>
                      <th class="text-right py-2 px-2 text-xs font-medium text-text-weak">会话数</th>
                      <th class="text-right py-2 px-2 text-xs font-medium text-text-weak">问题数</th>
                      <th class="text-right py-2 px-2 text-xs font-medium text-text-weak">Token</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={allDirs()}>
                      {(dir, index) => (
                        <tr class="border-b border-border-weak-base/50 hover:bg-surface-hover-base">
                          <td class="py-2 px-2 text-text-faint tabular-nums">{index() + 1}</td>
                          <td class="py-2 px-2 text-text-strong truncate max-w-[200px]" title={dir.dir}>
                            <A
                              href={`/${base64Encode(dir.dir)}`}
                              class="hover:underline"
                              target="_blank"
                            >
                              {shortDir(dir.dir)}
                            </A>
                          </td>
                          <td class="py-2 px-2 text-right text-text-weak tabular-nums">{dir.sessions}</td>
                          <td class="py-2 px-2 text-right text-text-weak tabular-nums">{dir.questions}</td>
                          <td class="py-2 px-2 text-right text-text-strong tabular-nums font-medium">
                            {formatNum(dir.tokens)}
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </ChartSection>
          </div>

          {/* ── Daily Directory Detail Table ── */}
          <Show when={dailyDirRows().length > 0}>
            <ChartSection
              title={language.t("dashboard.dailyDirDetail.title")}
              sub={language.t("dashboard.dailyDirDetail.sub")}
            >
              <div class="overflow-x-auto max-h-[600px]">
                <table class="w-full text-sm">
                  <thead class="sticky top-0 bg-surface-base z-10">
                    <tr class="border-b border-border-weak-base">
                      <th class="text-left py-2 px-2 text-xs font-medium text-text-weak">{language.t("common.date")}</th>
                      <th class="text-left py-2 px-2 text-xs font-medium text-text-weak">目录</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={dailyDirRows()}>
                      {(row) => (
                        <tr class="border-b border-border-weak-base/50 hover:bg-surface-hover-base">
                          <td class="py-2 px-2 text-text-weak tabular-nums whitespace-nowrap">{row.date}</td>
                          <td class="py-2 px-2 text-text-strong truncate max-w-[400px]" title={row.dir}>
                            <A
                              href={`/${base64Encode(row.dir)}`}
                              class="hover:underline"
                              target="_blank"
                            >
                              {shortDir(row.dir)}
                            </A>
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </ChartSection>
          </Show>
        </Show>

        {/* ── Empty state ── */}
        <Show when={!isLoading() && totalSessions() === 0 && progress().total === 0 && !sessionsRes.loading}>
          <div class="py-20 flex flex-col items-center gap-3 text-text-weak">
            <div class="text-4xl opacity-20">📊</div>
            <div class="text-sm">所选日期范围内暂无数据</div>
            <div class="text-xs text-text-faint">请调整日期范围或检查服务是否正常运行</div>
          </div>
        </Show>
      </div>
    </div>
  )
}
