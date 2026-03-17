import { createMemo, For, Show, type Accessor, type JSX } from "solid-js"
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
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { type LocalProject } from "@/context/layout"
import { sidebarExpanded } from "./sidebar-shell-helpers"

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
  const expanded = createMemo(() => sidebarExpanded(props.mobile, props.opened()))
  const placement = () => (props.mobile ? "bottom" : "right")

  return (
    <div class="flex h-full w-full overflow-hidden">
      <div
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
          <Tooltip placement={placement()} value={props.schedulerLabel()}>
            <IconButton
              icon="clock"
              variant="ghost"
              size="large"
              onClick={props.onOpenScheduler}
              aria-label={props.schedulerLabel()}
            />
          </Tooltip>
          <Tooltip placement={placement()} value={props.skillsLabel()}>
            <IconButton
              icon="knowledge-base"
              variant="ghost"
              size="large"
              onClick={props.onOpenSkills}
              aria-label={props.skillsLabel()}
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

      <Show when={expanded()}>{props.renderPanel()}</Show>
    </div>
  )
}
