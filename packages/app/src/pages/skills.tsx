import { createResource, createEffect, For, Show, Suspense, createSignal, onCleanup } from "solid-js"
import { A, useNavigate, useParams } from "@solidjs/router"
import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { decode64 } from "@/utils/base64"
import { base64Encode } from "@opencode-ai/util/encode"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import { Tooltip } from "@opencode-ai/ui/tooltip"

export default function SkillsPage() {
    const params = useParams()
    const globalSDK = useGlobalSDK()
    const language = useLanguage()
    const navigate = useNavigate()
    const currentDir = () => decode64(params.dir)

    const [activeTab, setActiveTab] = createSignal<"local" | "hub">("local")
    const [uploadModalOpen, setUploadModalOpen] = createSignal(false)
    const [selectedSkill, setSelectedSkill] = createSignal<any>(null)
    const [uploadCatalog, setUploadCatalog] = createSignal("AIK")
    const [isUploading, setIsUploading] = createSignal(false)

    // KB Skill States
    const [kbModalOpen, setKbModalOpen] = createSignal(false)
    const [kbEngine, setKbEngine] = createSignal("presto")
    const [kbCluster, setKbCluster] = createSignal("bi-cloud")
    const [kbTables, setKbTables] = createSignal<string[]>([])
    const [kbTableInput, setKbTableInput] = createSignal("")
    const [kbCatalog, setKbCatalog] = createSignal("AIK")
    const [kbPurpose, setKbPurpose] = createSignal("")

    // Local Skills Resource — 通过 GET /skill 调用后端 Skill.state() 懒加载缓存
    const [skills, { refetch: refetchLocal }] = createResource(async () => {
        const dir = currentDir()
        if (!dir) return []
        try {
            const response = await globalSDK.client.app.skills({ directory: dir })
            const allSkills = response.data ?? []
            return allSkills.filter((s: any) => s.name !== "ui-ux-pro-max" && s.name !== "skill-creator")
        } catch (e) {
            console.warn("Failed to list skills", e)
            return []
        }
    })

    // Hub Skills Resource
    const [hubSkills, { refetch: refetchHub }] = createResource(async () => {
        try {
            const { getSkills } = await import("@/utils/admin-api")
            return await getSkills()
        } catch (e) {
            console.error("Failed to fetch hub skills", e)
            return []
        }
    })

    const handleRefresh = async () => {
        const dir = currentDir()
        if (!dir) return
        await globalSDK.client.instance.dispose({ directory: dir }).catch(() => undefined)
        await refetchLocal()
    }

    const handleCreate = () => {
        const dir = currentDir()
        if (!dir) return

        const promptString = language.t("skills.creator.prompt") + "\n"
        sessionStorage.setItem("opencode.handoff.prompt", promptString)

        const href = `/${base64Encode(dir)}/session`
        navigate(href)
    }

    const handleEdit = (skill: any) => {
        const dir = currentDir()
        if (!dir) return

        const promptString = `@${skill.location.replace((dir + "/"), "")} `
        sessionStorage.setItem("opencode.handoff.prompt", promptString)
        sessionStorage.setItem("opencode.handoff.action", "edit-skill")
        sessionStorage.setItem("opencode.handoff.file", skill.location)

        const href = `/${base64Encode(dir)}/session`
        navigate(href)
    }

    const handleDelete = async (e: Event, skill: any) => {
        e.stopPropagation()
        const dir = currentDir()
        if (!dir) return

        if (!confirm(language.t("skills.delete.confirm", { name: skill.name }))) return

        const skillDir = skill.location.split("/").slice(0, -1).join("/")

        try {
            await globalSDK.client.pty.create({
                directory: dir,
                command: "rm",
                args: ["-rf", skillDir],
                cwd: dir,
            })
            // 清空后端 Skill.state() 缓存，让下次 GET /skill 重新扫描磁盘
            await globalSDK.client.instance.dispose({ directory: dir }).catch(() => undefined)
            showToast({
                title: language.t("skills.delete.success.title"),
                description: language.t("skills.delete.success.description", { name: skill.name })
            })
            refetchLocal()
        } catch (err: any) {
            showToast({
                title: language.t("skills.delete.failed.title"),
                description: err?.message,
                variant: "error"
            })
        }
    }

    const [isDownloadingId, setIsDownloadingId] = createSignal<number | null>(null)

    /** 轮询 pty.get() 直到进程退出（返回 404 或 status=exited） */
    const pollPtyUntilDone = (ptyId: string, timeout = 60000): Promise<void> => {
        return new Promise((resolve, reject) => {
            const start = Date.now()
            const timer = setInterval(async () => {
                if (Date.now() - start > timeout) {
                    clearInterval(timer)
                    reject(new Error("Timeout"))
                    return
                }
                try {
                    const result = await globalSDK.client.pty.get({ ptyID: ptyId, directory: currentDir() })
                    if (!result?.data || (result.data as any).status === "exited") {
                        clearInterval(timer)
                        resolve()
                    }
                } catch {
                    // 404 = 进程已退出并被清理
                    clearInterval(timer)
                    resolve()
                }
            }, 500)
        })
    }

    const openUploadModal = (e: Event, skill: any) => {
        e.stopPropagation()
        setSelectedSkill(skill)
        setUploadModalOpen(true)
    }

    const handleUpload = async () => {
        const skill = selectedSkill()
        const dir = currentDir()
        if (!skill || !dir) return

        setIsUploading(true)
        try {
            const { getAdminUrl, getAdminConfig } = await import("@/utils/admin-api")
            const { skillSyncScript } = await getAdminConfig()
            const skillDir = skill.location.split("/").slice(0, -1).join("/")

            const info = await globalSDK.client.pty.create({
                directory: dir,
                command: "bash",
                args: [skillSyncScript, "upload", getAdminUrl(), skillDir, "leoliu", uploadCatalog()],
                cwd: dir,
            })
            await pollPtyUntilDone(info.data!.id)

            showToast({
                title: language.t("skills.upload.success.title"),
                description: language.t("skills.upload.success.description", { name: skill.name })
            })
            setUploadModalOpen(false)
            refetchHub()

        } catch (e: any) {
            console.error(e)
            showToast({ title: language.t("skills.upload.failed.title"), description: e.message, variant: "error" })
        } finally {
            setIsUploading(false)
        }
    }

    const handleKbTableKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Enter" && kbTableInput().trim()) {
            e.preventDefault()
            const newTable = kbTableInput().trim()
            if (!kbTables().includes(newTable)) {
                setKbTables([...kbTables(), newTable])
            }
            setKbTableInput("")
        }
    }

    const handleKbTableRemove = (tableToRemove: string) => {
        setKbTables(kbTables().filter(t => t !== tableToRemove))
    }

    const handleKbSubmit = () => {
        if (kbTables().length === 0) {
            showToast({
                title: language.t("common.requestFailed"),
                description: language.t("skills.kb.form.tables.empty"),
                variant: "error"
            })
            return
        }

        const dir = currentDir()
        if (!dir) return

        const promptString = language.t("skills.kb.creator.prompt", {
            engine: kbEngine(),
            cluster: kbCluster(),
            tables: kbTables().join(", "),
            catalog: kbCatalog(),
            purpose: kbPurpose()
        }) + "\n"
        sessionStorage.setItem("opencode.handoff.prompt", promptString)

        const href = `/${base64Encode(dir)}/session`
        navigate(href)

        setKbModalOpen(false)
    }

    const handleDownload = async (e: Event, skill: any) => {
        e.stopPropagation()
        const dir = currentDir()
        if (!dir) return

        setIsDownloadingId(skill.id)
        try {
            const { getAdminUrl, getAdminConfig } = await import("@/utils/admin-api")
            const { skillSyncScript } = await getAdminConfig()
            const downloadUrl = `${getAdminUrl()}/api/skills/${skill.id}/download`
            const targetDir = `${dir}/.opencode/skills`

            const info = await globalSDK.client.pty.create({
                directory: dir,
                command: "bash",
                args: [skillSyncScript, "download", downloadUrl, targetDir],
                cwd: dir,
            })
            await pollPtyUntilDone(info.data!.id)

            // refetch local and clean cache
            await handleRefresh()

            showToast({
                title: language.t("skills.download.success.title"),
                description: language.t("skills.download.success.description", { name: skill.name })
            })

        } catch (e: any) {
            console.error(e)
            showToast({ title: language.t("skills.download.failed.title"), description: e.message, variant: "error" })
        } finally {
            setIsDownloadingId(null)
        }
    }

    return (
        <div class="flex flex-col size-full bg-background-base">
            <div class="flex items-center justify-between px-6 py-4 border-b border-border-weak-base">
                <div class="flex items-center gap-4">
                    <h1 class="text-20-medium text-text-strong">{language.t("skills.title")}</h1>
                    <div class="flex bg-surface-base rounded-lg p-1 border border-border-weak-base">
                        <button
                            class={`px-3 py-1 rounded-md text-14-medium transition-colors ${activeTab() === "local"
                                ? "bg-element-active text-text-strong shadow-sm"
                                : "text-text-base hover:text-text-strong"
                                }`}
                            onClick={() => setActiveTab("local")}
                        >
                            {language.t("skills.tab.local")}
                        </button>
                        <button
                            class={`px-3 py-1 rounded-md text-14-medium transition-colors ${activeTab() === "hub"
                                ? "bg-element-active text-text-strong shadow-sm"
                                : "text-text-base hover:text-text-strong"
                                }`}
                            onClick={() => setActiveTab("hub")}
                        >
                            {language.t("skills.tab.hub")}
                        </button>
                    </div>
                </div>
                <Show when={activeTab() === "local"}>
                    <div class="flex items-center gap-2">
                        <Button
                            variant="secondary"
                            onClick={handleRefresh}
                        >
                            <div class="flex items-center gap-2">
                                {language.t("skills.refresh")}
                            </div>
                        </Button>
                        <Button variant="secondary" onClick={() => setKbModalOpen(true)}>
                            {language.t("skills.kb.create")}
                        </Button>
                        <Button variant="primary" onClick={handleCreate}>
                            {language.t("skills.create")}
                        </Button>
                    </div>
                </Show>
                <Show when={activeTab() === "hub"}>
                    <div class="flex items-center gap-2">
                        <Button
                            variant="secondary"
                            onClick={() => refetchHub()}
                        >
                            <div class="flex items-center gap-2">
                                {language.t("skills.refresh")}
                            </div>
                        </Button>
                    </div>
                </Show>
            </div>

            <div class="flex-1 overflow-y-auto p-6">
                <Show when={activeTab() === "local"}>
                    <Suspense fallback={<div class="flex justify-center p-8">{language.t("common.loading")}</div>}>
                        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            <For each={skills()}>
                                {(skill) => (
                                    <div class="group flex flex-col gap-2 p-4 rounded-lg border border-border-weak-base bg-surface-base hover:bg-surface-base-hover transition-colors">
                                        <div class="flex items-center justify-between gap-2">
                                            <div class="flex items-center gap-2">
                                                <Icon name="knowledge-base" class="size-5 text-icon-base" />
                                                <span class="text-16-medium text-text-strong">{skill.name}</span>
                                            </div>
                                            <div class="flex items-center gap-1">
                                                <Tooltip value={language.t("skills.upload.submit")}>
                                                    <IconButton
                                                        icon="arrow-up"
                                                        variant="ghost"
                                                        size="small"
                                                        class="text-text-weak hover:text-text-strong transition-colors"
                                                        onClick={(e) => openUploadModal(e, skill)}
                                                    />
                                                </Tooltip>
                                                <Tooltip value={language.t("common.edit")}>
                                                    <IconButton
                                                        icon="edit"
                                                        variant="ghost"
                                                        size="small"
                                                        class="text-text-weak hover:text-text-strong transition-colors"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            handleEdit(skill)
                                                        }}
                                                    />
                                                </Tooltip>
                                                <Tooltip value={language.t("common.delete")}>
                                                    <IconButton
                                                        icon="trash"
                                                        variant="ghost"
                                                        size="small"
                                                        class="text-text-weak hover:text-negative-base transition-colors"
                                                        onClick={(e) => handleDelete(e, skill)}
                                                    />
                                                </Tooltip>
                                            </div>
                                        </div>
                                        <div class="text-14-regular text-text-base line-clamp-2">
                                            {skill.description}
                                        </div>
                                    </div>
                                )}
                            </For>
                            <Show when={skills()?.length === 0}>
                                <div class="col-span-full flex flex-col items-center justify-center p-12 text-text-weak">
                                    <Icon name="knowledge-base" class="size-12 mb-4 opacity-50" />
                                    <p>{language.t("skills.empty")}</p>
                                </div>
                            </Show>
                        </div>
                    </Suspense>
                </Show>

                <Show when={activeTab() === "hub"}>
                    <Suspense fallback={<div class="flex justify-center p-8">{language.t("common.loading")}</div>}>
                        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            <For each={hubSkills()}>
                                {(skill) => (
                                    <div class="group flex flex-col gap-2 p-4 rounded-lg border border-border-weak-base bg-surface-base hover:bg-surface-base-hover transition-colors">
                                        <div class="flex items-center justify-between gap-2">
                                            <div class="flex items-center gap-2">
                                                <Icon name="knowledge-base" class="size-5 text-icon-base" />
                                                <span class="text-16-medium text-text-strong">{skill.name}</span>
                                            </div>
                                            <div class="flex items-center gap-2">
                                                <span class="text-12-medium px-2 py-0.5 rounded-full bg-element-base text-text-base">
                                                    {skill.catalog}
                                                </span>
                                                <div class="flex items-center gap-1">
                                                    <Tooltip value={language.t("skills.download")}>
                                                        <div class="relative">
                                                            <IconButton
                                                                icon="download"
                                                                variant="ghost"
                                                                size="small"
                                                                class="text-text-weak hover:text-text-strong transition-colors relative z-10"
                                                                disabled={isDownloadingId() === skill.id}
                                                                onClick={(e) => handleDownload(e, skill)}
                                                            />
                                                            <Show when={isDownloadingId() === skill.id}>
                                                                <div class="absolute inset-0 m-auto size-4 border-2 border-text-weak border-t-text-strong rounded-full animate-spin z-0 pointer-events-none" />
                                                            </Show>
                                                        </div>
                                                    </Tooltip>
                                                </div>
                                            </div>
                                        </div>
                                        <div class="text-14-regular text-text-base line-clamp-2">
                                            {skill.description}
                                        </div>
                                        <div class="mt-2 flex items-center justify-between text-12-regular text-text-weak border-t border-border-weak-base pt-2">
                                            <span>v{skill.latestVersion}</span>
                                            <span>{new Date(skill.updatedAt).toLocaleDateString()}</span>
                                        </div>
                                    </div>
                                )}
                            </For>
                            <Show when={hubSkills()?.length === 0}>
                                <div class="col-span-full flex flex-col items-center justify-center p-12 text-text-weak">
                                    <Icon name="knowledge-base" class="size-12 mb-4 opacity-50" />
                                    <p>No skills in Hub yet.</p>
                                </div>
                            </Show>
                        </div>
                    </Suspense>
                </Show>
            </div>

            {/* Upload Modal */}
            <Show when={uploadModalOpen()}>
                <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm shadow-xl" onClick={() => setUploadModalOpen(false)}>
                    <div class="w-full max-w-md bg-background-base rounded-xl border border-border-weak-base shadow-md p-6" onClick={(e) => e.stopPropagation()}>
                        <div class="flex items-center gap-3 mb-6 border-b border-border-weak-base pb-4">
                            <div class="flex items-center justify-center size-10 rounded-full bg-element-base text-icon-base shadow-sm">
                                <Icon name="knowledge-base" class="size-5" />
                            </div>
                            <div>
                                <h2 class="text-16-medium text-text-strong">{language.t("skills.upload.title", { name: selectedSkill()?.name })}</h2>
                                <p class="text-13-regular text-text-weak mt-1 line-clamp-1">{selectedSkill()?.description}</p>
                            </div>
                        </div>

                        <div class="mb-6">
                            <label class="block text-14-medium text-text-strong mb-3">{language.t("skills.upload.catalog")}</label>
                            <div class="flex flex-wrap gap-2">
                                {["AIK", "会员", "长音频", "规模", "直播"].map((cat) => (
                                    <button
                                        class={`px-4 py-2 rounded-lg text-14-medium border transition-all ${uploadCatalog() === cat
                                            ? "bg-element-active border-element-active text-text-strong shadow-sm"
                                            : "bg-surface-base border-border-weak-base text-text-base hover:border-element-active hover:text-text-strong"
                                            }`}
                                        onClick={() => setUploadCatalog(cat)}
                                    >
                                        {cat}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div class="flex justify-end gap-3 pt-4 border-t border-border-weak-base">
                            <Button variant="ghost" onClick={() => setUploadModalOpen(false)} disabled={isUploading()}>
                                {language.t("common.cancel")}
                            </Button>
                            <Button variant="primary" onClick={handleUpload} disabled={isUploading()}>
                                {isUploading() ? language.t("skills.upload.uploading") : language.t("skills.upload.submit")}
                            </Button>
                        </div>
                    </div>
                </div>
            </Show>

            <Show when={kbModalOpen()}>
                <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm shadow-xl" onClick={() => setKbModalOpen(false)}>
                    <div class="w-full max-w-lg bg-background-base rounded-xl border border-border-weak-base shadow-md p-6" onClick={(e) => e.stopPropagation()}>
                        <div class="flex items-center justify-between mb-6 border-b border-border-weak-base pb-4">
                            <h2 class="text-16-medium text-text-strong">{language.t("skills.kb.form.title")}</h2>
                            <IconButton
                                icon="close"
                                variant="ghost"
                                size="small"
                                class="text-text-weak hover:text-text-strong transition-colors"
                                onClick={() => setKbModalOpen(false)}
                            />
                        </div>

                        <div class="flex flex-col gap-4 mb-6">
                            <div>
                                <label class="block text-14-medium text-text-strong mb-2">{language.t("skills.kb.form.catalog")}</label>
                                <div class="flex flex-wrap gap-2">
                                    {["AIK", "会员", "长音频", "规模", "直播"].map((cat) => (
                                        <button
                                            class={`px-4 py-2 rounded-lg text-14-medium border transition-all ${kbCatalog() === cat
                                                ? "bg-element-active border-element-active text-text-strong shadow-sm"
                                                : "bg-surface-base border-border-weak-base text-text-base hover:border-element-active hover:text-text-strong"
                                                }`}
                                            onClick={() => setKbCatalog(cat)}
                                        >
                                            {cat}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label class="block text-14-medium text-text-strong mb-2">{language.t("skills.kb.form.purpose")}</label>
                                <textarea
                                    class="w-full h-20 px-3 py-2 bg-surface-base border border-border-weak-base rounded-md text-14-regular text-text-strong focus:border-element-active focus:outline-none resize-none select-text"
                                    placeholder={language.t("skills.kb.form.purpose.placeholder")}
                                    value={kbPurpose()}
                                    onInput={(e) => setKbPurpose(e.target.value)}
                                />
                            </div>

                            <div>
                                <label class="block text-14-medium text-text-strong mb-2">{language.t("skills.kb.form.engine")}</label>
                                <select
                                    class="w-full h-10 px-3 bg-surface-base border border-border-weak-base rounded-md text-14-regular text-text-strong focus:border-element-active focus:outline-none"
                                    value={kbEngine()}
                                    onChange={(e) => setKbEngine(e.target.value)}
                                >
                                    <option value="presto">{language.t("skills.kb.form.engine.presto")}</option>
                                    <option value="clickhouse">{language.t("skills.kb.form.engine.clickhouse")}</option>
                                    <option value="starrocks">{language.t("skills.kb.form.engine.starrocks")}</option>
                                </select>
                            </div>

                            <div>
                                <label class="block text-14-medium text-text-strong mb-2">{language.t("skills.kb.form.cluster")}</label>
                                <select
                                    class="w-full h-10 px-3 bg-surface-base border border-border-weak-base rounded-md text-14-regular text-text-strong focus:border-element-active focus:outline-none"
                                    value={kbCluster()}
                                    onChange={(e) => setKbCluster(e.target.value)}
                                >
                                    <option value="bi-cloud">{language.t("skills.kb.form.cluster.bi-cloud")}</option>
                                    <option value="quku">{language.t("skills.kb.form.cluster.quku")}</option>
                                    <option value="newsong">{language.t("skills.kb.form.cluster.newsong")}</option>
                                    <option value="bi-ssc">{language.t("skills.kb.form.cluster.bi-ssc")}</option>
                                    <option value="recommend">{language.t("skills.kb.form.cluster.recommend")}</option>
                                    <option value="olap">{language.t("skills.kb.form.cluster.olap")}</option>
                                    <option value="realtime">{language.t("skills.kb.form.cluster.realtime")}</option>
                                    <option value="fx">{language.t("skills.kb.form.cluster.fx")}</option>
                                </select>
                            </div>

                            <div>
                                <label class="block text-14-medium text-text-strong mb-2">{language.t("skills.kb.form.tables")}</label>
                                <div class="flex flex-col gap-2">
                                    <input
                                        type="text"
                                        class="w-full h-10 px-3 bg-surface-base border border-border-weak-base rounded-md text-14-regular text-text-strong focus:border-element-active focus:outline-none"
                                        placeholder={language.t("skills.kb.form.tables.placeholder")}
                                        value={kbTableInput()}
                                        onInput={(e) => setKbTableInput(e.target.value)}
                                        onKeyDown={handleKbTableKeyDown}
                                    />
                                    <Show when={kbTables().length > 0}>
                                        <div class="flex flex-wrap gap-2 mt-2">
                                            <For each={kbTables()}>
                                                {(table) => (
                                                    <span class="inline-flex items-center gap-1 px-2 py-1 bg-element-base text-text-strong text-12-medium rounded-md">
                                                        {table}
                                                        <IconButton
                                                            icon="close"
                                                            size="small"
                                                            variant="ghost"
                                                            class="!size-4 !min-w-4 text-text-weak hover:text-text-strong"
                                                            onClick={() => handleKbTableRemove(table)}
                                                        />
                                                    </span>
                                                )}
                                            </For>
                                        </div>
                                    </Show>
                                </div>
                            </div>
                        </div>

                        <div class="flex justify-end gap-3 pt-4 border-border-weak-base">
                            <Button variant="ghost" onClick={() => setKbModalOpen(false)}>
                                {language.t("common.cancel")}
                            </Button>
                            <Button variant="primary" onClick={handleKbSubmit}>
                                {language.t("common.submit")}
                            </Button>
                        </div>
                    </div>
                </div>
            </Show>
        </div>
    )
}
