import { createEffect, createMemo, For, Show, type Accessor, type JSX } from "solid-js"
import { hasSkillUpdates, skillUpdateCount } from "@/utils/skill-updates"
import {
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  SortableProvider,
  closestCenter,
  type DragEvent,
} from "@thisbeyond/solid-dnd"
import { ConstrainDragXAxis } from "@/utils/solid-dnd"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { type LocalProject } from "@/context/layout"

export const SidebarContent = (props: {
  mobile?: boolean
  opened: Accessor<boolean>
  aimMove: (event: MouseEvent) => void
  projects: Accessor<LocalProject[]>
  renderProject: (project: LocalProject) => JSX.Element
  handleDragStart: (event: unknown) => void
  handleDragEnd: () => void
  handleDragOver: (event: DragEvent) => void
  openProjectLabel?: JSX.Element
  openProjectKeybind?: Accessor<string | undefined>
  onOpenProject?: () => void
  renderProjectOverlay: () => JSX.Element
  schedulerLabel: Accessor<string>
  onOpenScheduler: () => void
  skillsLabel: Accessor<string>
  skillsUpdatesLabel: Accessor<string>
  onOpenSkills: () => void
  apiDocLabel: Accessor<string>
  onOpenApiDoc: () => void
  operationDocLabel: Accessor<string>
  onOpenOperationDoc: () => void
  settingsLabel: Accessor<string>
  settingsKeybind: Accessor<string | undefined>
  onOpenSettings: () => void
  helpLabel: Accessor<string>
  onOpenHelp: () => void
  renderPanel: () => JSX.Element
}): JSX.Element => {
  const expanded = createMemo(() => !!props.mobile || props.opened())
  const placement = () => (props.mobile ? "bottom" : "right")
  let panel: HTMLDivElement | undefined

  createEffect(() => {
    const el = panel
    if (!el) return
    if (expanded()) {
      el.removeAttribute("inert")
      return
    }
    el.setAttribute("inert", "")
  })

  return (
    <div class="flex h-full w-full min-w-0 overflow-hidden">
      <div
        data-component="sidebar-rail"
        class="w-16 shrink-0 bg-background-base flex flex-col items-center overflow-hidden"
        onMouseMove={props.aimMove}
      >
        <div class="flex-1 min-h-0 w-full">
          <DragDropProvider
            onDragStart={props.handleDragStart}
            onDragEnd={props.handleDragEnd}
            onDragOver={props.handleDragOver}
            collisionDetector={closestCenter}
          >
            <DragDropSensors />
            <ConstrainDragXAxis />
            <div class="h-full w-full flex flex-col items-center gap-3 px-3 py-3 overflow-y-auto no-scrollbar">
              <SortableProvider ids={props.projects().map((p) => p.worktree)}>
                <For each={props.projects()}>{(project) => props.renderProject(project)}</For>
              </SortableProvider>
              <Show when={false}>
                <Tooltip
                  placement={placement()}
                  value={
                    <div class="flex items-center gap-2">
                      <span>{props.openProjectLabel}</span>
                      <Show when={!props.mobile && !!props.openProjectKeybind?.()}>
                        <span class="text-icon-base text-12-medium">{props.openProjectKeybind?.()}</span>
                      </Show>
                    </div>
                  }
                >
                  <IconButton
                    icon="plus"
                    variant="ghost"
                    size="large"
                    onClick={props.onOpenProject}
                    aria-label={typeof props.openProjectLabel === "string" ? props.openProjectLabel : undefined}
                  />
                </Tooltip>
              </Show>
            </div>
            <DragOverlay>{props.renderProjectOverlay()}</DragOverlay>
          </DragDropProvider>
        </div>
        <div class="shrink-0 w-full pt-3 pb-6 flex flex-col items-center gap-2">
          <Tooltip
            placement={placement()}
            value={
              <div class="flex flex-col gap-1">
                <span>{props.skillsLabel()}</span>
                <Show when={hasSkillUpdates()}>
                  <span class="text-12-regular text-negative-base">{props.skillsUpdatesLabel()}</span>
                </Show>
              </div>
            }
          >
            <div class="relative">
              <IconButton
                icon="knowledge-base"
                variant="ghost"
                size="large"
                onClick={props.onOpenSkills}
                aria-label={props.skillsLabel()}
              />
              <Show when={hasSkillUpdates()}>
                <span class="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-icon-critical-base pointer-events-none animate-pulse" />
              </Show>
            </div>
          </Tooltip>
          <Tooltip placement={placement()} value={props.schedulerLabel()}>
            <IconButton
              icon="clock"
              variant="ghost"
              size="large"
              onClick={props.onOpenScheduler}
              aria-label={props.schedulerLabel()}
            />
          </Tooltip>
          <Tooltip placement={placement()} value={props.apiDocLabel()}>
            <IconButton
              icon="code"
              variant="ghost"
              size="large"
              onClick={props.onOpenApiDoc}
              aria-label={props.apiDocLabel()}
            />
          </Tooltip>
          <Tooltip placement={placement()} value={props.operationDocLabel()}>
            <IconButton
              icon="open-file"
              variant="ghost"
              size="large"
              onClick={props.onOpenOperationDoc}
              aria-label={props.operationDocLabel()}
            />
          </Tooltip>
          <TooltipKeybind placement={placement()} title={props.settingsLabel()} keybind={props.settingsKeybind() ?? ""}>
            <IconButton
              icon="settings-gear"
              variant="ghost"
              size="large"
              onClick={props.onOpenSettings}
              aria-label={props.settingsLabel()}
            />
          </TooltipKeybind>
        </div>
      </div>

      <div
        ref={(el) => {
          panel = el
        }}
        classList={{ "flex-1 flex h-full min-h-0 min-w-0 overflow-hidden": true, "pointer-events-none": !expanded() }}
        aria-hidden={!expanded()}
      >
        {props.renderPanel()}
      </div>
    </div>
  )
}
