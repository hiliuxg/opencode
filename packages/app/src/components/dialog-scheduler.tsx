import { Component, createSignal, createResource, For, Show, createMemo, createEffect } from "solid-js"
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
import { useModels } from "@/context/models"
import { ModelSelectorPopover, type ModelState } from "./dialog-select-model"
import {
    getJobs,
    createJob,
    updateJob,
    deleteJob,
    toggleJob,
    runJob,
    getExecutions,
    cronFromSchedule,
    parseCronToSchedule,
    type CronJob,
    type Execution,
    type ScheduleType,
} from "@/utils/admin-api"

const DEFAULT_USER_ID = 1
const DEFAULT_PROVIDER = "tme-conv1-provider"
const DEFAULT_MODEL = "Claude-Sonnet-4.6"


// ── 新建任务 Tab ────────────────────────────────────

function CreateJobTab(props: {
    onCreated: () => void
    workspaceDir: string
    editingJob?: CronJob | null
    onUpdated?: () => void
    onCancelEdit?: () => void
}) {
    const { t } = useLanguage()
    const models = useModels()

    const SCHEDULE_TYPES: { value: ScheduleType; label: string }[] = [
        { value: "hourly", label: t("scheduler.create.frequency.hourly") },
        { value: "daily", label: t("scheduler.create.frequency.daily") },
        { value: "weekly", label: t("scheduler.create.frequency.weekly") },
        { value: "monthly", label: t("scheduler.create.frequency.monthly") },
    ]

    const HOURS = Array.from({ length: 24 }, (_, i) => ({
        value: i,
        label: `${String(i).padStart(2, "0")} ${t("scheduler.create.frequency.hour")}`,
    }))

    const MINUTES = Array.from({ length: 60 }, (_, i) => ({
        value: i,
        label: `${String(i).padStart(2, "0")} ${t("scheduler.create.frequency.minute")}`,
    }))

    const HOUR_INTERVALS = [1, 2, 3, 4, 6, 8, 12].map((v) => ({
        value: v,
        label: t("scheduler.create.frequency.everyHour", { v }),
    }))

    const WEEK_DAYS = [1, 2, 3, 4, 5, 6, 7].map((v) => ({
        value: v,
        label: t(`scheduler.create.frequency.dayOfWeek.${v}` as any),
    }))

    const MONTH_DATES = Array.from({ length: 31 }, (_, i) => ({
        value: i + 1,
        label: `${i + 1} ${t("scheduler.create.frequency.dateOfMonth")}`,
    }))

    const [form, setForm] = createStore({
        name: "",
        scheduleType: "daily" as ScheduleType,
        hourlyInterval: 1,
        hourlyMinute: 0,
        dailyHour: 9,
        dailyMinute: 0,
        weeklyDay: 1,
        weeklyHour: 9,
        weeklyMinute: 0,
        monthlyDate: 1,
        monthlyHour: 9,
        monthlyMinute: 0,
        timezone: "Asia/Shanghai",
        prompt: "",
    })
    const [submitting, setSubmitting] = createSignal(false)
    const [picked, setPicked] = createSignal<{ providerID: string; modelID: string }>({
        providerID: DEFAULT_PROVIDER,
        modelID: DEFAULT_MODEL,
    })

    // Pre-fill form when editingJob changes
    createEffect(() => {
        const job = props.editingJob
        if (!job) return
        const parsed = parseCronToSchedule(job.cronExpression)
        setForm({
            name: job.name,
            scheduleType: parsed.type,
            hourlyInterval: parsed.type === "hourly" ? parsed.interval : 1,
            hourlyMinute: parsed.type === "hourly" ? parsed.minute : 0,
            dailyHour: parsed.type === "daily" ? parsed.hour : 9,
            dailyMinute: parsed.type === "daily" ? parsed.minute : 0,
            weeklyDay: parsed.type === "weekly" ? parsed.day : 1,
            weeklyHour: parsed.type === "weekly" ? parsed.hour : 9,
            weeklyMinute: parsed.type === "weekly" ? parsed.minute : 0,
            monthlyDate: parsed.type === "monthly" ? parsed.date : 1,
            monthlyHour: parsed.type === "monthly" ? parsed.hour : 9,
            monthlyMinute: parsed.type === "monthly" ? parsed.minute : 0,
            timezone: job.timezone ?? "Asia/Shanghai",
            prompt: job.prompt ?? "",
        })
        if (job.config?.providerID && job.config?.modelID) {
            setPicked({ providerID: job.config.providerID, modelID: job.config.modelID })
        }
    })

    const modelState = {
        ready: models.ready,
        current: () => models.find(picked()),
        recent: createMemo(() => []),
        list: models.list,
        cycle: () => {},
        set: (item: { providerID: string; modelID: string } | undefined) => {
            if (item) setPicked({ providerID: item.providerID, modelID: item.modelID })
        },
        visible: (item: { providerID: string; modelID: string }) => models.visible(item),
        setVisibility: () => {},
        variant: {
            configured: () => undefined,
            selected: () => undefined,
            current: () => undefined,
            list: () => [],
            set: () => {},
            cycle: () => {},
        },
    } as unknown as ModelState

    const modelLabel = () => {
        const current = modelState.current()
        if (current) return `${current.provider.name} · ${current.name}`
        return `${picked().providerID} · ${picked().modelID}`
    }

    const buildCron = () => {
        if (form.scheduleType === "hourly") {
            return cronFromSchedule({ type: "hourly", interval: form.hourlyInterval, minute: form.hourlyMinute })
        }
        if (form.scheduleType === "daily") {
            return cronFromSchedule({ type: "daily", hour: form.dailyHour, minute: form.dailyMinute })
        }
        if (form.scheduleType === "weekly") {
            return cronFromSchedule({
                type: "weekly",
                day: form.weeklyDay,
                hour: form.weeklyHour,
                minute: form.weeklyMinute,
            })
        }
        return cronFromSchedule({
            type: "monthly",
            date: form.monthlyDate,
            hour: form.monthlyHour,
            minute: form.monthlyMinute,
        })
    }

    const resetForm = () => {
        setForm({
            name: "",
            scheduleType: "daily",
            hourlyInterval: 1,
            hourlyMinute: 0,
            dailyHour: 9,
            dailyMinute: 0,
            weeklyDay: 1,
            weeklyHour: 9,
            weeklyMinute: 0,
            monthlyDate: 1,
            monthlyHour: 9,
            monthlyMinute: 0,
            timezone: "Asia/Shanghai",
            prompt: "",
        })
        setPicked({ providerID: DEFAULT_PROVIDER, modelID: DEFAULT_MODEL })
    }

    const handleSubmit = async () => {
        if (!form.name.trim() || !form.prompt.trim()) {
            showToast({ title: t("scheduler.create.failed"), description: t("scheduler.create.error.missingFields") })
            return
        }
        setSubmitting(true)
        const job = props.editingJob
        try {
            if (job) {
                await updateJob(String(job.id), {
                    name: form.name,
                    cronExpression: buildCron(),
                    timezone: form.timezone,
                    prompt: form.prompt,
                    config: picked(),
                })
                showToast({ title: t("scheduler.create.updateSuccess") })
                resetForm()
                props.onUpdated?.()
            } else {
                await createJob({
                    userId: DEFAULT_USER_ID,
                    name: form.name,
                    cronExpression: buildCron(),
                    timezone: form.timezone,
                    prompt: form.prompt,
                    workspaceDir: props.workspaceDir,
                    config: picked(),
                })
                showToast({ title: t("scheduler.create.success") })
                resetForm()
                props.onCreated()
            }
        } catch (err: any) {
            const key = job ? "scheduler.create.updateFailed" : "scheduler.create.failed"
            showToast({ title: t(key as any), description: err?.message || "未知错误" })
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div class="flex flex-col gap-5 p-4">
            <div class="flex flex-col gap-2">
                <label class="text-12-medium text-text-strong" for="scheduler-create-name">
                    {t("scheduler.create.name.label")}
                </label>
                <TextField
                    id="scheduler-create-name"
                    placeholder={t("scheduler.create.name.placeholder")}
                    value={form.name}
                    onChange={(v) => setForm("name", v)}
                />
            </div>

            <div class="flex flex-col gap-2">
                <label class="text-12-medium text-text-strong">{t("scheduler.create.model.label")}</label>
                <ModelSelectorPopover model={modelState}>
                    <Button variant="secondary" size="large" class="self-start">
                        {modelLabel()}
                    </Button>
                </ModelSelectorPopover>
            </div>

            <div class="flex flex-col gap-2">
                <label class="text-12-medium text-text-strong">{t("scheduler.create.frequency.label")}</label>
                <div class="flex flex-wrap gap-3">
                    <Select
                        options={SCHEDULE_TYPES}
                        current={SCHEDULE_TYPES.find((s) => s.value === form.scheduleType)}
                        value={(o) => o.value}
                        label={(o) => o.label}
                        onSelect={(o) => o && setForm("scheduleType", o.value)}
                        size="large"
                        variant="secondary"
                    />

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
                        <Select
                            options={MINUTES}
                            current={MINUTES.find((m) => m.value === form.hourlyMinute)}
                            value={(o) => String(o.value)}
                            label={(o) => o.label}
                            onSelect={(o) => o && setForm("hourlyMinute", o.value)}
                            size="large"
                            variant="secondary"
                        />
                    </Show>

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
                        <Select
                            options={MINUTES}
                            current={MINUTES.find((m) => m.value === form.dailyMinute)}
                            value={(o) => String(o.value)}
                            label={(o) => o.label}
                            onSelect={(o) => o && setForm("dailyMinute", o.value)}
                            size="large"
                            variant="secondary"
                        />
                    </Show>

                    <Show when={form.scheduleType === "weekly"}>
                        <Select
                            options={WEEK_DAYS}
                            current={WEEK_DAYS.find((d) => d.value === form.weeklyDay)}
                            value={(o) => String(o.value)}
                            label={(o) => o.label}
                            onSelect={(o) => o && setForm("weeklyDay", o.value)}
                            size="large"
                            variant="secondary"
                        />
                        <Select
                            options={HOURS}
                            current={HOURS.find((h) => h.value === form.weeklyHour)}
                            value={(o) => String(o.value)}
                            label={(o) => o.label}
                            onSelect={(o) => o && setForm("weeklyHour", o.value)}
                            size="large"
                            variant="secondary"
                        />
                        <Select
                            options={MINUTES}
                            current={MINUTES.find((m) => m.value === form.weeklyMinute)}
                            value={(o) => String(o.value)}
                            label={(o) => o.label}
                            onSelect={(o) => o && setForm("weeklyMinute", o.value)}
                            size="large"
                            variant="secondary"
                        />
                    </Show>

                    <Show when={form.scheduleType === "monthly"}>
                        <Select
                            options={MONTH_DATES}
                            current={MONTH_DATES.find((d) => d.value === form.monthlyDate)}
                            value={(o) => String(o.value)}
                            label={(o) => o.label}
                            onSelect={(o) => o && setForm("monthlyDate", o.value)}
                            size="large"
                            variant="secondary"
                        />
                        <Select
                            options={HOURS}
                            current={HOURS.find((h) => h.value === form.monthlyHour)}
                            value={(o) => String(o.value)}
                            label={(o) => o.label}
                            onSelect={(o) => o && setForm("monthlyHour", o.value)}
                            size="large"
                            variant="secondary"
                        />
                        <Select
                            options={MINUTES}
                            current={MINUTES.find((m) => m.value === form.monthlyMinute)}
                            value={(o) => String(o.value)}
                            label={(o) => o.label}
                            onSelect={(o) => o && setForm("monthlyMinute", o.value)}
                            size="large"
                            variant="secondary"
                        />
                    </Show>
                </div>
            </div>

            <div class="flex flex-col gap-2">
                <label class="text-12-medium text-text-strong" for="scheduler-create-prompt">
                    {t("scheduler.create.prompt.label")}
                </label>
                <TextField
                    id="scheduler-create-prompt"
                    placeholder={t("scheduler.create.prompt.placeholder")}
                    value={form.prompt}
                    onChange={(v) => setForm("prompt", v)}
                    multiline
                />
            </div>

            <div class="flex items-center gap-3 self-end">
                <Show when={props.editingJob}>
                    <Button
                        variant="ghost"
                        size="large"
                        onClick={() => {
                            resetForm()
                            props.onCancelEdit?.()
                        }}
                        disabled={submitting()}
                    >
                        {t("scheduler.create.cancelEdit")}
                    </Button>
                </Show>
                <Button
                    variant="primary"
                    size="large"
                    onClick={handleSubmit}
                    disabled={submitting()}
                >
                    <Show when={props.editingJob} fallback={submitting() ? t("scheduler.create.submitting") : t("scheduler.create.submit")}>
                        {submitting() ? t("scheduler.create.updating") : t("scheduler.create.update")}
                    </Show>
                </Button>
            </div>
        </div>
    )
}

// ── 任务列表 Tab ────────────────────────────────────

function JobListTab(props: { refreshKey: () => number; workspaceDir: string; onEdit: (job: CronJob) => void }) {
    const { t } = useLanguage()
    const models = useModels()
    const [filterStatus, setFilterStatus] = createSignal<string>("all")

    const modelLabel = (cfg: CronJob["config"]) => {
        if (!cfg?.providerID || !cfg?.modelID) return null
        const found = models.find({ providerID: cfg.providerID, modelID: cfg.modelID })
        if (found) return { provider: found.provider.name, model: found.name }
        return { provider: cfg.providerID, model: cfg.modelID }
    }

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
                                            <Tooltip value={t("scheduler.jobs.action.edit")}>
                                                <IconButton
                                                    icon="pencil-line"
                                                    variant="ghost"
                                                    onClick={() => props.onEdit(job)}
                                                    size="small"
                                                    aria-label={t("scheduler.jobs.action.edit")}
                                                    class="text-text-weak hover:text-interactive-base hover:bg-interactive-base/10"
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

                                <div class="flex items-center justify-between gap-2 pl-1">
                                    <Show when={job.enabled && job.nextRun}>
                                        <div class="flex items-center gap-1.5 text-11-regular text-text-weak/50">
                                            <Icon name="clock" class="size-3 opacity-40" />
                                            <span>{t("scheduler.jobs.nextRun", { time: new Date(job.nextRun!).toLocaleString() })}</span>
                                        </div>
                                    </Show>
                                    <Show when={!job.enabled || !job.nextRun}>
                                        <div />
                                    </Show>
                                    <Show when={modelLabel(job.config)}>
                                        {(label) => (
                                            <div class="flex items-center gap-1 text-11-regular text-text-weak/50 shrink-0">
                                                <Icon name="brain" class="size-3 opacity-70" />
                                                <span class="text-11-medium leading-none">
                                                    {label().provider} · {label().model}
                                                </span>
                                            </div>
                                        )}
                                    </Show>
                                </div>

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
    const [editingJob, setEditingJob] = createSignal<CronJob | null>(null)
    const [activeTab, setActiveTab] = createSignal("create")

    const handleCreated = () => {
        setRefreshKey((k) => k + 1)
    }

    const handleUpdated = () => {
        setEditingJob(null)
        setRefreshKey((k) => k + 1)
        setActiveTab("jobs")
    }

    const handleEdit = (job: CronJob) => {
        setEditingJob(job)
        setActiveTab("create")
    }

    const handleCancelEdit = () => {
        setEditingJob(null)
    }

    return (
        <Dialog title={t("scheduler.dialog.title")} size="x-large" transition>
            <Tabs value={activeTab()} onChange={setActiveTab} variant="pill" class="h-full">
                <Tabs.List class="px-4 pt-1">
                    <Tabs.Trigger value="create">
                        {editingJob() ? t("scheduler.tab.edit") : t("scheduler.tab.create")}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="jobs">{t("scheduler.tab.jobs")}</Tabs.Trigger>
                    <Tabs.Trigger value="history">{t("scheduler.tab.history")}</Tabs.Trigger>
                </Tabs.List>
                <Tabs.Content value="create" class="no-scrollbar overflow-y-auto">
                    <CreateJobTab
                        onCreated={handleCreated}
                        workspaceDir={props.currentDir}
                        editingJob={editingJob()}
                        onUpdated={handleUpdated}
                        onCancelEdit={handleCancelEdit}
                    />
                </Tabs.Content>
                <Tabs.Content value="jobs" class="no-scrollbar overflow-y-auto">
                    <JobListTab refreshKey={refreshKey} workspaceDir={props.currentDir} onEdit={handleEdit} />
                </Tabs.Content>
                <Tabs.Content value="history" class="no-scrollbar overflow-y-auto">
                    <ExecutionHistoryTab workspaceDir={props.currentDir} />
                </Tabs.Content>
            </Tabs>
        </Dialog>
    )
}
