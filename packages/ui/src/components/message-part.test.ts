import { describe, expect, test } from "bun:test"
import { filelink } from "./tool-file-link"

describe("filelink", () => {
  test("uses filepath before filePath for share links", () => {
    const labels = { title: "File link", share: "Share link", download: "Download link" }
    expect(filelink({ type: "share", filepath: "/tmp/report.xlsx", filePath: "/tmp/old.txt" }, labels)).toEqual({
      icon: "share",
      title: "File link",
      subtitle: "Share link · report.xlsx",
    })
  })

  test("uses filePath fallback for download links", () => {
    const labels = { title: "File link", share: "Share link", download: "Download link" }
    expect(filelink({ type: "download", filePath: "/tmp/report.csv" }, labels)).toEqual({
      icon: "download",
      title: "File link",
      subtitle: "Download link · report.csv",
    })
  })
})
