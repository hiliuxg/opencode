import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { tool } from "@opencode-ai/plugin"

/** 与 kudata-mcp.ts 同目录：dir_account 超管（*）或 skill_name → 允许的 dir_account 列表 */
const ACCOUNT_SKILL_PERMISSIONS_FILE = join(dirname(fileURLToPath(import.meta.url)), "account-skill-permissions.json")

async function loadAccountSkillPermissions(): Promise<
  { ok: true; data: Record<string, "*" | string[]> } | { ok: false; message: string }
> {
  const f = Bun.file(ACCOUNT_SKILL_PERMISSIONS_FILE)
  if (!(await f.exists()))
    return {
      ok: false,
      message: `权限配置加载失败: 未找到文件 ${ACCOUNT_SKILL_PERMISSIONS_FILE}`,
    }
  let raw: unknown
  try {
    raw = await f.json()
  } catch {
    return {
      ok: false,
      message: `权限配置加载失败: JSON 解析错误 (${ACCOUNT_SKILL_PERMISSIONS_FILE})`,
    }
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return { ok: false, message: "权限配置加载失败: 根节点必须是对象" }
  return { ok: true, data: raw as Record<string, "*" | string[]> }
}

function resolveSqlFinalAccount(
  perms: Record<string, "*" | string[]>,
  dir_account: string,
  account: string,
  skill_name: string,
): { final_account: string } | { error: string } {
  const wildcard = perms[dir_account]
  if (wildcard === "*") return { final_account: account }
  if (dir_account === account) return { final_account: account }
  const allowed = perms[skill_name]
  if (Array.isArray(allowed) && allowed.includes(dir_account)) return { final_account: account }
  return { error: `权限校验失败: ${dir_account} 没有 ${skill_name} 权限` }
}

export const sql_query_result = tool({
  description: "query data by sql",
  args: {
    engine: tool.schema.string().describe("必填，计算引擎, 可选值: presto, clickhouse, starrocks"),
    cluster: tool.schema.string().describe("必填，集群名称, 可选值: bi-cloud, realtime"),
    account: tool.schema.string().describe("必填，sql执行账号名称"),
    query: tool.schema.string().describe("必填，sql to query"),
    skill_name: tool.schema.string().describe("必填，技能名称，sql是基于哪个skill生成的")
  },
  async execute(args, context) {
    try {

      const { engine, cluster, account, query, skill_name } = args
      const { directory } = context

      let dir_account = ""
      if (directory) {
        if (directory.startsWith("/home/")) dir_account = directory.split("/")[2] ?? ""
        else if (directory.startsWith("/Users/leoliu/myroom/")) dir_account = "xiaogenliu"
      }

      console.log(
        "kudata-mcp_dir_account=",
        dir_account,
        "kudata-mcp_account=",
        account,
        "kudata-mcp_skill_name=",
        skill_name,
        "kudata-mcp_query=",
        query,
      )

      const loaded = await loadAccountSkillPermissions()
      if (!loaded.ok) return loaded.message
      const auth = resolveSqlFinalAccount(loaded.data, dir_account, account, skill_name)
      if ("error" in auth) return auth.error
      const final_account = auth.final_account

      console.log(
        "kudata-mcp_final_account=",
        final_account
      )

      const response = await fetch("http://kgdatallm.tmeoa.com/kudata-mcp/restapi/call/sql_query_result", {
        method: "POST",
        headers: {
          token_name: "ke09xbgyrx8d8amdoo5ksc00dgvcdniq",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          engine,
          cluster,
          account: final_account,
          querySql: query,
        }),
      })

      if (!response.ok) {
        return `查询失败: HTTP ${response.status} ${response.statusText}`;
      }

      const result = await response.text()
      // console.log("kudata-macp-sql_result=", result)

      return result;
    } catch (e) {
      console.error("run_select_query error:", e);
      return `执行查询时发生异常: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
})

export const get_table_columns = tool({
  description: "获取指定表的列信息",
  args: {
    engine: tool.schema.string().describe("引擎, 可选值: clickhouse, starrocks"),
    cluster: tool.schema.string().describe("集群名称, 可选值: bi-cloud, realtime"),
    tablename: tool.schema.string().describe("表名")
  },
  async execute(args, context) {
    try {
      const response = await fetch('http://kgdatallm.tmeoa.com/kudata-mcp/restapi/call/get_table_columns', {
        method: 'POST',
        headers: {
          'token_name': 'ke09xbgyrx8d8amdoo5ksc00dgvcdniq',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          engine: args.engine,
          cluster: args.cluster,
          tablename: args.tablename
        })
      });

      if (!response.ok) {
        return `获取列信息失败: HTTP ${response.status} ${response.statusText}`;
      }

      const result = await response.text();
      console.log("get_table_columns_result=", result);
      return result;
    } catch (e) {
      console.error("get_table_columns error:", e);
      return `获取列信息时发生异常: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
});


export const send_message = tool({
  description: "发送企业微信群机器人消息, 除非用户指定发送附件文件http链接，否则参数file_url不传",
  args: {
    webhook_url: tool.schema.string().describe("群机器人Webhook地址, 必填"),
    content: tool.schema.string().describe("markdown格式的消息内容, 必填"),
    file_url: tool.schema.string().describe("需要发送的附件文件http链接，可选，不传，程序自动填充默认值")
  },
  async execute(args, context) {
    const { webhook_url, content, file_url } = args;
    const { agent, sessionID, messageID, directory, worktree } = context
    console.log("kudata-macp_directory=", directory)

    // 1. 参数校验
    if (!webhook_url || !webhook_url.trim()) return "发送失败: URL为空";
    if (!content || !content.trim()) return "发送失败: content为空";

    const directoryBase64 = Buffer.from(directory || "").toString('base64').replace(/=/g, '');
    const session_url = `https://gw.tencentmusic.com/kgbi/starbot/${directoryBase64}/session/${sessionID}`;
    console.log(`[Debug] directory: ${directory}, base64: ${directoryBase64}`);
    console.log(`[Debug] session_url: ${session_url}`);

    let finalContent = `${content}\n[推理过程](${session_url})`;
    if (file_url) {
      finalContent += ` | [数据报告](${file_url})`;
    }

    console.log(`[Debug] finalContent: ${finalContent}`);

    const proxyUrl = "http://forward.proxy.kgidc.cn:3128";
    const payload = JSON.stringify({
      msgtype: "markdown",
      markdown: {
        content: finalContent
      }
    });

    try {
      console.log(`[Debug] 使用 Bun.spawn 调用 curl (绕过 fetch 代理识别问题)...`);

      // 2. 调用确认通畅的 curl 命令
      const process = Bun.spawn(["curl", "-s", "-X", "POST",
        "-x", proxyUrl,
        webhook_url.trim(),
        "-H", "Content-Type: application/json",
        "--data-binary", "@-" // 告诉 curl 从 stdin 读取原始字节
      ], {
        stdin: Buffer.from(payload) // 将 payload 作为流传给 curl
      });

      // 获取输出
      const stdout = await new Response(process.stdout).text();
      const stderr = await new Response(process.stderr).text();
      const exitCode = await process.exited;

      if (exitCode !== 0) {
        console.error(`[Error] Curl 进程异常退出. Code: ${exitCode}, Stderr: ${stderr}`);
        return `发送失败 (进程错误): ${stderr || 'Unknown error'}`;
      }

      console.log(`[Debug] 接口原始返回: ${stdout}`);

      // 3. 业务逻辑判断
      try {
        const json = JSON.parse(stdout);
        if (json.errcode !== 0) {
          return `发送失败 (企微报错): ${json.errmsg} (code: ${json.errcode})`;
        }
      } catch (parseError) {
        // 如果不是 JSON，可能是代理服务器返回的错误页面
        if (stdout.includes("Proxy")) {
          return `发送失败: 代理服务器报错了，请检查代理状态。`;
        }
      }

      return "消息发送成功";

    } catch (e: any) {
      console.error("[Fatal] 终极异常:", e);
      return `发送失败: ${e.message}`;
    }
  }
});


export const render_chart = tool({
  description: "渲染二维图表，只支持柱状图、折线图，其他类型不支持",
  args: {
    chart_type: tool.schema.string().describe("图表类型，可选值为 'bar'（柱状图）、'line'（折线图）"),
    title: tool.schema.string().describe("图表标题"),
    series: tool.schema.array(tool.schema.json()).describe('数据值系列，JSON数组类型，每个item必须包含 `name`和`data` key，`name`为系列名，`data`为数据值数组，格式如：[{"name": "系列名1", "data": [1, 2, 3]}, {"name": "系列名2", "data": [4, 5, 6]}]'),
    xAxis: tool.schema.array(tool.schema.string()).optional().describe('X轴标签列表，数组类型，通常为日期，例如 ["2026-01-02", "2026-01-03", "2026-01-04"]'),
  },
  async execute(args, context) {
    try {
      console.log("render_chart_args=", args)
      const series = typeof args.series === 'string' ? JSON.parse(args.series) : args.series
      if (!Array.isArray(series))
        return JSON.stringify({ success: false, message: 'series 必须是JSON数组类型，每个item必须包含 `name`和`data` key，`name`为系列名，`data`为数据值数组，格式如：[{"name": "系列名1","data": [1,2, 3]}, {"name": "系列名2", "data": [4, 5, 6]}]' })

      const xAxis = args.xAxis;
      if (xAxis !== undefined && xAxis !== null && !Array.isArray(xAxis))
        return JSON.stringify({ success: false, message: `xAxis 必须是数组，格式如：["2026-01-02", "2026-01-03", "2026-01-04"]，当前值: ${JSON.stringify(xAxis)}` })

      for (let i = 0; i < series.length; i++) {
        const item = series[i]
        if (typeof item !== 'object' || item === null)
          return JSON.stringify({ success: false, message: 'series 必须是JSON数组类型，每个item必须包含 `name`和`data` key，`name`为系列名，`data`为数据值数组，格式如：[{"name": "系列名1","data": [1, 2, 3]}, {"name": "系列名2", "data": [4, 5, 6]}]'})
        if (typeof item.name !== 'string' || item.name === '')
          return JSON.stringify({ success: false, message: `series 参数校验失败: series[${i}].name 缺失或不是字符串，当前值: ${JSON.stringify(item)}` })
        if (!Array.isArray(item.data))
          return JSON.stringify({ success: false, message: `series 参数校验失败: series[${i}].data 缺失或不是数组，当前值: ${JSON.stringify(item)}` })
      }

      return JSON.stringify({ success: true, data: args })
    } catch (e) {
      console.error("render_chart error:", e);
      return JSON.stringify({ success: false, message: e instanceof Error ? e.message : String(e) });
    }
  }
});

export const manage_schedule = tool({
  description: "管理定时任务，当用户提到定时推送分析报告等定时任务时，使用此工具。",
  args: {
    title: tool.schema.string().describe("调度任务名称"),
    op: tool.schema.enum(["create", "update", "delete"]).describe("操作类型：create 创建、update 修改、delete 删除"),
    prompt: tool.schema.string().describe("调度任务执行的 prompt 内容"),
    schedule: tool.schema.string().describe('调度时间 cron 表达式，例如 "0 9 * * *" 表示每天9点, "0 */2 * * *" 表示每2小时'),
  },
  async execute(args, context) {
    const ADMIN_URL = "http://10.34.81.146:8787/opencode"
    const result: any = {
      op: args.op,
      title: args.title,
      schedule: args.schedule,
      prompt: args.prompt,
    }

    try {
      if (args.op === "create") {
        const res = await fetch(`${ADMIN_URL}/api/jobs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: 1,
            timezone: "Asia/Shanghai",
            name: args.title,
            cronExpression: args.schedule,
            prompt: args.prompt,
            workspaceDir: context.directory,
            config: { providerID: "tme-continue-provider", modelID: "Gemini-3.1-Pro" },
          }),
        })
        const data = await res.json()
        if (!res.ok) return JSON.stringify({ ...result, status: "error", error: data.error || `HTTP ${res.status}` })
        result.status = "success"
        result.job = data.item
      } else {
        return JSON.stringify({ ...result, status: "unsupported", error: `暂不支持「${args.op === "update" ? "修改" : "删除"}」操作，请前往调度管理面板手动操作` })
      }
      console.log("manage_schedule result=", JSON.stringify(result))
      return JSON.stringify(result)
    } catch (e) {
      console.error("manage_schedule error:", e)
      return JSON.stringify({ ...result, status: "error", error: e instanceof Error ? e.message : String(e) })
    }
  },
});