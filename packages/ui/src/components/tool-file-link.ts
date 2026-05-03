import { getFilename } from "@opencode-ai/util/path"
import type { IconProps } from "./icon"

export type FilelinkLabels = {
  title: string
  share: string
  download: string
}

export function filelink(input: Record<string, unknown>, labels: FilelinkLabels): { icon: IconProps["name"]; title: string; subtitle?: string } {
  const path =
    typeof input.filepath === "string" && input.filepath
      ? input.filepath
      : typeof input.filePath === "string" && input.filePath
        ? input.filePath
        : ""
  const type = input.type === "download" ? "download" : "share"
  const label = labels[type]
  return {
    icon: type === "download" ? "download" : "share",
    title: labels.title,
    subtitle: path ? `${label} · ${getFilename(path)}` : label,
  }
}
