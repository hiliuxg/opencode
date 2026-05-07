import { tool } from "@opencode-ai/plugin"

const admins = new Set([
  "xuegangyu",
  "zeluswu",
  "shenyuanli",
  "marioji",
  "xiaogenliu",
  "janeyang",
  "ceo",
  "markxie",
  "cussionpang",
  "ross",
  "darrenfu",
  "vipqa",
])

async function fetchUserSkills(dir_account: string): Promise<{ success: true; skills: string[] } | { success: false; error: string }> {
  try {
    const res = await fetch(
      `http://10.5.132.186:8000/open-api/skills/accessible?username=${encodeURIComponent(dir_account)}`,
      { headers: { "X-API-Key": "O_10GPaDxKEzpkZNwT8HIVwsxgcT4Cpgox3LWU7DGxM" } }
    )
    if (!res.ok) return {success: false, error: `HTTP error：${res.status}，${res.statusText}` }
    const data = await res.json() as { username: string; skills: string[] }
    if (!Array.isArray(data.skills)) return { success: false, error: "获取用户 skills 失败: 返回格式错误" }
    return { success: true, skills: data.skills }
  } catch (err) {
    return { success: false, error: `获取用户 skills 失败: ${err instanceof Error ? err.message : String(err)}` }
  }
}

export const sql_query_result = tool({
  description: "执行 SQL 查询，并做底层表查询权限控制。",
  args: {
    engine: tool.schema.string().describe("必填，计算引擎, 可选值: presto, clickhouse, starrocks"),
    cluster: tool.schema.string().describe("必填，集群名称, 可选值: bi-cloud, realtime, fx"),
    skill_name: tool.schema.string().describe("必填，使用的业务知识技能名称。"),
    query: tool.schema.string().describe("必填，需要执行的 SQL。可以是基于 skill_name 生成的 SQL，也可以是用户明确指定要执行的具体 SQL")
  },
  async execute(args, context) {
    try {
      const { engine, cluster, query, skill_name } = args
      const { directory } = context

      let dir_account = ""
      if (directory) {
        if (directory.startsWith("/home/")) dir_account = directory.split("/")[2] ?? ""
        else if (directory.startsWith("/Users/leoliu/myroom/")) dir_account = "xiaogenliu"
      }

      const personal = async () => {
        const res = await fetch("http://kgdatallm.tmeoa.com/kudata-mcp/restapi/call/sql_query_result", {
          method: "POST",
          headers: {
            "token_name": "ke09xbgyrx8d8amdoo5ksc00dgvcdniq",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            engine,
            cluster,
            account: dir_account,
            querySql: query,
          }),
        })

        if (!res.ok) {
          return JSON.stringify({ success: false, error: `HTTP error：${res.status}，${res.statusText}` })
        }

        return await res.text()
      }

      const skill = skill_name?.trim()
      if (skill) {
        if (!admins.has(dir_account)) {
          const result = await fetchUserSkills(dir_account)
          if (!result.success) return result.error

          if (!result.skills.includes(skill)) {
            return JSON.stringify({
              success: false,
              error: `权限校验失败: ${dir_account} 没有 ${skill} 权限，请前往 https://kudata-agent.tmeoa.com/skill-market 申请权限`,
            })
          }
        }

        const res = await fetch("http://kgdatallm.tmeoa.com/kudata-mcp/restapi/call/execute_sql_return_result", {
          method: "POST",
          headers: {
            "token_name": "ke09xbgyrx8d8amdoo5ksc00dgvcdniq",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            engine,
            cluster,
            submit_account: dir_account,
            skill_name: skill,
            querySql: query,
          }),
        })

        if (!res.ok) {
          return JSON.stringify({ success: false, error: `HTTP error：${res.status}，${res.statusText}` })
        }

        const text = await res.text()
        const data = (() => {
          try {
            return JSON.parse(text) as unknown
          } catch {
            return undefined
          }
        })()
        const obj = data && typeof data === "object" ? data as Record<string, unknown> : undefined
        const err = typeof obj?.error === "string" ? obj.error : ""
        const fail = obj?.success === false
        const retry = err.includes("Permission denied") || (err.includes("skill_name:") && err.includes("对应的业务账号为空"))

        if (fail && retry) {
          console.log("调用skill接口获取SQL查询结果失败，重新调用personal接口获取SQL查询结果，error=", err)
          return await personal()
        }
        return text
      }

      return await personal()
    } catch (e) {
      return JSON.stringify({
        success: false,
        error: `执行查询时发生异常: ${e instanceof Error ? e.message : String(e)}`,
      })
    }
  }
}); 
