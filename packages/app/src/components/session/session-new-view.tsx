import { Show, createMemo, createResource, For } from "solid-js"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { getGuidedTopics } from "@/utils/admin-api"

const MAIN_WORKTREE = "main"
const CREATE_WORKTREE = "create"
const ROOT_CLASS =
  "size-full flex flex-col justify-end items-start gap-4 flex-[1_0_0] self-stretch max-w-200 mx-auto 2xl:max-w-[1000px] px-6 pb-16"

interface NewSessionViewProps {
  worktree: string
  onWorktreeChange: (value: string) => void
  onTopicClick?: (question: string) => void
}

export function NewSessionView(props: NewSessionViewProps) {
  const sync = useSync()
  const sdk = useSDK()
  const language = useLanguage()
  const globalSDK = useGlobalSDK()

  const sandboxes = createMemo(() => sync.project?.sandboxes ?? [])
  const options = createMemo(() => [MAIN_WORKTREE, ...sandboxes(), CREATE_WORKTREE])
  const current = createMemo(() => {
    const selection = props.worktree
    if (options().includes(selection)) return selection
    return MAIN_WORKTREE
  })
  const projectRoot = createMemo(() => sync.project?.worktree ?? sdk.directory)
  const isWorktree = createMemo(() => {
    const project = sync.project
    if (!project) return false
    return sdk.directory !== project.worktree
  })

  const label = (value: string) => {
    if (value === MAIN_WORKTREE) {
      if (isWorktree()) return language.t("session.new.worktree.main")
      const branch = sync.data.vcs?.branch
      if (branch) return language.t("session.new.worktree.mainWithBranch", { branch })
      return language.t("session.new.worktree.main")
    }

    if (value === CREATE_WORKTREE) return language.t("session.new.worktree.create")

    return getFilename(value)
  }

  // Step 1: Fetch skill list for current directory via SDK
  const [skillList] = createResource(
    () => sdk.directory,
    async (dir) => {
      if (!dir) return []
      try {
        const res = await globalSDK.client.app.skills({ directory: dir })
        return res.data ?? []
      } catch {
        return []
      }
    },
  )

  // Step 2: Pick a random skill, fetch guided topics from admin API
  const [topics] = createResource(skillList, async (skills) => {
    if (!skills || skills.length === 0) return []
    const randomSkill = skills[Math.floor(Math.random() * skills.length)]
    const skillname = randomSkill?.name
    if (!skillname) return []
    try {
      const res = await getGuidedTopics(skillname, 3)
      return res
    } catch {
      return []
    }
  })

  // Click a topic → delegate to parent (which handles prompt + auto-submit)
  const handleTopicClick = (question: string) => {
    props.onTopicClick?.(question)
  }

  return (
    <div class={ROOT_CLASS}>
      {/* Guided Topics — main content */}
      <Show when={topics() && topics()!.length > 0}>
        <div class="flex flex-col gap-2 w-full">
          <div class="text-12-medium text-text-weaker">{language.t("session.new.guidedTopics.label")}</div>
          <div class="flex flex-row flex-wrap gap-2">
            <For each={topics()}>
              {(topic) => (
                <button
                  type="button"
                  class="group text-left inline-flex items-center border border-border-base rounded-xl px-4 py-2 hover:border-border-strong hover:bg-background-hover transition-all cursor-pointer"
                  onClick={() => handleTopicClick(topic.question)}
                >
                  <span class="text-14-regular text-text-base select-text group-hover:text-text-strong transition-colors leading-snug">
                    {topic.question}
                  </span>
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>

    </div>
  )
}
