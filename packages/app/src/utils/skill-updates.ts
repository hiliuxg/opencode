import { createSignal } from "solid-js"

export type SkillUpdateInfo = { behind: number; branch: string }

export const [skillUpdates, setSkillUpdates] = createSignal<Record<string, SkillUpdateInfo>>({})

export const hasSkillUpdates = () => Object.keys(skillUpdates()).length > 0

export const skillUpdateCount = () => Object.keys(skillUpdates()).length
