import { tool } from "@opencode-ai/plugin"
import path from "path"

/** 超级管理员账号列表 */
const SUPER_ADMINS = new Set([
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
  "darrenfu"
])

/** 查询用户的可访问 skills 列表 */
async function fetchUserSkills(dir_account: string): Promise<{ ok: true; skills: string[] } | { ok: false; message: string }> {
  try {
    const res = await fetch(
      `http://10.5.132.186:8000/open-api/skills/accessible?username=${encodeURIComponent(dir_account)}`,
      { headers: { "X-API-Key": "O_10GPaDxKEzpkZNwT8HIVwsxgcT4Cpgox3LWU7DGxM" } }
    )
    if (!res.ok) return { ok: false, message: `获取用户 skills 失败: HTTP ${res.status}` }
    const data = await res.json() as { username: string; skills: string[] }
    if (!Array.isArray(data.skills)) return { ok: false, message: "获取用户 skills 失败: 返回格式错误" }
    return { ok: true, skills: data.skills }
  } catch (err) {
    return { ok: false, message: `获取用户 skills 失败: ${err instanceof Error ? err.message : String(err)}` }
  }
}

/** 解析 SQL 执行的最终账号 */
async function resolveSqlFinalAccount(
  dir_account: string,
  account: string,
  skill_name: string | undefined | null,
): Promise<{ final_account: string } | { error: string }> {
  // 规则 1: 如果 dir_account = account，则直接执行 SQL，忽略 skill
  if (dir_account === account) return { final_account: account }

  // 规则 2: 如果 dir_account 是超级管理员，则使用 account
  if (SUPER_ADMINS.has(dir_account)) return { final_account: account }

  // 规则 3: 如果不是超管，继续判断
  // 如果 skill_name 为空值，则使用 dir_account
  if (!skill_name || skill_name.trim() === "") return { final_account: dir_account }

  // 如果 skill_name 不为空，查询用户的 skills 列表
  const result = await fetchUserSkills(dir_account)
  if (!result.ok) return { error: result.message }

  // 检查用户是否有该 skill 权限
  if (!result.skills.includes(skill_name)) {
    return {
      error: `权限校验失败: ${dir_account} 没有 ${skill_name} 权限，请前往 https://kudata-agent.tmeoa.com/skill-market 申请权限`
    }
  }

  // 用户有该 skill 权限，使用 account
  return { final_account: account }
}

export const sql_query_result = tool({
  description: "query data by sql",
  args: {
    engine: tool.schema.string().describe("必填，计算引擎, 可选值: presto, clickhouse, starrocks"),
    cluster: tool.schema.string().describe("必填，集群名称, 可选值: bi-cloud, realtime"),
    account: tool.schema.string().describe("必填，sql执行账号名称"),
    query: tool.schema.string().describe("必填，sql to query"),
    skill_name: tool.schema.string().optional().describe("选填，技能名称，sql是基于哪个skill生成的")
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

      const auth = await resolveSqlFinalAccount(dir_account, account, skill_name)
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

    let finalContent = `${content}`;
    if (file_url) {
      finalContent += `[数据报告](${file_url})`;
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
  description: "渲染二维图表，只支持bar(柱状图)、line(折线图)，其他类型不支持",
  args: {
    chart_type: tool.schema.string().describe("图表类型，可选值为 'bar'、'line'"),
    title: tool.schema.string().describe("图表标题"),
    series: tool.schema.array(tool.schema.json()).describe('数据值系列，JSON数组类型，每个item必须包含 `name`和`data` key，`name`为系列名，`data`为数据值数组，格式如：[{"name": "系列名1", "data": [1, 2, 3]}, {"name": "系列名2", "data": [4, 5, 6]}]'),
    xAxis: tool.schema.array(tool.schema.string()).optional().describe('X轴标签列表，数组类型，通常为日期，例如 ["2026-01-02", "2026-01-03", "2026-01-04"]'),
  },
  async execute(args, context) {
    try {
      console.log("render_chart_args=", args)
      const series = typeof args.series === 'string' ? JSON.parse(args.series) : args.series
      if (!Array.isArray(series))
        return JSON.stringify({ success: false, message: 'series 必须是JSON数组类型，每个item必须包含 `name`和`data` key，`name`为系列名，`data`为数据值数组，格式如：[{"name": "系列名1","data": [1, 2, 3]}, {"name": "系列名2", "data": [4, 5, 6]}]' })

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

export const get_file_link = tool({
  description: "获取文件链接，可生成下载链接或共享链接",
  args: {
    type: tool.schema.enum(["share", "download"]).describe("链接类型，share 为共享链接，download 为下载链接"),
    filepath: tool.schema.string().describe("文件路径，建议传绝对路径"),
    filePath: tool.schema.string().optional().describe("兼容字段，等同 filepath"),
  },
  async execute(args, context) {
    try {
      const raw = args.filepath || args.filePath
      if (!raw) return JSON.stringify({ success: false, message: "filepath 不能为空" })

      const filepath = path.isAbsolute(raw) ? raw : path.join(context.directory, raw)
      const rel = path.relative(context.directory, filepath)
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        return JSON.stringify({ success: false, message: "文件路径不在当前工作目录内" })
      }

      const file = Bun.file(filepath)
      if (!(await file.exists())) {
        return JSON.stringify({ success: false, message: `文件不存在: ${filepath}` })
      }

      if (args.type === "download") {
        const link = `https://kudata-agent.tmeoa.com/kgbi/starbot/file/download?path=${encodeURIComponent(rel.replaceAll("\\", "/"))}&directory=${encodeURIComponent(context.directory)}`
        return JSON.stringify({ success: true, type: "download", filepath, link })
      }

      const form = new FormData()
      form.append("file", file, path.basename(filepath))
      const resp = await fetch("http://10.5.132.186:8000/api/v1/report-html/upload", {
        method: "POST",
        body: form,
      })
      if (!resp.ok) return JSON.stringify({ success: false, message: `上传失败: HTTP ${resp.status}` })

      const json = await resp.json() as { url?: string; data?: { url?: string } }
      let link = json.url ?? json.data?.url ?? ""
      if (!link) return JSON.stringify({ success: false, message: "上传成功但未返回链接" })
      if (link.startsWith("/")) link = `https://kudata-agent.tmeoa.com${link}`

      return JSON.stringify({ success: true, type: "share", filepath, link })
    } catch (e) {
      console.error("get_file_link error:", e)
      return JSON.stringify({ success: false, message: e instanceof Error ? e.message : String(e) })
    }
  },
})

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
            config: { providerID: "kudata-provider", modelID: "kimi-k2.5" },
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
