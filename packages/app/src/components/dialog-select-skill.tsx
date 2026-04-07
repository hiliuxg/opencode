import { Popover as Kobalte } from "@kobalte/core/popover"
import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/util/encode"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { createMemo, createResource, For, type ComponentProps, type JSX, type ValidComponent } from "solid-js"
import { createStore } from "solid-js/store"
import { useSDK } from "@/context/sdk"
import { useGlobalSDK } from "@/context/global-sdk"
import { List } from "@opencode-ai/ui/list"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"

type Skill = {
  name: string
  description?: string
  location?: string
}

const SkillList = (props: {
  skills: () => Skill[]
  selected: () => string[]
  class?: string
  onToggle: (skill: Skill) => void
  searchAction?: JSX.Element
}) => {
  const language = useLanguage()

  return (
    <List
      class={`flex-1 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0 ${props.class ?? ""}`}
      search={{
        placeholder: language.t("dialog.skill.search.placeholder"),
        autofocus: true,
        ...(props.searchAction ? { action: props.searchAction } : {}),
      }}
      emptyMessage={language.t("dialog.skill.empty")}
      key={(x) => x?.name ?? ""}
      items={props.skills}
      filterKeys={["name", "description"]}
      sortBy={(a, b) => a.name.localeCompare(b.name)}
      onSelect={(skill) => skill && props.onToggle(skill)}
    >
      {(skill) => (
        <Tooltip placement="right-start" value={skill.description} disabled={!skill.description}>
          <div class="w-full flex items-center gap-2 min-w-0 text-left py-1">
            <div
              class="shrink-0 size-4 rounded border border-border-base flex items-center justify-center transition-colors"
              classList={{
                "bg-interactive-base border-interactive-base": props.selected().includes(skill.name),
              }}
            >
              {props.selected().includes(skill.name) && (
                <Icon name="check-small" size="small" class="size-3 text-white" />
              )}
            </div>
            <div class="flex flex-col min-w-0 flex-1">
              <span class="text-13-medium text-text-strong">{skill.name}</span>
              <span class="text-12-regular text-text-weak text-left truncate">{skill.description}</span>
            </div>
          </div>
        </Tooltip>
      )}
    </List>
  )
}

type SkillSelectorTriggerProps = Omit<ComponentProps<typeof Kobalte.Trigger>, "as" | "ref">

export function SkillSelectorPopover(props: {
  children?: JSX.Element
  triggerAs?: ValidComponent
  triggerProps?: SkillSelectorTriggerProps
  selectedSkills: () => string[]
  onToggle?: (skill: Skill) => void
}) {
  const [store, setStore] = createStore<{
    open: boolean
    dismiss: "escape" | "outside" | null
  }>({
    open: false,
    dismiss: null,
  })

  const sdk = useSDK()
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const navigate = useNavigate()

  const goSkills = () => {
    const dir = sdk.directory
    if (!dir) return
    setStore("open", false)
    navigate(`/${base64Encode(dir)}/skills`)
  }

  const [skillsRes] = createResource(
    () => sdk.directory,
    async (dir) => {
      if (!dir) return []
      try {
        const res = await globalSDK.client.app.skills({ directory: dir })
        const all = res.data ?? []
        return all.filter((s: Skill) => s.name !== "ui-ux-pro-max" && s.name !== "skill-creator")
      } catch {
        return []
      }
    },
  )

  const skills = createMemo(() => skillsRes() ?? [])

  return (
    <Kobalte
      open={store.open}
      onOpenChange={(next) => {
        if (next) setStore("dismiss", null)
        setStore("open", next)
      }}
      modal={false}
      placement="top-start"
      gutter={4}
    >
      <Kobalte.Trigger as={props.triggerAs ?? "div"} {...props.triggerProps}>
        {props.children}
      </Kobalte.Trigger>
      <Kobalte.Portal>
        <Kobalte.Content
          class="w-72 h-80 flex flex-col p-2 rounded-md border border-border-base bg-surface-raised-stronger-non-alpha shadow-md z-50 outline-none overflow-hidden"
          onEscapeKeyDown={(event) => {
            setStore("dismiss", "escape")
            setStore("open", false)
            event.preventDefault()
            event.stopPropagation()
          }}
          onPointerDownOutside={() => {
            setStore("dismiss", "outside")
            setStore("open", false)
          }}
          onFocusOutside={() => {
            setStore("dismiss", "outside")
            setStore("open", false)
          }}
          onCloseAutoFocus={(event) => {
            if (store.dismiss === "outside") event.preventDefault()
            setStore("dismiss", null)
          }}
        >
          <Kobalte.Title class="sr-only">{language.t("dialog.skill.select.title")}</Kobalte.Title>
          <SkillList
            skills={skills}
            selected={props.selectedSkills}
            class="p-1"
            searchAction={
              sdk.directory ? (
                <Tooltip placement="top" value={language.t("dialog.skill.manage")}>
                  <IconButton
                    icon="knowledge-base"
                    variant="ghost"
                    iconSize="normal"
                    class="size-6"
                    aria-label={language.t("dialog.skill.manage")}
                    onClick={goSkills}
                  />
                </Tooltip>
              ) : undefined
            }
            onToggle={(skill) => props.onToggle?.(skill)}
          />
        </Kobalte.Content>
      </Kobalte.Portal>
    </Kobalte>
  )
}
