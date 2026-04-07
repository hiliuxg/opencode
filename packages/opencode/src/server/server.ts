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
import { Skill } from "../skill"
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
import "./projectors"

// @ts-ignore This global is needed to prevent ai-sdk from logging warnings to stdout https://github.com/vercel/ai/blob/2dc67e0ef538307f21368db32d5a12345d98831b/packages/ai/src/logger/log-warnings.ts#L85
globalThis.AI_SDK_LOG_WARNINGS = false

export namespace Server {
  const log = Log.create({ service: "server" })
  const csp =
    "default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; media-src 'self' data:; connect-src 'self' data: localhost:* 127.0.0.1:* https://kudata-agent.tmeoa.com https://passport.tmeoa.com https://opencode.ai; manifest-src 'self' https://passport.tmeoa.com"
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
          validator("json", Auth.Info.zod),
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
        .get(
          "/skill/repos",
          describeRoute({
            summary: "List skill marketplace repositories",
            description:
              "Fetches the full skill marketplace repo list from the configured HTTP API by paging with page and page_size until all rows are loaded. Requires OPENCODE_SKILL_MARKET_TOKEN; optional OPENCODE_SKILL_MARKET_REPOS_URL and OPENCODE_SKILL_MARKET_PAGE_SIZE.",
            operationId: "skill.repos",
            responses: {
              200: {
                description: "Marketplace repositories",
                content: {
                  "application/json": {
                    schema: resolver(
                      z
                        .object({
                          id: z.string(),
                          name: z.string(),
                          description: z.string(),
                          web_url: z.string(),
                        })
                        .array(),
                    ),
                  },
                },
              },
              503: {
                description: "Marketplace not configured",
                content: {
                  "application/json": {
                    schema: resolver(z.object({ message: z.string() })),
                  },
                },
              },
            },
          }),
          async (c) => {
            const apiUrl = Flag.OPENCODE_SKILL_MARKET_REPOS_URL?.trim()
            const auth = Flag.OPENCODE_SKILL_MARKET_TOKEN?.trim()
            if (!apiUrl) {
              return c.json({ message: "Skill marketplace URL not configured (OPENCODE_SKILL_MARKET_REPOS_URL)" }, 503)
            }
            if (!auth) {
              return c.json({ message: "Skill marketplace token not configured (OPENCODE_SKILL_MARKET_TOKEN)" }, 503)
            }
            const pageSize = Flag.OPENCODE_SKILL_MARKET_PAGE_SIZE
            const row = z.object({
              id: z.string(),
              name: z.string(),
              description: z.union([z.string(), z.null()]).optional(),
              web_url: z.string(),
            })
            const parsePage = (body: unknown) => z.array(row).parse(body)

            const combined: z.infer<typeof row>[] = []
            let page = 1
            const maxPages = 500

            for (;;) {
              if (page > maxPages) {
                log.warn("[skill/repos] stopped at max page cap", { maxPages, pageSize })
                break
              }
              const url = new URL(apiUrl)
              url.searchParams.set("page", String(page))
              url.searchParams.set("page_size", String(pageSize))
              const upstream = await fetch(url.toString(), {
                headers: {
                  Accept: "application/vnd.cnb.api+json",
                  Authorization: auth,
                },
              })
              if (!upstream.ok) {
                log.warn("[skill/repos] upstream failed", { status: upstream.status, page })
                return c.json({ message: `Skill marketplace request failed: ${upstream.status}` }, 502)
              }
              const body = await upstream.json()
              const list = parsePage(body)
              combined.push(...list)
              if (list.length < pageSize) break
              page += 1
            }

            return c.json(
              combined.map((r) => ({
                id: r.id,
                name: r.name,
                description: r.description ?? "",
                web_url: r.web_url,
              })),
            )
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
            log.info("[skill/pull] starting", { name, skillDir })

            const toplevel = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], { cwd: skillDir })
            const repoDir = new TextDecoder().decode(toplevel.stdout).trim()
            if (toplevel.exitCode !== 0 || !repoDir) {
              log.error("[skill/pull] not a git repository", { skillDir, exitCode: toplevel.exitCode })
              throw new NamedError.Unknown({ message: "该技能目录不是 git 仓库" })
            }
            log.info("[skill/pull] git toplevel detected", { repoDir })

