import type { E2EWindow } from "./terminal"

export type PromptProbeState = {
  popover: "at" | "slash" | null
  slash?: {
    active: string | null
    ids: string[]
  }
}

export const promptEnabled = () => {
  if (typeof window === "undefined") return false
  return (window as E2EWindow).__opencode_e2e?.prompt?.enabled === true
}

const root = () => {
  if (!promptEnabled()) return
  return (window as E2EWindow).__opencode_e2e?.prompt
}

export const promptProbe = {
  set(input: PromptProbeState) {
    const state = root()
    if (!state) return
    state.current = { popover: input.popover }
  },
  clear() {
    const state = root()
    if (!state) return
    state.current = undefined
  },
}
