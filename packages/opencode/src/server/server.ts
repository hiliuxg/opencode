import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Log } from "../util/log"
import { describeRoute, generateSpecs, validator, resolver, openAPIRouteHandler } from "hono-openapi"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { streamSSE } from "hono/streaming"
import { proxy } from "hono/proxy"
import { basicAuth } from "hono/basic-auth"
import z from "zod"
import { Provider } from "../provider/provider"
import { NamedError } from "@opencode-ai/util/error"
import { LSP } from "../lsp"
import { Format } from "../format"
import { TuiRoutes } from "./routes/tui"
import { Instance } from "../project/instance"
import { Vcs } from "../project/vcs"
import { Agent } from "../agent/agent"
import { Skill } from "../skill/skill"
import { Auth } from "../auth"
import { Flag } from "../flag/flag"
import { Command } from "../command"
import { Global } from "../global"
import { ProjectRoutes } from "./routes/project"
import { SessionRoutes } from "./routes/session"
import { PtyRoutes } from "./routes/pty"
import { McpRoutes } from "./routes/mcp"
import { FileRoutes } from "./routes/file"
import { ConfigRoutes } from "./routes/config"
import { ExperimentalRoutes } from "./routes/experimental"
import { ProviderRoutes } from "./routes/provider"
import { lazy } from "../util/lazy"
import { InstanceBootstrap } from "../project/bootstrap"
import { NotFoundError } from "../storage/db"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { websocket } from "hono/bun"
import { HTTPException } from "hono/http-exception"
import { errors } from "./error"
import { QuestionRoutes } from "./routes/question"
import { PermissionRoutes } from "./routes/permission"
import { GlobalRoutes } from "./routes/global"
import { MDNS } from "./mdns"
import { createHash, createDecipheriv } from "node:crypto"
import { base64Decode, base64Encode } from "@opencode-ai/util/encode"

// @ts-ignore This global is needed to prevent ai-sdk from logging warnings to stdout https://github.com/vercel/ai/blob/2dc67e0ef538307f21368db32d5a12345d98831b/packages/ai/src/logger/log-warnings.ts#L85
globalThis.AI_SDK_LOG_WARNINGS = false

export namespace Server {
  const log = Log.create({ service: "server" })
  const csp =
    "default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; media-src 'self' data:; connect-src 'self' data: localhost:* 127.0.0.1:* https://kudata-agent.tmeoa.com https://passport.tmeoa.com; manifest-src 'self' https://passport.tmeoa.com"
  const gatewayUser = z.object({
    ename: z.string(),
    id: z.string(),
    cname: z.string(),
    email: z.string(),
  })

  const headers = (response: Response) => {
    response.headers.set("Content-Security-Policy", csp)
    response.headers.set("Access-Control-Allow-Origin", "*")
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
    response.headers.set("Access-Control-Allow-Headers", "*")
    return response
  }

