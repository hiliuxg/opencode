import { createMemo, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { JSX } from "solid-js"
import { createSortable } from "@thisbeyond/solid-dnd"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { Tabs } from "@opencode-ai/ui/tabs"
import { showToast } from "@opencode-ai/ui/toast"
import { getFilename } from "@opencode-ai/util/path"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useCommand } from "@/context/command"
import { copyPath } from "@/utils/clipboard"

export function FileVisual(props: { path: string; active?: boolean }): JSX.Element {
  return (
    <div class="flex items-center gap-x-1.5 min-w-0">
      <Show
        when={!props.active}
        fallback={<FileIcon node={{ path: props.path, type: "file" }} class="size-4 shrink-0" />}
      >
        <span class="relative inline-flex size-4 shrink-0">
          <FileIcon node={{ path: props.path, type: "file" }} class="absolute inset-0 size-4 tab-fileicon-color" />
          <FileIcon node={{ path: props.path, type: "file" }} mono class="absolute inset-0 size-4 tab-fileicon-mono" />
        </span>
      </Show>
      <span class="text-14-medium truncate">{getFilename(props.path)}</span>
    </div>
  )
}

export function SortableTab(props: {
  tab: string
  onTabClose: (tab: string) => void
  menu?: {
    many: () => boolean
    onCloseAll: (tab: string) => void
    onCloseOthers: (tab: string) => void
  }
}): JSX.Element {
  const file = useFile()
  const language = useLanguage()
  const command = useCommand()
  const sortable = createSortable(props.tab)
  const [state, setState] = createStore({ menu: false, x: 0, y: 0 })
  const path = createMemo(() => file.pathFromTab(props.tab))
  const tip = createMemo(() => {
    const value = path()
    if (!value) return
    return file.absolute(value)
  })
  const content = createMemo(() => {
    const value = path()
    if (!value) return
    return <FileVisual path={value} />
  })
  const copy = () => {
    void copyPath({
      path: tip(),
      labels: {
        success: language.t("fileTree.toast.copyReady"),
        fail: language.t("fileTree.toast.copyFailed"),
      },
      toast: showToast,
    })
  }
  const menu = (e: MouseEvent) => {
    if (!props.menu) return
    e.preventDefault()
    e.stopPropagation()
    setState({ menu: true, x: e.clientX, y: e.clientY })
  }
  const trigger = () => (
    <Tabs.Trigger
      value={props.tab}
      onContextMenu={menu}
      closeButton={
        <TooltipKeybind
          title={language.t("common.closeTab")}
          keybind={command.keybind("tab.close")}
          placement="bottom"
          gutter={10}
        >
          <IconButton
            icon="close-small"
            variant="ghost"
            class="h-5 w-5"
            onClick={() => props.onTabClose(props.tab)}
            aria-label={language.t("common.closeTab")}
          />
        </TooltipKeybind>
      }
      hideCloseButton
      onMiddleClick={() => props.onTabClose(props.tab)}
    >
      <Tooltip
        value={<span>{tip()}</span>}
        placement="bottom"
        gutter={10}
        inactive={!tip()}
        class="min-w-0"
        contentClass="max-w-[min(80vw,40rem)] break-all text-left"
      >
        <Show when={content()}>{(value) => value()}</Show>
      </Tooltip>
    </Tabs.Trigger>
  )

  return (
    <div use:sortable class="h-full flex items-center" classList={{ "opacity-0": sortable.isActiveDraggable }}>
      <div class="relative">
        {trigger()}
        <Show when={props.menu} keyed>
          {(menu) => (
            <DropdownMenu open={state.menu} onOpenChange={(open) => setState("menu", open)}>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  class="fixed [&_[data-slot=dropdown-menu-item]]:text-[length:var(--font-size-x-small)] [&_[data-slot=dropdown-menu-item]_[data-component=icon]]:size-3"
                  style={{ left: `${state.x}px`, top: `${state.y}px` }}
                >
                  <DropdownMenu.Item onSelect={() => props.onTabClose(props.tab)}>
                    <Icon name="close" />
                    <DropdownMenu.ItemLabel>{language.t("common.close")}</DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item onSelect={() => menu.onCloseAll(props.tab)}>
                    <Icon name="collapse-all" />
                    <DropdownMenu.ItemLabel>{language.t("session.tab.closeAll")}</DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item disabled={!menu.many()} onSelect={() => menu.onCloseOthers(props.tab)}>
                    <Icon name="circle-x" />
                    <DropdownMenu.ItemLabel>{language.t("session.tab.closeOthers")}</DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item onSelect={copy}>
                    <Icon name="copy" />
                    <DropdownMenu.ItemLabel>{language.t("session.header.open.copyPath")}</DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu>
          )}
        </Show>
      </div>
    </div>
  )
}
