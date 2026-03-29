import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import fs from "fs"
import nodePath from "path"
import { File } from "../../file"
import { Ripgrep } from "../../file/ripgrep"
import { LSP } from "../../lsp"
import { Instance } from "../../project/instance"
import { lazy } from "../../util/lazy"
import { Filesystem } from "../../util/filesystem"
import { errors } from "../error"

export const FileRoutes = lazy(() =>
  new Hono()
    .get(
      "/find",
      describeRoute({
        summary: "Find text",
        description: "Search for text patterns across files in the project using ripgrep.",
        operationId: "find.text",
        responses: {
          200: {
            description: "Matches",
            content: {
              "application/json": {
                schema: resolver(Ripgrep.Match.shape.data.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          pattern: z.string(),
        }),
      ),
      async (c) => {
        const pattern = c.req.valid("query").pattern
        const result = await Ripgrep.search({
          cwd: Instance.directory,
          pattern,
          limit: 10,
        })
        return c.json(result)
      },
    )
    .get(
      "/find/file",
      describeRoute({
        summary: "Find files",
        description: "Search for files or directories by name or pattern in the project directory.",
        operationId: "find.files",
        responses: {
          200: {
            description: "File paths",
            content: {
              "application/json": {
                schema: resolver(z.string().array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          query: z.string(),
          dirs: z.enum(["true", "false"]).optional(),
          type: z.enum(["file", "directory"]).optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query").query
        const dirs = c.req.valid("query").dirs
        const type = c.req.valid("query").type
        const limit = c.req.valid("query").limit
        const results = await File.search({
          query,
          limit: limit ?? 10,
          dirs: dirs !== "false",
          type,
        })
        return c.json(results)
      },
    )
    .get(
      "/find/symbol",
      describeRoute({
        summary: "Find symbols",
        description: "Search for workspace symbols like functions, classes, and variables using LSP.",
        operationId: "find.symbols",
        responses: {
          200: {
            description: "Symbols",
            content: {
              "application/json": {
                schema: resolver(LSP.Symbol.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          query: z.string(),
        }),
      ),
      async (c) => {
        /*
      const query = c.req.valid("query").query
      const result = await LSP.workspaceSymbol(query)
      return c.json(result)
      */
        return c.json([])
      },
    )
    .get(
      "/file",
      describeRoute({
        summary: "List files",
        description: "List files and directories in a specified path.",
        operationId: "file.list",
        responses: {
          200: {
            description: "Files and directories",
            content: {
              "application/json": {
                schema: resolver(File.Node.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          path: z.string(),
        }),
      ),
      async (c) => {
        const path = c.req.valid("query").path
        const content = await File.list(path)
        return c.json(content)
      },
    )
    .delete(
      "/file",
      describeRoute({
        summary: "Delete file or directory",
        description:
          "Delete a specified file or directory from the project. If `path` points to a file, only that file is removed; if it points to a directory, the directory and all of its contents are removed. Use the `directory` query parameter to select the project instance, consistent with other file routes.",
        operationId: "file.delete",
        responses: {
          200: {
            description: "Success",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.boolean() })),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          directory: z.string().optional(),
          path: z.string(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const full = nodePath.resolve(Instance.directory, query.path)
        if (!Instance.containsPath(full)) {
          return c.json({ error: "Access denied: path escapes project directory" }, 403)
        }
        const root = nodePath.resolve(Instance.directory)
        if (full === root) {
          return c.json({ error: "Cannot delete project root directory" }, 400)
        }
        if (!(await Filesystem.exists(full))) {
          return c.json({ error: "Path not found" }, 404)
        }
        await fs.promises.rm(full, { recursive: true })
        return c.json({ success: true })
      },
    )
    .get(
      "/file/content",
      describeRoute({
        summary: "Read file",
        description: "Read the content of a specified file.",
        operationId: "file.read",
        responses: {
          200: {
            description: "File content",
            content: {
              "application/json": {
                schema: resolver(File.Content),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          path: z.string(),
        }),
      ),
      async (c) => {
        const path = c.req.valid("query").path
        const content = await File.read(path)
        return c.json(content)
      },
    )
    .get(
      "/file/status",
      describeRoute({
        summary: "Get file status",
        description: "Get the git status of all files in the project.",
        operationId: "file.status",
        responses: {
          200: {
            description: "File status",
            content: {
              "application/json": {
                schema: resolver(File.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const content = await File.status()
        return c.json(content)
      },
    )
    .put(
      "/file/content",
      describeRoute({
        summary: "Write file",
        description: "Write content to a specified file.",
        operationId: "file.write",
        responses: {
          200: {
            description: "Success",
          },
        },
      }),
      validator(
        "query",
        z.object({
          path: z.string(),
        }),
      ),
      validator(
        "json",
        z.object({
          content: z.string(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const body = c.req.valid("json")
        await File.write(query.path, body.content)
        return c.json({ success: true })
      },
    )
    .get(
      "/file/download",
      describeRoute({
        summary: "Download file",
        description: "Download a specified file from the project.",
        operationId: "file.download",
        responses: {
          200: {
            description: "File content",
            content: {
              "application/octet-stream": {
                schema: resolver(z.string()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          path: z.string(),
        }),
      ),
      async (c) => {
        const filePath = c.req.valid("query").path
        const full = nodePath.resolve(Instance.directory, filePath)
        if (!Instance.containsPath(full)) {
          return c.json({ error: "Access denied: path escapes project directory" }, 403)
        }
        const file = Bun.file(full)
        if (!(await file.exists())) {
          return c.json({ error: "File not found" }, 404)
        }
        const filename = nodePath.basename(full)
        const encoded = encodeURIComponent(filename)
        c.header("Content-Disposition", `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`)
        c.header("Content-Type", file.type || "application/octet-stream")
        return c.body(file.stream())
      },
    )
    .get(
      "/file/view",
      describeRoute({
        summary: "View file in browser",
        description: "View file content directly in browser. Supports HTML (rendered), PDF (inline), and text files.",
        operationId: "file.view",
        responses: {
          200: {
            description: "File content rendered in browser",
          },
          ...errors(400, 403, 404),
        },
      }),
      validator(
        "query",
        z.object({
          path: z.string().describe("Absolute path to the file to view"),
        }),
      ),
      async (c) => {
        const filePath = c.req.valid("query").path
        const full = nodePath.resolve(Instance.directory, filePath)
        if (!Instance.containsPath(full)) {
          return c.json({ error: "Access denied: path escapes project directory" }, 403)
        }
        if (!(await Filesystem.exists(full))) {
          return c.json({ error: "File not found" }, 404)
        }

        const lowerPath = full.toLowerCase()

        // PDF files - return binary for browser to render inline
        if (lowerPath.endsWith(".pdf")) {
          const buffer = await Filesystem.readBytes(full)
          c.header("Content-Type", "application/pdf")
          c.header("Content-Disposition", "inline")
          return c.body(new Uint8Array(buffer))
        }

        // HTML files - return text/html for browser to render
        if (lowerPath.endsWith(".html") || lowerPath.endsWith(".htm")) {
          const content = await Filesystem.readText(full)
          c.header("Content-Type", "text/html; charset=utf-8")
          return c.body(content)
        }

        // Text files - return text/plain
        const content = await File.read(filePath)
        if (content.type === "binary") {
          return c.json({ error: "Binary files cannot be viewed in browser. Use /file/download instead." }, 400)
        }
        c.header("Content-Type", "text/plain; charset=utf-8")
        return c.body(content.content)
      },
    ),
)