  const decodeToken = (token: string, timestamp: string, appsecret: string) => {
    const hash = createHash("md5")
      .update(`${timestamp}${appsecret}${timestamp}`)
      .digest("hex")
    const key = hash.slice(0, 16)
    const iv = hash.slice(-16)
    const cipher = Buffer.from(token, "base64").toString("binary")
    const decipher = createDecipheriv("aes-128-cbc", key, iv)
    let decoded = decipher.update(cipher, "binary", "utf8")
    decoded += decipher.final("utf8")
    return decoded
  }
  const appsecret = Flag.TPP_APPSECRET
  const grants: Record<string, string | string[]> = (() => {
    const path = Flag.OPENCODE_ACCESS_GRANTS
    if (!path) return {}
    try {
      const raw = require("fs").readFileSync(path, "utf8")
      const parsed = JSON.parse(raw)
      log.info("access grants loaded", { path, grants: parsed })
      return parsed
    } catch (error) {
      log.warn("failed to load access grants", { path, error })
      return {}
    }
  })()
  const canAccess = (user: string | undefined, account: string | undefined) => {
    if (!user || !account) return false
    if (user === account) return true
    const allowed = grants[user]
    if (allowed === "*") return true
    if (Array.isArray(allowed) && allowed.includes(account)) return true
    return false
  }
  const denied = {
    message: "你没有该链接权限",
  }
  const protectedPath = (parts: string[]) =>
    parts.length >= 2 &&
    (parts[1] === "session" || ((parts[1] === "skills" || parts[1] === "api-doc") && parts.length === 2))
  const decodeDirectory = (segment: string) => {
    try {
      const directory = base64Decode(segment)
      if (!directory.startsWith("/")) {
        log.info("decoded directory invalid", {
          encoded: segment,
          reason: "not-directory",
          directory,
        })
        return
      }
      log.info("decoded directory valid", {
        encoded: segment,
        directory,
      })
      return directory
    } catch (error) {
      log.info("decoded directory invalid", {
        encoded: segment,
        reason: "decode-failed",
        error,
      })
      return
    }
  }
  const decodeGatewayUser = (
    token: string | undefined,
    timestamp: string | undefined,
    requestId: string | undefined,
    source: string,
  ) => {
    log.info("gateway headers", {
      source,
      token,
      timestamp,
      requestId,
    })
    if (!token || !timestamp) return
    try {
      const raw = decodeToken(token, timestamp, appsecret)
      const parsed = gatewayUser.safeParse(JSON.parse(raw))
      if (!parsed.success) {
        log.warn("gateway user parse failed", { source, raw })
        return
      }
      log.info("gateway user", {
        source,
        ...parsed.data,
      })
      return parsed.data.ename
    } catch (error) {
      log.warn("gateway token decode failed", {
        source,
        error,
      })
      return
    }
  }

  let _url: URL | undefined
  let _corsWhitelist: string[] = []

  export function url(): URL {
    return _url ?? new URL("http://localhost:4096")
  }

  const basePath = Flag.OPENCODE_BASE_PATH ? Flag.OPENCODE_BASE_PATH : ""
  const app = new Hono().basePath(basePath as "/")

