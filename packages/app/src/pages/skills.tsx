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

    const [uploadModalOpen, setUploadModalOpen] = createSignal(false)
    const [selectedSkill, setSelectedSkill] = createSignal<any>(null)
    const [uploadCatalog, setUploadCatalog] = createSignal("AIK")
    const [isUploading, setIsUploading] = createSignal(false)

    // Git Clone States
    const [gitModalOpen, setGitModalOpen] = createSignal(false)
    const [gitUrl, setGitUrl] = createSignal("")
    const [isCloning, setIsCloning] = createSignal(false)

    // Pull/Refresh Skill State
    const [isPullingSkill, setIsPullingSkill] = createSignal<string | null>(null)
    const [isPublishingSkill, setIsPublishingSkill] = createSignal<string | null>(null)

    // Publish Dialog State
    const [publishModalOpen, setPublishModalOpen] = createSignal(false)
    const [publishSkill, setPublishSkill] = createSignal<any>(null)
    const [publishCommitMsg, setPublishCommitMsg] = createSignal("")
    const [publishSuccessOpen, setPublishSuccessOpen] = createSignal(false)
    const [publishBranchUrl, setPublishBranchUrl] = createSignal("")

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


    const handleRefresh = async () => {
        const dir = currentDir()
        if (!dir) return
        await globalSDK.client.instance.dispose({ directory: dir }).catch(() => undefined)
        await refetchLocal()
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
  
    const handlePublishSkill = (e: Event, skill: any) => {
        e.stopPropagation()
        setPublishSkill(skill)
        setPublishCommitMsg("")
        setPublishModalOpen(true)
    }

    const handleConfirmPublish = async () => {
        const skill = publishSkill()
        const msg = publishCommitMsg().trim()
        if (!skill || !msg) return

        const dir = currentDir()
        if (!dir) return

        let account = ""
        if (dir.startsWith("/home/")) {
            account = dir.split("/")[2]
        } else if (dir.startsWith("/Users/leoliu/myroom/")) {
            account = dir.split("/")[4]
        }
        if (!account) {
            showToast({ title: language.t("common.error.title"), description: language.t("common.error.noAccount"), variant: "error" })
            return
        }

        const skillPath = skill.location.split("/").slice(0, -1).join("/")
        setPublishModalOpen(false)
        setIsPublishingSkill(skill.name)
        try {
            const res = await fetch(`${globalSDK.url}/skill/publish?directory=${encodeURIComponent(dir)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ directory: dir, name: account, skillPath, commitMessage: msg }),
            })
            if (!res.ok) {
                const text = await res.text().catch(() => res.statusText)
                throw new Error(text)
            }
            const data = await res.json()
            if (data.status === "no-git") {
                setSelectedSkill(skill)
                setUploadModalOpen(true)
            } else if (data.status === "no-changes") {
                showToast({ title: language.t("skills.push.noChanges.title"), description: language.t("skills.push.noChanges.description"), variant: "error" })
            } else if (data.status === "pushed") {
                const url = data.branchUrl
                if (url) {
                    setPublishBranchUrl(url)
                    setPublishSuccessOpen(true)
                    showToast({ title: language.t("skills.push.success.title"), description: language.t("skills.push.success.description") })
                } else {
                    showToast({ title: language.t("skills.push.success.title"), description: language.t("skills.push.success.descriptionWithName", { name: skill.name }) })
                }
            }
        } catch (err: any) {
            console.error(err)
            showToast({ title: language.t("skills.push.failed.title"), description: err.message, variant: "error" })
        } finally {
            setIsPublishingSkill(null)
        }
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

    const handlePullSkill = async (e: Event, skill: any) => {
        e.stopPropagation()
        const dir = currentDir()
        if (!dir) return

        let account = ""
        if (dir.startsWith("/home/")) {
            account = dir.split("/")[2]
        } else if (dir.startsWith("/Users/leoliu/myroom/myskill-creator")) {
            account = 'xiaogenliu'
        }
        if (!account) {
            showToast({ title: language.t("common.error.title"), description: language.t("common.error.noAccount"), variant: "error" })
            return
        }

        if (!confirm(language.t("skills.pull.confirm"))) return

        const skillDir = skill.location.split("/").slice(0, -1).join("/")
        setIsPullingSkill(skill.name)
        try {
            const res = await fetch(`${globalSDK.url}/skill/pull?directory=${encodeURIComponent(dir)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ directory: dir, name: account, skillDir }),
            })
            if (!res.ok) {
                const text = await res.text().catch(() => res.statusText)
                throw new Error(text)
            }
            await handleRefresh()
            showToast({ title: language.t("skills.pull.success.title"), description: language.t("skills.pull.success.description", { name: skill.name }) })
        } catch (err: any) {
            console.error(err)
            showToast({ title: language.t("skills.pull.failed.title"), description: err.message, variant: "error" })
        } finally {
            setIsPullingSkill(null)
        }
    }

    const handleGitClone = async () => {
        const dir = currentDir()
        const url = gitUrl().trim()
        if (!dir || !url) return

        let account = ""
        if (dir.startsWith("/home/")) {
            account = dir.split("/")[2]
        } else if (dir.startsWith("/Users/leoliu/myroom/")) {
            account = dir.split("/")[4]
        }
        if (!account) {
            showToast({ title: language.t("common.error.title"), description: language.t("common.error.noAccount"), variant: "error" })
            return
        }

        setIsCloning(true)
        try {
            const res = await fetch(`${globalSDK.url}/skill/clone?directory=${encodeURIComponent(dir)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ directory: dir, name: account, gitUrl: url }),
            })
            if (!res.ok) {
                const text = await res.text().catch(() => res.statusText)
                throw new Error(text)
            }
            setGitModalOpen(false)
            setGitUrl("")
            await handleRefresh()
            showToast({ title: language.t("skills.gitClone.success.title"), description: language.t("skills.gitClone.success.description") })
        } catch (e: any) {
            console.error(e)
            showToast({ title: language.t("skills.gitClone.failed.title"), description: e.message, variant: "error" })
        } finally {
            setIsCloning(false)
        }
    }

    return (
        <div class="flex flex-col size-full bg-background-base">
            <div class="flex items-center justify-between px-6 py-4 border-b border-border-weak-base">
                <h1 class="text-20-medium text-text-strong">{language.t("skills.title")}</h1>
                <div class="flex items-center gap-2">
                    <Button
                        variant="secondary"
                        onClick={handleRefresh}
                    >
                        <div class="flex items-center gap-2">
                            {language.t("skills.refresh")}
                        </div>
                    </Button>
                    <Button variant="secondary" onClick={() => setGitModalOpen(true)}>
                        {language.t("skills.gitClone.button")}
                    </Button>
                    <Button variant="primary" onClick={() => setKbModalOpen(true)}>
                        {language.t("skills.kb.create")}
                    </Button>
                </div>
            </div>

            <div class="flex-1 overflow-y-auto p-6">
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
                                                <Tooltip value={language.t("skills.pull.tooltip")}>
                                                    <div class="relative">
                                                        <IconButton
                                                            icon="download"
                                                            variant="ghost"
                                                            size="small"
                                                            class="text-text-weak hover:text-text-strong transition-colors"
                                                            disabled={isPullingSkill() === skill.name}
                                                            onClick={(e) => handlePullSkill(e, skill)}
                                                        />
                                                        <Show when={isPullingSkill() === skill.name}>
                                                            <div class="absolute inset-0 m-auto size-4 border-2 border-text-weak border-t-text-strong rounded-full animate-spin pointer-events-none" />
                                                        </Show>
                                                    </div>
                                                </Tooltip>
                                                <Tooltip value={language.t("skills.upload.submit")}>
                                                    <div class="relative">
                                                        <IconButton
                                                            icon="arrow-up"
                                                            variant="ghost"
                                                            size="small"
                                                            class="text-text-weak hover:text-text-strong transition-colors"
                                                            disabled={isPublishingSkill() === skill.name}
                                                            onClick={(e) => handlePublishSkill(e, skill)}
                                                        />
                                                        <Show when={isPublishingSkill() === skill.name}>
                                                            <div class="absolute inset-0 m-auto size-4 border-2 border-text-weak border-t-text-strong rounded-full animate-spin pointer-events-none" />
                                                        </Show>
                                                    </div>
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

            {/* Git Clone Modal */}
            <Show when={gitModalOpen()}>
                <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm shadow-xl" onClick={() => setGitModalOpen(false)}>
                    <div class="w-full max-w-md bg-background-base rounded-xl border border-border-weak-base shadow-md p-6" onClick={(e) => e.stopPropagation()}>
                        <div class="flex items-center gap-3 mb-6 border-b border-border-weak-base pb-4">
                            <div class="flex items-center justify-center size-10 rounded-full bg-element-base text-icon-base shadow-sm">
                                <Icon name="download" class="size-5" />
                            </div>
                            <div>
                                <h2 class="text-16-medium text-text-strong">{language.t("skills.gitClone.modal.title")}</h2>
                                <p class="text-13-regular text-text-weak mt-1">{language.t("skills.gitClone.modal.description")}</p>
                            </div>
                        </div>

                        <div class="mb-6">
                            <label class="block text-14-medium text-text-strong mb-2">{language.t("skills.gitClone.modal.urlLabel")}</label>
                            <input
                                type="text"
                                class="w-full h-10 px-3 bg-surface-base border border-border-weak-base rounded-md text-14-regular text-text-strong focus:border-element-active focus:outline-none"
                                placeholder={language.t("skills.gitClone.modal.placeholder")}
                                value={gitUrl()}
                                onInput={(e) => setGitUrl(e.target.value)}
                            />
                        </div>

                        <div class="flex justify-end gap-3 pt-4 border-t border-border-weak-base">
                            <Button variant="ghost" onClick={() => setGitModalOpen(false)} disabled={isCloning()}>
                                {language.t("common.cancel")}
                            </Button>
                            <Button variant="primary" onClick={handleGitClone} disabled={isCloning() || !gitUrl().trim()}>
                                {isCloning() ? language.t("skills.gitClone.cloning") : language.t("skills.gitClone.confirm")}
                            </Button>
                        </div>
                    </div>
                </div>
            </Show>

            {/* Publish Commit Message Modal */}
            <Show when={publishModalOpen()}>
                <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm shadow-xl" onClick={() => setPublishModalOpen(false)}>
                    <div class="w-full max-w-md bg-background-base rounded-xl border border-border-weak-base shadow-md p-6" onClick={(e) => e.stopPropagation()}>
                        <div class="flex items-center gap-3 mb-6 border-b border-border-weak-base pb-4">
                            <div class="flex items-center justify-center size-10 rounded-full bg-element-base text-icon-base shadow-sm">
                                <Icon name="arrow-up" class="size-5" />
                            </div>
                            <div>
                                <h2 class="text-16-medium text-text-strong">{language.t("skills.push.modal.title", { name: publishSkill()?.name })}</h2>
                                <p class="text-13-regular text-text-weak mt-1">{language.t("skills.push.modal.description")}</p>
                            </div>
                        </div>

                        <div class="mb-6">
                            <label class="block text-14-medium text-text-strong mb-2">{language.t("skills.push.commitMessage.label")} <span class="text-negative-base">*</span></label>
                            <textarea
                                class="w-full h-24 px-3 py-2 bg-surface-base border border-border-weak-base rounded-md text-14-regular text-text-strong focus:border-element-active focus:outline-none resize-none select-text"
                                placeholder={language.t("skills.push.commitMessage.placeholder")}
                                value={publishCommitMsg()}
                                onInput={(e) => setPublishCommitMsg(e.target.value)}
                            />
                        </div>

                        <div class="flex justify-end gap-3 pt-4 border-t border-border-weak-base">
                            <Button variant="ghost" onClick={() => setPublishModalOpen(false)}>
                                {language.t("common.cancel")}
                            </Button>
                            <Button variant="primary" onClick={handleConfirmPublish} disabled={!publishCommitMsg().trim()}>
                                {language.t("skills.push.confirm")}
                            </Button>
                        </div>
                    </div>
                </div>
            </Show>

            {/* Publish Success Dialog */}
            <Show when={publishSuccessOpen()}>
                <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm shadow-xl" onClick={() => setPublishSuccessOpen(false)}>
                    <div class="w-full max-w-lg bg-background-base rounded-xl border border-border-weak-base shadow-md p-6" onClick={(e) => e.stopPropagation()}>
                        <div class="flex items-center gap-3 mb-6 border-b border-border-weak-base pb-4">
                            <div class="flex items-center justify-center size-10 rounded-full bg-element-active text-icon-base shadow-sm">
                                <Icon name="check" class="size-5" />
                            </div>
                            <div>
                                <h2 class="text-16-medium text-text-strong">{language.t("skills.push.success.dialog.title")}</h2>
                                <p class="text-13-regular text-text-weak mt-1">{language.t("skills.push.success.dialog.description")}</p>
                            </div>
                        </div>

                        <div class="mb-6">
                            <label class="block text-14-medium text-text-strong mb-2">{language.t("skills.push.success.dialog.reviewLink")}</label>
                            <input
                                type="text"
                                class="w-full h-10 px-3 bg-surface-base border border-border-weak-base rounded-md text-14-regular text-text-strong select-text"
                                value={publishBranchUrl()}
                                readonly
                            />
                            <p class="text-13-regular text-text-weak mt-3">
                                {language.t("skills.push.success.dialog.reviewHint")}
                            </p>
                        </div>

                        <div class="flex justify-end gap-3 pt-4 border-t border-border-weak-base">
                            <Button variant="ghost" onClick={() => setPublishSuccessOpen(false)}>
                                {language.t("skills.push.success.dialog.close")}
                            </Button>
                            <Button
                                variant="primary"
                                onClick={() => {
                                    navigator.clipboard.writeText(publishBranchUrl())
                                    showToast({ title: language.t("skills.push.toast.copied.title"), description: language.t("skills.push.toast.copied.description") })
                                }}
                            >
                                {language.t("skills.push.success.dialog.copyLink")}
                            </Button>
                        </div>
                    </div>
                </div>
            </Show>
        </div>
    )
}
