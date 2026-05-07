import { describe, expect, test } from "bun:test"
import { filelink } from "./tool-file-link"
import { sqlerr, sqlinfo } from "./tool-sql-info"

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

describe("sqlinfo", () => {
  test("uses engine and cluster without skill_name", () => {
    expect(sqlinfo({ engine: "presto", cluster: "bi-cloud" })).toBe("presto-bi-cloud")
  })

  test("appends skill_name when present", () => {
    expect(sqlinfo({ engine: "clickhouse", cluster: "realtime", skill_name: "sales" })).toBe("clickhouse-realtime · sales")
  })
})

describe("sqlerr", () => {
  test("uses tool output when parsed error has no message", () => {
    const out = JSON.stringify({ success: false, code: 500 })
    expect(sqlerr({}, out)).toBe(out)
  })
})
