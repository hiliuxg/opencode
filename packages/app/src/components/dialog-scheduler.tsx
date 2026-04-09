import { Component, createSignal, createResource, For, Show, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Tabs } from "@opencode-ai/ui/tabs"
import { Button } from "@opencode-ai/ui/button"
import { TextField } from "@opencode-ai/ui/text-field"
import { Select } from "@opencode-ai/ui/select"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Switch } from "@opencode-ai/ui/switch"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { showToast } from "@opencode-ai/ui/toast"
import { useLanguage } from "@/context/language"
import {
    getJobs,
    createJob,
    deleteJob,
    toggleJob,
    runJob,
    getExecutions,
    cronFromSchedule,
    type CronJob,
    type Execution,
    type ScheduleType,
} from "@/utils/admin-api"

const DEFAULT_USER_ID = 1
const DEFAULT_PROVIDER = "tme-conv1-provider"
const DEFAULT_MODEL = "Claude-Sonnet-4.6"




// ── 新建任务 Tab ────────────────────────────────────

function CreateJobTab(props: { onCreated: () => void; workspaceDir: string }) {
    const { t } = useLanguage()

    const SCHEDULE_TYPES: { value: ScheduleType; label: string }[] = [
        { value: "daily", label: t("scheduler.create.frequency.daily") },
        { value: "hourly", label: t("scheduler.create.frequency.hourly") },
    ]

    const HOURS = Array.from({ length: 24 }, (_, i) => ({
        value: i,
        label: `${String(i).padStart(2, "0")}:00`,
    }))

    const HOUR_INTERVALS = [1, 2, 3, 4, 6, 8, 12].map((v) => ({
        value: v,
        label: t("scheduler.create.frequency.everyHour", { v }),
    }))

    const [form, setForm] = createStore({
        name: "",
        scheduleType: "daily" as ScheduleType,
        dailyHour: 9,
        hourlyInterval: 1,
        timezone: "Asia/Shanghai",
        prompt: "",
    })
    const [submitting, setSubmitting] = createSignal(false)

    const handleSubmit = async () => {
        if (!form.name.trim() || !form.prompt.trim()) {
            showToast({ title: t("scheduler.create.failed"), description: t("scheduler.create.error.missingFields") })
            return
        }
        setSubmitting(true)
        try {
            const cron =
                form.scheduleType === "daily"
                    ? cronFromSchedule("daily", form.dailyHour)
                    : cronFromSchedule("hourly", form.hourlyInterval)

            await createJob({
                userId: DEFAULT_USER_ID,
                name: form.name,
                cronExpression: cron,
                timezone: form.timezone,
                prompt: form.prompt,
                workspaceDir: props.workspaceDir,
                config: {
                    providerID: DEFAULT_PROVIDER,
                    modelID: DEFAULT_MODEL,
                },
            })
            showToast({ title: t("scheduler.create.success") })
            setForm({ name: "", prompt: "" })
            props.onCreated()
        } catch (err: any) {
            showToast({ title: t("scheduler.create.failed"), description: err?.message || "未知错误" })
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div class="flex flex-col gap-5 p-4">
            {/* 任务名称 */}
            <TextField
                label={t("scheduler.create.name.label")}
                placeholder={t("scheduler.create.name.placeholder")}
                value={form.name}
                onChange={(v) => setForm("name", v)}
            />

            {/* 执行频率 */}
            <div class="flex flex-col gap-2">
                <label class="text-12-medium text-text-strong">{t("scheduler.create.frequency.label")}</label>
                <div class="flex gap-3">
                    <Select
                        options={SCHEDULE_TYPES}
                        current={SCHEDULE_TYPES.find((s) => s.value === form.scheduleType)}
                        value={(o) => o.value}
                        label={(o) => o.label}
                        onSelect={(o) => o && setForm("scheduleType", o.value)}
                        size="large"
                        variant="secondary"
                    />
                    <Show when={form.scheduleType === "daily"}>
                        <Select
                            options={HOURS}
                            current={HOURS.find((h) => h.value === form.dailyHour)}
                            value={(o) => String(o.value)}
                            label={(o) => o.label}
                            onSelect={(o) => o && setForm("dailyHour", o.value)}
                            size="large"
                            variant="secondary"
                        />
                    </Show>
                    <Show when={form.scheduleType === "hourly"}>
                        <Select
                            options={HOUR_INTERVALS}
                            current={HOUR_INTERVALS.find((h) => h.value === form.hourlyInterval)}
                            value={(o) => String(o.value)}
                            label={(o) => o.label}
                            onSelect={(o) => o && setForm("hourlyInterval", o.value)}
                            size="large"
                            variant="secondary"
                        />
                    </Show>
                </div>
            </div>


            <TextField
                label={t("scheduler.create.prompt.label")}
                placeholder={t("scheduler.create.prompt.placeholder")}
                value={form.prompt}
                onChange={(v) => setForm("prompt", v)}
                multiline
            />

            {/* 提交按钮 */}
            <Button
                variant="primary"
                size="large"
                onClick={handleSubmit}
                disabled={submitting()}
                class="self-end"
            >
                {submitting() ? t("scheduler.create.submitting") : t("scheduler.create.submit")}
            </Button>
        </div>
    )
}

// ── 任务列表 Tab ────────────────────────────────────

function JobListTab(props: { refreshKey: () => number; workspaceDir: string }) {
    const { t } = useLanguage()
    const [filterStatus, setFilterStatus] = createSignal<string>("all")

    const STATUS_OPTIONS = [
        { value: "all", label: t("scheduler.jobs.filter.all") },
        { value: "enabled", label: t("scheduler.jobs.filter.enabled") },
        { value: "disabled", label: t("scheduler.jobs.filter.disabled") },
    ]

    const [jobs, { refetch }] = createResource(
        () => props.refreshKey(),
        () => getJobs(String(DEFAULT_USER_ID), props.workspaceDir).catch(() => [] as CronJob[]),
    )

    const filteredJobs = createMemo(() => {
        const list = jobs() ?? []
        const status = filterStatus()
        if (status === "all") return list
        if (status === "enabled") return list.filter((j) => j.enabled)
        if (status === "disabled") return list.filter((j) => !j.enabled)
        return list
    })

    const handleToggle = async (job: CronJob) => {
        try {
            await toggleJob(String(job.id))
            refetch()
        } catch (err: any) {
            showToast({ title: t("common.requestFailed"), description: err?.message })
        }
    }

    const handleRun = async (job: CronJob) => {
        try {
            await runJob(String(job.id))
            showToast({ title: `${t("scheduler.jobs.action.run")}: ${job.name}` })
        } catch (err: any) {
            showToast({ title: t("common.requestFailed"), description: err?.message })
        }
    }

    const handleDelete = async (job: CronJob) => {
        try {
            await deleteJob(String(job.id))
            showToast({ title: `${t("scheduler.jobs.action.delete")}: ${job.name}` })
            refetch()
        } catch (err: any) {
            showToast({ title: t("common.requestFailed"), description: err?.message })
        }
    }

    return (
        <div class="flex flex-col gap-3 p-4">
            {/* 头部过滤与刷新 */}
            <div class="flex items-center gap-3">
                <Select
                    options={STATUS_OPTIONS}
                    current={STATUS_OPTIONS.find((o) => o.value === (filterStatus() || "all"))}
                    value={(o) => o.value}
                    label={(o) => o.label}
                    onSelect={(o) => {
                        setFilterStatus(String(o?.value ?? "all"))
                    }}
                    size="large"
                    variant="secondary"
                />
                <Button variant="ghost" size="normal" onClick={() => refetch()} icon="refresh">
                    {t("scheduler.jobs.refresh")}
                </Button>
            </div>

            <Show
                when={!jobs.loading && (filteredJobs() ?? []).length > 0}
                fallback={
                    <div class="flex items-center justify-center py-12 text-14-regular text-text-weak">
                        {jobs.loading ? t("scheduler.jobs.loading") : t("scheduler.jobs.empty")}
                    </div>
                }
            >
                <div class="flex flex-col gap-2">
                    <For each={filteredJobs()}>
                        {(job) => (
                            <div class="group flex flex-col gap-3 p-4 rounded-xl border border-border-weak bg-surface-base hover:bg-surface-base-hover hover:border-border-strong/40 transition-all duration-300 shadow-sm">
                                {/* Header: Icon + Name/Cron + Actions (Play, Delete, Switch) */}
                                <div class="flex items-center justify-between gap-4">
                                    <div class="flex items-center gap-3 min-w-0">
                                        <div class="size-9 rounded-lg bg-text-strong/[0.03] border border-border-subtle flex items-center justify-center shrink-0 group-hover:bg-text-strong/[0.06] transition-colors">
                                            <Icon name="checklist" size="small" class="text-text-strong opacity-80" />
                                        </div>
                                        <div class="flex flex-col min-w-0">
                                            <div class="text-14-medium text-text-strong truncate leading-tight mb-0.5">
                                                {job.name}
                                            </div>
                                            <div class="flex items-center gap-1.5 text-12-regular text-text-weak/70 font-mono tracking-tighter">
                                                <Icon name="clock" class="size-3 opacity-50" />
                                                {job.cronExpression}
                                            </div>
                                        </div>
                                    </div>
                                    <div class="shrink-0 flex items-center gap-1.5">
                                        <div class="flex items-center gap-0.5 border-r border-border-weak pr-1.5 mr-0.5">
                                            <Tooltip value={t("scheduler.jobs.action.run")}>
                                                <IconButton
                                                    icon="play"
                                                    variant="ghost"
                                                    onClick={() => handleRun(job)}
                                                    size="small"
                                                    aria-label={t("scheduler.jobs.action.run")}
                                                    class="text-text-weak hover:text-green-500 hover:bg-green-500/10"
                                                />
                                            </Tooltip>
                                            <Tooltip value={t("scheduler.jobs.action.delete")}>
                                                <IconButton
                                                    icon="trash"
                                                    variant="ghost"
                                                    onClick={() => handleDelete(job)}
                                                    size="small"
                                                    aria-label={t("scheduler.jobs.action.delete")}
                                                    class="text-text-weak hover:text-red-500 hover:bg-red-500/10"
                                                />
                                            </Tooltip>
                                        </div>
                                        <Tooltip value={job.enabled ? t("scheduler.jobs.action.disable") : t("scheduler.jobs.action.enable")}>
                                            <Switch
                                                checked={job.enabled}
                                                onChange={() => handleToggle(job)}
                                                hideLabel
                                            />
                                        </Tooltip>
                                    </div>
                                </div>

                                {/* Content: Prompt Block */}
                                <div
                                    class="relative pl-3.5 py-1.5 pr-2 transition-colors border-l-2"
                                    classList={{
                                        "border-green-500/50": job.enabled,
                                        "border-border-strong/20": !job.enabled
                                    }}
                                >
                                    <p class="text-13-regular text-text-weak leading-relaxed line-clamp-2 select-text cursor-default group-hover:text-text-strong/90 transition-colors">
                                        {job.prompt}
                                    </p>
                                </div>

                                <Show when={job.enabled && job.nextRun}>
                                    <div class="flex items-center gap-1.5 text-11-regular text-text-weak/50 mt-1 pl-1">
                                        <Icon name="clock" class="size-3 opacity-40" />
                                        <span>{t("scheduler.jobs.nextRun", { time: new Date(job.nextRun!).toLocaleString() })}</span>
                                    </div>
                                </Show>

                            </div>
                        )}
                    </For>
                </div>
            </Show>
        </div>
    )
}

// ── 执行历史 Tab ────────────────────────────────────

function ExecutionHistoryTab(props: { workspaceDir: string }) {
    const { t } = useLanguage()
    const [filterJobId, setFilterJobId] = createSignal<string>("all")
    const [offset, setOffset] = createSignal(0)
    const LIMIT = 20

    const [jobs] = createResource(() => getJobs(String(DEFAULT_USER_ID), props.workspaceDir).catch(() => [] as CronJob[]))

    const jobOptions = createMemo(() => {
        const list = jobs() ?? []
        return [{ value: "all", label: t("scheduler.history.allTasks") }, ...list.map((j) => ({ value: String(j.id), label: j.name }))]
    })

    const [executions, { refetch }] = createResource(
        () => ({ jobId: filterJobId() === "all" ? "" : filterJobId(), offset: offset() }),
        (params) =>
            getExecutions({
                jobId: params.jobId || undefined,
                limit: LIMIT,
                offset: params.offset,
                workspaceDir: props.workspaceDir,
            }).catch(() => [] as Execution[]),
    )

    const jobNameMap = createMemo(() => {
        const m = new Map<string, string>()
        for (const j of jobs() ?? []) m.set(String(j.id), j.name)
        return m
    })

    const statusIcon = (status: string) => {
        if (status === "success") return "✓"
        if (status === "error") return "✗"
        return "⋯"
    }

    const statusColor = (status: string) => {
        if (status === "success") return "text-green-500"
        if (status === "error") return "text-red-400"
        return "text-yellow-500"
    }

    return (
        <div class="flex flex-col gap-3 p-4">
            {/* 过滤 */}
            <div class="flex items-center gap-3">
                <Select
                    options={jobOptions()}
                    current={jobOptions().find((o) => o.value === (filterJobId() || "all"))}
                    value={(o) => o.value}
                    label={(o) => o.label}
                    onSelect={(o) => {
                        setFilterJobId(String(o?.value ?? "all"))
                        setOffset(0)
                    }}
                    size="large"
                    variant="secondary"
                />
                <Button variant="ghost" size="normal" onClick={() => refetch()} icon="refresh">
                    {t("scheduler.jobs.refresh")}
                </Button>
            </div>

            {/* 列表 */}
            <Show
                when={!executions.loading && (executions() ?? []).length > 0}
                fallback={
                    <div class="flex items-center justify-center py-12 text-14-regular text-text-weak">
                        {executions.loading ? t("scheduler.history.loading") : t("scheduler.history.empty")}
                    </div>
                }
            >
                <div class="flex flex-col gap-2">
                    <For each={executions()}>
                        {(exec) => (
                            <div class="group flex flex-col gap-2 p-3 rounded-lg border border-border-weak bg-surface-base hover:bg-surface-base-hover transition-all duration-200">
                                {/* Top row: Status tag + Job Name + Duration */}
                                <div class="flex items-center justify-between gap-3">
                                    <div class="flex items-center gap-2.5 min-w-0">
                                        <div
                                            class="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shrink-0 border"
                                            classList={{
                                                "bg-green-500/10 text-green-600 border-green-500/20": exec.status === "success",
                                                "bg-red-500/10 text-red-600 border-red-500/20": exec.status === "error",
                                                "bg-yellow-500/10 text-yellow-600 border-yellow-500/20": exec.status === "running"
                                            }}
                                        >
                                            {exec.status}
                                        </div>
                                        <span class="text-14-medium text-text-strong truncate">
                                            {jobNameMap().get(String(exec.jobId)) || exec.jobId}
                                        </span>
                                    </div>
                                    <Show when={exec.duration !== undefined}>
                                        <div class="flex items-center gap-1.2 text-12-medium text-text-weak shrink-0 bg-text-strong/[0.03] px-2 py-0.5 rounded-full border border-border-subtle">
                                            <Icon name="clock" class="size-3 opacity-60" />
                                            {t("scheduler.history.duration", { s: (exec.duration! / 1000).toFixed(1) })}
                                        </div>
                                    </Show>
                                </div>

                                {/* Bottom row: Time Details */}
                                <div class="flex items-center justify-between text-11-regular text-text-muted px-0.5">
                                    <div class="flex items-center gap-3">
                                        <div class="flex items-center gap-1">
                                            <span class="opacity-60 uppercase font-bold text-[9px] tracking-tight">{t("scheduler.history.startedAt")}:</span>
                                            <span class="font-mono">{new Date(exec.startedAt).toLocaleString()}</span>
                                        </div>
                                        <Show when={exec.finishedAt}>
                                            <div class="flex items-center gap-1 border-l border-border-weak pl-3">
                                                <span class="opacity-60 uppercase font-bold text-[9px] tracking-tight">{t("scheduler.history.completedAt")}:</span>
                                                <span class="font-mono">{new Date(exec.finishedAt!).toLocaleString()}</span>
                                            </div>
                                        </Show>
                                    </div>
                                    <Show when={exec.error}>
                                        <Tooltip value={exec.error}>
                                            <div class="flex items-center gap-1 text-red-500 max-w-[200px] truncate cursor-help">
                                                <Icon name="circle-ban-sign" size="small" />
                                                <span class="text-[10px] italic">{exec.error}</span>
                                            </div>
                                        </Tooltip>
                                    </Show>
                                </div>
                            </div>
                        )}
                    </For>
                </div>
            </Show>

            {/* 分页 */}
            <Show when={(executions() ?? []).length >= LIMIT}>
                <div class="flex justify-center pt-2">
                    <Button variant="ghost" size="normal" onClick={() => setOffset((p) => p + LIMIT)}>
                        {t("scheduler.history.loadMore")}
                    </Button>
                </div>
            </Show>
        </div>
    )
}

// ── 主 Dialog 组件 ──────────────────────────────────

export const DialogScheduler: Component<{ currentDir: string }> = (props) => {
    const { t } = useLanguage()
    const [refreshKey, setRefreshKey] = createSignal(0)

    const handleCreated = () => {
        setRefreshKey((k) => k + 1)
    }

    return (
        <Dialog title={t("scheduler.dialog.title")} size="x-large" transition>
            <Tabs defaultValue="create" variant="pill" class="h-full">
                <Tabs.List class="px-4 pt-1">
                    <Tabs.Trigger value="create">
                        <Icon name="plus-small" />
                        {t("scheduler.tab.create")}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="jobs">
                        <Icon name="checklist" />
                        {t("scheduler.tab.jobs")}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="history">
                        <Icon name="clock" />
                        {t("scheduler.tab.history")}
                    </Tabs.Trigger>
                </Tabs.List>
                <Tabs.Content value="create" class="no-scrollbar overflow-y-auto">
                    <CreateJobTab onCreated={handleCreated} workspaceDir={props.currentDir} />
                </Tabs.Content>
                <Tabs.Content value="jobs" class="no-scrollbar overflow-y-auto">
                    <JobListTab refreshKey={refreshKey} workspaceDir={props.currentDir} />
                </Tabs.Content>
                <Tabs.Content value="history" class="no-scrollbar overflow-y-auto">
                    <ExecutionHistoryTab workspaceDir={props.currentDir} />
                </Tabs.Content>
            </Tabs>
        </Dialog>
    )
}