            const currentBranchProc = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoDir })
            const currentBranch = new TextDecoder().decode(currentBranchProc.stdout).trim()
            log.info("[skill/pull] current branch before pull", { currentBranch })

            const remoteProc = Bun.spawnSync(["git", "remote", "get-url", "origin"], { cwd: repoDir })
            const remoteUrl = new TextDecoder().decode(remoteProc.stdout).trim()
            if (!remoteUrl) {
              log.error("[skill/pull] no remote origin", { repoDir })
              throw new NamedError.Unknown({ message: "无法获取远程仓库地址" })
            }
            const safeRemote = remoteUrl.replace(/:\/\/([^:@/]+):([^@/]+)@/, "://$1:***@")
            log.info("[skill/pull] remote url", { remoteUrl: safeRemote })

            const parsed = new URL(remoteUrl)
            parsed.username = name
            parsed.password = "6bBshCz1222EXVlD4Q7M1i8x07A"
            const authedUrl = parsed.toString()

            Bun.spawnSync(["git", "remote", "set-url", "origin", authedUrl], { cwd: repoDir })
            log.info("[skill/pull] remote url set with auth")

            const fetchProc = Bun.spawn(["git", "fetch", "origin"], { cwd: repoDir })
            await fetchProc.exited
            log.info("[skill/pull] fetch completed", { exitCode: fetchProc.exitCode })
            if (fetchProc.exitCode !== 0) {
              log.error("[skill/pull] fetch failed", { exitCode: fetchProc.exitCode })
              throw new NamedError.Unknown({ message: "git fetch failed" })
            }

            const defaultBranchProc = Bun.spawnSync(["git", "symbolic-ref", "refs/remotes/origin/HEAD"], { cwd: repoDir })
            const defaultBranchRef = new TextDecoder().decode(defaultBranchProc.stdout).trim()
            const defaultBranch = defaultBranchRef.replace("refs/remotes/origin/", "") || "main"
            log.info("[skill/pull] detected default branch", { defaultBranch, defaultBranchRef })

            const checkoutProc = Bun.spawnSync(["git", "checkout", defaultBranch], { cwd: repoDir })
            if (checkoutProc.exitCode !== 0) {
              const checkoutErr = new TextDecoder().decode(checkoutProc.stderr).trim()
              log.error("[skill/pull] checkout failed", { err: checkoutErr, defaultBranch })
              throw new NamedError.Unknown({ message: `git checkout ${defaultBranch} failed: ${checkoutErr}` })
            }
            log.info("[skill/pull] switched to default branch", { defaultBranch })

            const resetProc = Bun.spawn(["git", "reset", "--hard", `origin/${defaultBranch}`], { cwd: repoDir })
            await resetProc.exited
            log.info("[skill/pull] reset completed", { exitCode: resetProc.exitCode, defaultBranch })
            if (resetProc.exitCode !== 0) {
              log.error("[skill/pull] reset failed", { exitCode: resetProc.exitCode, defaultBranch })
              throw new NamedError.Unknown({ message: "git reset failed" })
            }

            const cleanProc = Bun.spawnSync(["git", "clean", "-fd"], { cwd: repoDir })
            log.info("[skill/pull] clean completed", { exitCode: cleanProc.exitCode })

            const finalBranchProc = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoDir })
            const finalBranch = new TextDecoder().decode(finalBranchProc.stdout).trim()
            log.info("[skill/pull] completed successfully", { finalBranch, repoDir })

            return c.json({ ok: true })
          },
        )
        .post(
          "/skill/push",
          describeRoute({
            summary: "Push skill to git remote",
            description:
              "Check git status and push local skill changes to the remote repository on a new branch. Requires OPENCODE_SKILL_MARKET_TOKEN for HTTPS authentication to origin.",
            operationId: "skill.push",
            responses: {
              200: {
                description: "Push result",
                content: {
                  "application/json": {
                    schema: resolver(
                      z.object({
                        status: z.enum(["no-git", "no-changes", "pushed"]),
                        branchUrl: z.string().optional(),
                      }),
                    ),
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
              commitMessage: z.string(),
            }),
          ),
          async (c) => {
            const { name, skillPath, commitMessage } = c.req.valid("json")
            log.info("[skill/push] starting", { name, skillPath })

            const toplevel = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], { cwd: skillPath })
            if (toplevel.exitCode !== 0) {
              log.warn("[skill/push] not a git repository", { skillPath, exitCode: toplevel.exitCode })
              return c.json({ status: "no-git" as const })
            }
            const repoDir = new TextDecoder().decode(toplevel.stdout).trim()
            log.info("[skill/push] git toplevel detected", { repoDir, skillPath })

            const currentBranchProc = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoDir })
            const originalBranch = new TextDecoder().decode(currentBranchProc.stdout).trim()
            log.info("[skill/push] current branch before push", { originalBranch })

            const remoteProc = Bun.spawnSync(["git", "remote", "get-url", "origin"], { cwd: repoDir })
            const remoteUrl = new TextDecoder().decode(remoteProc.stdout).trim()
            if (!remoteUrl) {
              log.warn("[skill/push] no remote origin", { repoDir })
              return c.json({ status: "no-git" as const })
            }
            const safeRemote = remoteUrl.replace(/:\/\/([^:@/]+):([^@/]+)@/, "://$1:***@")
            log.info("[skill/push] remote url", { remoteUrl: safeRemote })

            const marketToken = Flag.OPENCODE_SKILL_MARKET_TOKEN?.trim()
            if (!marketToken) {
              throw new NamedError.Unknown({
                message: "Skill marketplace token not configured (OPENCODE_SKILL_MARKET_TOKEN)",
              })
            }

            const parsed = new URL(remoteUrl)
            parsed.username = name
            parsed.password = marketToken
            const authedUrl = parsed.toString()
            const repoName = parsed.pathname.split("/").pop()?.replace(/\.git$/, "") ?? ""
            log.info("[skill/push] built auth url", { host: parsed.host, pathname: parsed.pathname, username: parsed.username, repoName })

            Bun.spawnSync(["git", "add", "-A"], { cwd: repoDir })
            log.info("[skill/push] git add -A done")

            const diffExit = Bun.spawnSync(["git", "diff", "--cached", "--quiet"], { cwd: repoDir }).exitCode
            log.info("[skill/push] staged diff check", { hasStagedChanges: diffExit !== 0, diffExit })

            const untrackedProc = Bun.spawnSync(["git", "status", "--porcelain"], { cwd: repoDir })
            const untracked = new TextDecoder().decode(untrackedProc.stdout).trim()
            log.info("[skill/push] untracked files check", { hasUntrackedFiles: !!untracked, untrackedCount: untracked ? untracked.split("\n").length : 0 })

            const hasChanges = diffExit !== 0 || !!untracked
            log.info("[skill/push] changes check", { hasChanges, hasStagedChanges: diffExit !== 0, hasUntrackedFiles: !!untracked })

            if (!hasChanges) {
              log.info("[skill/push] no changes to commit, returning no-changes")
              return c.json({ status: "no-changes" as const })
            }

            const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
            let suffix = ""
            for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)]
            const newBranch = `push-${suffix}`
            log.info("[skill/push] creating new branch", { newBranch, originalBranch })

            const checkoutProc = Bun.spawnSync(["git", "checkout", "-b", newBranch], { cwd: repoDir })
            if (checkoutProc.exitCode !== 0) {
              const err = new TextDecoder().decode(checkoutProc.stderr).trim()
              log.error("[skill/push] checkout failed", { err, newBranch })
              throw new NamedError.Unknown({ message: `git checkout -b failed: ${err}` })
            }
            log.info("[skill/push] successfully switched to new branch", { newBranch })

            Bun.spawnSync(["git", "add", "-A"], { cwd: repoDir })
            log.info("[skill/push] git add -A on new branch done")

            const email = `${name}@tencentmusic.com`
            const commitProc = Bun.spawnSync(
              ["git", "-c", `user.name=${name}`, "-c", `user.email=${email}`, "commit", "-m", commitMessage],
              { cwd: repoDir },
            )
            const commitOutput = new TextDecoder().decode(commitProc.stdout).trim()
            const commitError = new TextDecoder().decode(commitProc.stderr).trim()
            log.info("[skill/push] git commit done", { exitCode: commitProc.exitCode, name, email, output: commitOutput || null, stderr: commitError || null })
            if (commitProc.exitCode !== 0) {
              log.error("[skill/push] commit failed, cleaning up", { exitCode: commitProc.exitCode, newBranch })
              Bun.spawnSync(["git", "checkout", originalBranch], { cwd: repoDir })
              Bun.spawnSync(["git", "branch", "-D", newBranch], { cwd: repoDir })
              throw new NamedError.Unknown({ message: commitError || "git commit failed" })
            }
            log.info("[skill/push] commit successful", { commitMessage: commitMessage.slice(0, 50) })

            const pushProc = Bun.spawn(["git", "push", authedUrl, newBranch], {
              cwd: repoDir,
              stdout: "pipe",
              stderr: "pipe",
            })
            log.info("[skill/push] git push started", { newBranch, authedUrl: authedUrl.replace(/:[^@]+@/, ":***@") })
            await pushProc.exited
            const pushStdout = (await new Response(pushProc.stdout).text()).trim()
            const pushStderr = (await new Response(pushProc.stderr).text()).trim()
            log.info("[skill/push] git push result", { exitCode: pushProc.exitCode, success: pushProc.exitCode === 0, stdout: pushStdout || null, stderr: pushStderr || null })

            if (pushProc.exitCode !== 0) {
              log.error("[skill/push] git push failed, cleaning up", { exitCode: pushProc.exitCode, newBranch })
              Bun.spawnSync(["git", "checkout", originalBranch], { cwd: repoDir })
              Bun.spawnSync(["git", "branch", "-D", newBranch], { cwd: repoDir })
              throw new NamedError.Unknown({ message: "git push failed" })
            }

            const finalBranchProc = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoDir })
            const finalBranch = new TextDecoder().decode(finalBranchProc.stdout).trim()
            log.info("[skill/push] push successful", { newBranch, finalBranch, originalBranch })

            const marketUrl = `https://kudata-agent.tmeoa.com/skill-market/${repoName}`
            log.info("[skill/push] returning success", { newBranch, marketUrl, repoDir })
            return c.json({ status: "pushed" as const, "branchUrl": marketUrl })
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
          let basePath = Flag.OPENCODE_BASE_PATH

          // 规范化 basePath，去除尾部斜杠
          if (basePath) {
            basePath = basePath.replace(/\/$/, "")
          }

          // 剥离 basePath 用于静态文件映射
          if (basePath && reqPath.startsWith(basePath)) {
            reqPath = reqPath.slice(basePath.length)
          }

          // 确保 reqPath 以 / 开头
          if (reqPath && !reqPath.startsWith("/")) {
            reqPath = "/" + reqPath
          }

          const host = c.req.header("host") ?? ""
          const local =
            host.startsWith("localhost") ||
            host.startsWith("127.0.0.1") ||
            host.startsWith("0.0.0.0")

          if (!local) {
            const parts = reqPath.split("/").filter(Boolean)
            const segment = parts[0]
            const isDashboard = reqPath.toLowerCase() === "/dashboard"

            // Dashboard 是公开 SPA 路由，跳过目录权限检查
            if (!isDashboard && protectedPath(parts) && segment) {
              const directory = decodeDirectory(segment)
              const token = c.req.header("x-token")
              const timestamp = c.req.header("x-timestamp")
              const requestId = c.req.header("x-request-id")
              const user = decodeGatewayUser(token, timestamp, requestId, "protected")

              if (!directory) {
                return c.json(denied, { status: 403 })
              }

              const account = directory.startsWith("/home/") ? directory.split("/")[2] : undefined

              if (!canAccess(user, account)) {
                return c.json(denied, { status: 403 })
              }
            }

            // 根路径重定向到用户默认 session
            if (reqPath === "" || reqPath === "/") {
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

          // SPA 路由回退到 index.html
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

  export const Default = App

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