  export const App: () => Hono = lazy(
    () =>
      // TODO: Break server.ts into smaller route files to fix type inference
      app
        .onError((err, c) => {
          log.error("failed", {
            error: err,
          })
          if (err instanceof NamedError) {
            let status: ContentfulStatusCode
            if (err instanceof NotFoundError) status = 404
            else if (err instanceof Provider.ModelNotFoundError) status = 400
            else if (err.name.startsWith("Worktree")) status = 400
            else status = 500
            return c.json(err.toObject(), { status })
          }
          if (err instanceof HTTPException) return err.getResponse()
          const message = err instanceof Error && err.stack ? err.stack : err.toString()
          return c.json(new NamedError.Unknown({ message }).toObject(), {
            status: 500,
          })
        })
        .use((c, next) => {
          // Allow CORS preflight requests to succeed without auth.
          // Browser clients sending Authorization headers will preflight with OPTIONS.
          if (c.req.method === "OPTIONS") return next()
          const password = Flag.OPENCODE_SERVER_PASSWORD
          if (!password) return next()
          const username = Flag.OPENCODE_SERVER_USERNAME ?? "opencode"
          return basicAuth({ username, password })(c, next)
        })
        .use(async (c, next) => {
          const skipLogging = c.req.path === "/log" || c.req.path === "/global/health" || c.req.path === "/kgbi/starbot/global/health"
          if (skipLogging) {
            await next()
            return
          }
          log.info("request", {
            method: c.req.method,
            path: c.req.path,
          })
          const timer = log.time("request", {
            method: c.req.method,
            path: c.req.path,
          })
          await next()
          timer.stop()
        })
        .use(
          cors({
            origin(input) {
              if (!input) return

              if (input.startsWith("http://localhost:")) return input
              if (input.startsWith("http://127.0.0.1:")) return input
              if (
                input === "tauri://localhost" ||
                input === "http://tauri.localhost" ||
                input === "https://tauri.localhost"
              )
                return input

              // *.opencode.ai (https only, adjust if needed)
              if (/^https:\/\/([a-z0-9-]+\.)*opencode\.ai$/.test(input)) {
                return input
              }
              if (_corsWhitelist.includes(input)) {
                return input
              }

              return
            },
          }),
        )
        .route("/global", GlobalRoutes())
        .put(
          "/auth/:providerID",
          describeRoute({
            summary: "Set auth credentials",
            description: "Set authentication credentials",
            operationId: "auth.set",
            responses: {
              200: {
                description: "Successfully set authentication credentials",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
              ...errors(400),
            },
          }),
          validator(
            "param",
            z.object({
              providerID: z.string(),
            }),
          ),
          validator("json", Auth.Info),
          async (c) => {
            const providerID = c.req.valid("param").providerID
            const info = c.req.valid("json")
            await Auth.set(providerID, info)
            return c.json(true)
          },
        )
        .delete(
          "/auth/:providerID",
          describeRoute({
            summary: "Remove auth credentials",
            description: "Remove authentication credentials",
            operationId: "auth.remove",
            responses: {
              200: {
                description: "Successfully removed authentication credentials",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
              ...errors(400),
            },
          }),
          validator(
            "param",
            z.object({
              providerID: z.string(),
            }),
          ),
          async (c) => {
            const providerID = c.req.valid("param").providerID
            await Auth.remove(providerID)
            return c.json(true)
          },
        )
        .use(async (c, next) => {
          if (c.req.path === "/log") return next()
          const raw = c.req.query("directory") || c.req.header("x-opencode-directory") || process.cwd()
          const directory = (() => {
            try {
              return decodeURIComponent(raw)
            } catch {
              return raw
            }
          })()
          return Instance.provide({
            directory,
            init: InstanceBootstrap,
            async fn() {
              return next()
            },
          })
        })
        .use(validator("query", z.object({ directory: z.string().optional() })))
        .route("/project", ProjectRoutes())
        .route("/pty", PtyRoutes())
        .route("/config", ConfigRoutes())
        .route("/experimental", ExperimentalRoutes())
        .route("/session", SessionRoutes())
        .route("/permission", PermissionRoutes())
        .route("/question", QuestionRoutes())
        .route("/provider", ProviderRoutes())
        .route("/", FileRoutes())
        .route("/mcp", McpRoutes())
        .route("/tui", TuiRoutes())
        .post(
          "/instance/dispose",
          describeRoute({
            summary: "Dispose instance",
            description: "Clean up and dispose the current OpenCode instance, releasing all resources.",
            operationId: "instance.dispose",
            responses: {
              200: {
                description: "Instance disposed",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
            },
          }),
          async (c) => {
            await Instance.dispose()
            return c.json(true)
          },
        )
        .get(
          "/path",
          describeRoute({
            summary: "Get paths",
            description:
              "Retrieve the current working directory and related path information for the OpenCode instance.",
            operationId: "path.get",
            responses: {
              200: {
                description: "Path",
                content: {
                  "application/json": {
                    schema: resolver(
                      z
                        .object({
                          home: z.string(),
                          state: z.string(),
                          config: z.string(),
                          worktree: z.string(),
                          directory: z.string(),
                        })
                        .meta({
                          ref: "Path",
                        }),
                    ),
                  },
                },
              },
            },
          }),
          async (c) => {
            return c.json({
              home: Global.Path.home,
              state: Global.Path.state,
              config: Global.Path.config,
              worktree: Instance.worktree,
              directory: Instance.directory,
            })
          },
        )
        .get(
          "/vcs",
          describeRoute({
            summary: "Get VCS info",
            description:
              "Retrieve version control system (VCS) information for the current project, such as git branch.",
            operationId: "vcs.get",
            responses: {
              200: {
                description: "VCS info",
                content: {
                  "application/json": {
                    schema: resolver(Vcs.Info),
                  },
                },
              },
            },
          }),
          async (c) => {
            const branch = await Vcs.branch()
            return c.json({
              branch,
            })
          },
        )
        .get(
          "/command",
          describeRoute({
            summary: "List commands",
            description: "Get a list of all available commands in the OpenCode system.",
            operationId: "command.list",
            responses: {
              200: {
                description: "List of commands",
                content: {
                  "application/json": {
                    schema: resolver(Command.Info.array()),
                  },
                },
              },
            },
          }),
          async (c) => {
            const commands = await Command.list()
            return c.json(commands)
          },
        )
        .post(
          "/log",
          describeRoute({
            summary: "Write log",
            description: "Write a log entry to the server logs with specified level and metadata.",
            operationId: "app.log",
            responses: {
              200: {
                description: "Log entry written successfully",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
              ...errors(400),
            },
          }),
          validator(
            "json",
            z.object({
              service: z.string().meta({ description: "Service name for the log entry" }),
              level: z.enum(["debug", "info", "error", "warn"]).meta({ description: "Log level" }),
              message: z.string().meta({ description: "Log message" }),
              extra: z
                .record(z.string(), z.any())
                .optional()
                .meta({ description: "Additional metadata for the log entry" }),
            }),
          ),
          async (c) => {
            const { service, level, message, extra } = c.req.valid("json")
            const logger = Log.create({ service })

            switch (level) {
              case "debug":
                logger.debug(message, extra)
                break
              case "info":
                logger.info(message, extra)
                break
              case "error":
                logger.error(message, extra)
                break
              case "warn":
                logger.warn(message, extra)
                break
            }

            return c.json(true)
          },
        )
        .get(
          "/agent",
          describeRoute({
            summary: "List agents",
            description: "Get a list of all available AI agents in the OpenCode system.",
            operationId: "app.agents",
            responses: {
              200: {
                description: "List of agents",
                content: {
                  "application/json": {
                    schema: resolver(Agent.Info.array()),
                  },
                },
              },
            },
          }),
          async (c) => {
            const modes = await Agent.list()
            return c.json(modes)
          },
        )
        .post(
          "/skill/clone",
          describeRoute({
            summary: "Clone skill from git",
            description: "Clone a skill repository from a git URL into the .opencode/skills directory.",
            operationId: "skill.clone",
            responses: {
              200: {
                description: "Clone succeeded",
                content: {
                  "application/json": {
                    schema: resolver(z.object({ ok: z.boolean() })),
                  },
                },
              },
              ...errors(400),
            },
          }),
          validator(
            "json",
            z.object({
              directory: z.string(),
              name: z.string(),
              gitUrl: z.string(),
            }),
          ),
          async (c) => {
            const { directory, name, gitUrl } = c.req.valid("json")
            const parsed = new URL(gitUrl)
            parsed.username = name
            parsed.password = "6bBshCz1222EXVlD4Q7M1i8x07A"
            const authedUrl = parsed.toString()

            const skillsDir = `${directory}/.opencode/skills`
            const { mkdir } = await import("fs/promises")
            await mkdir(skillsDir, { recursive: true })

            const proc = Bun.spawn(["git", "clone", authedUrl], { cwd: skillsDir })
            await proc.exited
            if (proc.exitCode !== 0) throw new NamedError.Unknown({ message: "git clone failed" })

            return c.json({ ok: true })
          },
        )
        .post(
          "/skill/pull",
          describeRoute({
            summary: "Pull skill from git",
            description: "Pull latest changes for a skill repository, overwriting local modifications.",
            operationId: "skill.pull",
            responses: {
              200: {
                description: "Pull succeeded",
                content: {
                  "application/json": {
                    schema: resolver(z.object({ ok: z.boolean() })),
                  },
                },
              },
              ...errors(400),
            },
          }),
          validator(
            "json",
            z.object({
              directory: z.string(),
              name: z.string(),
              skillDir: z.string(),
            }),
          ),
          async (c) => {
            const { name, skillDir } = c.req.valid("json")

            const toplevel = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], { cwd: skillDir })
            const repoDir = new TextDecoder().decode(toplevel.stdout).trim()
            if (toplevel.exitCode !== 0 || !repoDir)
              throw new NamedError.Unknown({ message: "该技能目录不是 git 仓库" })

            const remoteProc = Bun.spawnSync(["git", "remote", "get-url", "origin"], { cwd: repoDir })
            const remoteUrl = new TextDecoder().decode(remoteProc.stdout).trim()
            if (!remoteUrl)
              throw new NamedError.Unknown({ message: "无法获取远程仓库地址" })

            const parsed = new URL(remoteUrl)
            parsed.username = name
            parsed.password = "6bBshCz1222EXVlD4Q7M1i8x07A"
            const authedUrl = parsed.toString()

            Bun.spawnSync(["git", "remote", "set-url", "origin", authedUrl], { cwd: repoDir })

            const fetchProc = Bun.spawn(["git", "fetch", "origin"], { cwd: repoDir })
            await fetchProc.exited
            if (fetchProc.exitCode !== 0)
              throw new NamedError.Unknown({ message: "git fetch failed" })

            const branchProc = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoDir })
            const branch = new TextDecoder().decode(branchProc.stdout).trim() || "main"

            const resetProc = Bun.spawn(["git", "reset", "--hard", `origin/${branch}`], { cwd: repoDir })
            await resetProc.exited
            if (resetProc.exitCode !== 0)
              throw new NamedError.Unknown({ message: "git reset failed" })

            Bun.spawnSync(["git", "clean", "-fd"], { cwd: repoDir })

            return c.json({ ok: true })
          },
        )
        .post(
          "/skill/publish",
          describeRoute({
            summary: "Publish skill to git remote",
            description: "Check git status and push local skill changes to the remote repository.",
            operationId: "skill.publish",
            responses: {
              200: {
                description: "Publish result",
                content: {
                  "application/json": {
                    schema: resolver(z.object({ status: z.enum(["no-git", "remote-ahead", "pushed"]) })),
                  },
                },
              },
              ...errors(400),
            },
          }),
          validator(
            "json",
            z.object({
              directory: z.string(),
              name: z.string(),
              skillPath: z.string(),
            }),
          ),
          async (c) => {
            const { name, skillPath } = c.req.valid("json")

            const toplevel = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], { cwd: skillPath })
            if (toplevel.exitCode !== 0) return c.json({ status: "no-git" as const })
            const repoDir = new TextDecoder().decode(toplevel.stdout).trim()

            const remoteProc = Bun.spawnSync(["git", "remote", "get-url", "origin"], { cwd: repoDir })
            const remoteUrl = new TextDecoder().decode(remoteProc.stdout).trim()
            if (!remoteUrl) return c.json({ status: "no-git" as const })

            const parsed = new URL(remoteUrl)
            parsed.username = name
            parsed.password = "6bBshCz1222EXVlD4Q7M1i8x07A"
            const authedUrl = parsed.toString()

            const fetchProc = Bun.spawn(["git", "fetch", "origin"], { cwd: repoDir })
            await fetchProc.exited

            const branchProc = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoDir })
            const branch = new TextDecoder().decode(branchProc.stdout).trim() || "main"

            const aheadProc = Bun.spawnSync(["git", "log", `HEAD..origin/${branch}`, "--oneline"], { cwd: repoDir })
            const ahead = new TextDecoder().decode(aheadProc.stdout).trim()
            if (ahead) return c.json({ status: "remote-ahead" as const })

            Bun.spawnSync(["git", "add", "-A"], { cwd: repoDir })
            const diffProc = Bun.spawnSync(["git", "diff", "--cached", "--quiet"], { cwd: repoDir })
            if (diffProc.exitCode !== 0) {
              Bun.spawnSync(["git", "commit", "-m", "auto publish"], { cwd: repoDir })
            }

            const pushProc = Bun.spawn(["git", "push", authedUrl, branch], { cwd: repoDir })
            await pushProc.exited
            if (pushProc.exitCode !== 0) throw new NamedError.Unknown({ message: "git push failed" })

            return c.json({ status: "pushed" as const })
          },
        )
        .get(
          "/skill",
          describeRoute({
            summary: "List skills",
            description: "Get a list of all available skills in the OpenCode system.",
            operationId: "app.skills",
            responses: {
              200: {
                description: "List of skills",
                content: {
                  "application/json": {
                    schema: resolver(Skill.Info.array()),
                  },
                },
              },
            },
          }),
          async (c) => {
            const skills = await Skill.all()
            return c.json(skills)
          },
        )
        .get(
          "/lsp",
          describeRoute({
            summary: "Get LSP status",
            description: "Get LSP server status",
            operationId: "lsp.status",
            responses: {
              200: {
                description: "LSP server status",
                content: {
                  "application/json": {
                    schema: resolver(LSP.Status.array()),
                  },
                },
              },
            },
          }),
          async (c) => {
            return c.json(await LSP.status())
          },
        )
        .get(
          "/formatter",
          describeRoute({
            summary: "Get formatter status",
            description: "Get formatter status",
            operationId: "formatter.status",
            responses: {
              200: {
                description: "Formatter status",
                content: {
                  "application/json": {
                    schema: resolver(Format.Status.array()),
                  },
                },
              },
            },
          }),
          async (c) => {
            return c.json(await Format.status())
          },
        )
        .get(
          "/event",
          describeRoute({
            summary: "Subscribe to events",
            description: "Get events",
            operationId: "event.subscribe",
            responses: {
              200: {
                description: "Event stream",
                content: {
                  "text/event-stream": {
                    schema: resolver(BusEvent.payloads()),
                  },
                },
              },
            },
          }),
          async (c) => {
            log.info("event connected")
            c.header("X-Accel-Buffering", "no")
            c.header("X-Content-Type-Options", "nosniff")
            return streamSSE(c, async (stream) => {
              stream.writeSSE({
                data: JSON.stringify({
                  type: "server.connected",
                  properties: {},
                }),
              })
              const unsub = Bus.subscribeAll(async (event) => {
                await stream.writeSSE({
                  data: JSON.stringify(event),
                })
                if (event.type === Bus.InstanceDisposed.type) {
                  stream.close()
                }
              })

              // Send heartbeat every 10s to prevent stalled proxy streams.
              const heartbeat = setInterval(() => {
                stream.writeSSE({
                  data: JSON.stringify({
                    type: "server.heartbeat",
                    properties: {},
                  }),
                })
              }, 10_000)

              await new Promise<void>((resolve) => {
                stream.onAbort(() => {
                  clearInterval(heartbeat)
                  unsub()
                  resolve()
                  log.info("event disconnected")
                })
              })
            })
          },
        )
        .get(
          "/doc",
          openAPIRouteHandler(app, {
            documentation: {
              info: {
                title: "opencode",
                version: "0.0.3",
                description: "opencode api",
              },
              openapi: "3.1.1",
            },
          }),
        )
        .all("/*", async (c) => {
          let reqPath = c.req.path
          const basePath = Flag.OPENCODE_BASE_PATH

          // 如果 basePath 存在，由于 app.basePath() 被调用
          // 控制器仍会收到包含 basePath 的 c.req.path
          // 因此需要从 reqPath 中剥离它用于静态文件映射
          if (basePath && reqPath.startsWith(basePath)) {
            reqPath = reqPath.slice(basePath.length)
          }

          log.info("reqPath=", { reqPath })

          const host = c.req.header("host") ?? ""
          const local =
            host.startsWith("localhost") ||
            host.startsWith("127.0.0.1") ||
            host.startsWith("0.0.0.0")

          if (!local) {
            const parts = reqPath.split("/").filter(Boolean)
            const segment = parts[0]

            if (protectedPath(parts) && segment) {
              log.info("segment=", { segment })
              const directory = decodeDirectory(segment)
              const token = c.req.header("x-token")
              const timestamp = c.req.header("x-timestamp")
              const requestId = c.req.header("x-request-id")
              const user = decodeGatewayUser(token, timestamp, requestId, "protected")

              if (!directory) {
                log.warn("directory permission denied", {
                  reason: "decode-failed",
                  gatewayUser: user,
                  reqPath,
                })
                return c.json(denied, { status: 403 })
              }

              const account = directory.startsWith("/home/") ? directory.split("/")[2] : undefined
              if (account) {
                log.info("decoded home account", { directory, account })
              }

              if (!canAccess(user, account)) {
                log.warn("directory permission denied", {
                  account,
                  gatewayUser: user,
                  reqPath,
                })
                return c.json(denied, { status: 403 })
              }
            }

            if (reqPath === "" || reqPath === "/" || reqPath === basePath) {
              const token = c.req.header("x-token")
              const timestamp = c.req.header("x-timestamp")
              const requestId = c.req.header("x-request-id")
              const user = decodeGatewayUser(token, timestamp, requestId, "root")

              if (!user) {
                return c.json(denied, { status: 403 })
              }

              const directory = `/home/${user}`
              const encoded = base64Encode(directory)
              return c.redirect(`${basePath}/${encoded}/session`)
            }
          }

          const publicDir = Flag.OPENCODE_STATIC_DIR || "/usr/local/bin/ui"
          let file = Bun.file(`${publicDir}${reqPath}`)
          let exists = await file.exists()

          if (!exists && !reqPath.includes(".")) {
            file = Bun.file(`${publicDir}/index.html`)
            exists = await file.exists()
          }

          if (exists) {
            const response = new Response(file)
            return headers(response)
          }

          const response = await proxy(`https://app.opencode.ai${c.req.path}`, {
            ...c.req,
            headers: {
              ...c.req.raw.headers,
              host: "app.opencode.ai",
            },
          })
          return headers(response)
        }) as unknown as Hono,
  )

  export async function openapi() {
    // Cast to break excessive type recursion from long route chains
    const result = await generateSpecs(App() as Hono, {
      documentation: {
        info: {
          title: "opencode",
          version: "1.0.0",
          description: "opencode api",
        },
        openapi: "3.1.1",
      },
    })
    return result
  }

  export function listen(opts: {
    port: number
    hostname: string
    mdns?: boolean
    mdnsDomain?: string
    cors?: string[]
  }) {
    _corsWhitelist = opts.cors ?? []

    const args = {
      hostname: opts.hostname,
      idleTimeout: 0,
      fetch: App().fetch,
      websocket: websocket,
    } as const
    const tryServe = (port: number) => {
      try {
        return Bun.serve({ ...args, port })
      } catch {
        return undefined
      }
    }
    const server = opts.port === 0 ? (tryServe(4096) ?? tryServe(0)) : tryServe(opts.port)
    if (!server) throw new Error(`Failed to start server on port ${opts.port}`)

    _url = server.url

    const shouldPublishMDNS =
      opts.mdns &&
      server.port &&
      opts.hostname !== "127.0.0.1" &&
      opts.hostname !== "localhost" &&
      opts.hostname !== "::1"
    if (shouldPublishMDNS) {
      MDNS.publish(server.port!, opts.mdnsDomain)
    } else if (opts.mdns) {
      log.warn("mDNS enabled but hostname is loopback; skipping mDNS publish")
    }

    const originalStop = server.stop.bind(server)
    server.stop = async (closeActiveConnections?: boolean) => {
      if (shouldPublishMDNS) MDNS.unpublish()
      return originalStop(closeActiveConnections)
    }

    return server
  }
}
