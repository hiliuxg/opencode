import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { File } from "../../file"
import { Ripgrep } from "../../file/ripgrep"
import { LSP } from "../../lsp"
import { Instance } from "../../project/instance"
import { lazy } from "../../util/lazy"

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
    .post(
      "/file/write",
      describeRoute({
        summary: "Write file",
        description: "Write or upload a single file. Use encoding base64 for binary files.",
        operationId: "file.write",
        responses: {
          200: {
            description: "Success",
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
        },
      }),
      validator(
        "json",
        z.object({
          path: z.string(),
          content: z.string(),
          encoding: z.literal("base64").optional(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        await File.write(body.path, body.content, body.encoding)
        return c.json(true)
      },
    )
    .post(
      "/file/mkdir",
      describeRoute({
        summary: "Create directory",
        description: "Recursively create a directory.",
        operationId: "file.mkdir",
        responses: {
          200: {
            description: "Success",
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
        },
      }),
      validator("json", z.object({ path: z.string() })),
      async (c) => {
        await File.mkdir(c.req.valid("json").path)
        return c.json(true)
      },
    )
    .post(
      "/file/delete",
      describeRoute({
        summary: "Delete file or directory",
        description: "Delete a file or directory (recursive for directories).",
        operationId: "file.delete",
        responses: {
          200: {
            description: "Success",
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
        },
      }),
      validator("json", z.object({ path: z.string() })),
      async (c) => {
        await File.remove(c.req.valid("json").path)
        return c.json(true)
      },
    )
    .post(
      "/file/rename",
      describeRoute({
        summary: "Rename or move file",
        description: "Rename or move a file or directory.",
        operationId: "file.rename",
        responses: {
          200: {
            description: "Success",
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
        },
      }),
      validator(
        "json",
        z.object({
          oldPath: z.string(),
          newPath: z.string(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        await File.rename(body.oldPath, body.newPath)
        return c.json(true)
      },
    )
    .get(
      "/file/share",
      describeRoute({
        summary: "Share file",
        description: "Upload a file to the report server and return a shareable URL.",
        operationId: "file.share",
        responses: {
          200: {
            description: "Shareable URL",
            content: { "application/json": { schema: resolver(z.object({ url: z.string() })) } },
          },
        },
      }),
      validator("query", z.object({ path: z.string() })),
      async (c) => {
        const url = await File.share(c.req.valid("query").path)
        return c.json({ url })
      },
    )
    .get(
      "/file/serve",
      describeRoute({
        summary: "Serve file",
        description: "Return raw file content with correct Content-Type for inline preview.",
        operationId: "file.serve",
        responses: {
          200: {
            description: "File content",
          },
        },
      }),
      validator("query", z.object({ path: z.string() })),
      async (c) => {
        const result = await File.serve(c.req.valid("query").path)
        return new Response(Buffer.from(result.data), {
          headers: {
            "Content-Type": result.mime,
            "Cache-Control": "no-cache",
          },
        })
      },
    )
    .get(
      "/file/download",
      describeRoute({
        summary: "Download file or directory",
        description:
          "Download a file directly or a directory as a zip archive.",
        operationId: "file.download",
        responses: {
          200: {
            description: "File or zip download",
          },
        },
      }),
      validator("query", z.object({ path: z.string() })),
      async (c) => {
        const result = await File.download(c.req.valid("query").path)
        return new Response(Buffer.from(result.data), {
          headers: {
            "Content-Type": result.mime,
            "Content-Disposition": `attachment; filename="${encodeURIComponent(result.filename)}"`,
          },
        })
      },
    ),
)
