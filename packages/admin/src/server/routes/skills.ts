import { Hono } from "hono"
import { eq, desc, and } from "drizzle-orm"
import { getDb, schema } from "../../db/client"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Config } from "../../config"

const { skills, skillVersions } = schema

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function SkillsRoutes() {
    const app = new Hono()
    const STORAGE_DIR = Config.skills.storageDir

    // Ensure storage directory exists
    mkdir(STORAGE_DIR, { recursive: true }).catch(console.error)

    // ---- LIST ---------------------------------------------------------------
    app.get("/", async (c) => {
        const db = getDb()
        const catalog = c.req.query("catalog")
        const name = c.req.query("name")

        let query = db.select({
            id: skills.id,
            name: skills.name,
            catalog: skills.catalog,
            description: skills.description,
            userId: skills.userId,
            stars: skills.stars,
            createdAt: skills.createdAt,
            updatedAt: skills.updatedAt,
            latestVersion: skillVersions.version,
        })
            .from(skills)
            .leftJoin(skillVersions, eq(skills.id, skillVersions.skillId))
        // We only want the latest version. In a real app we might need a subquery or window function.
        // For simplicity, we can fetch all and dedup in memory or use a raw query.
        // Or simpler: just list skills and optionally fetch latest version.
        // Let's stick to Drizzle:
        // A better approach is to store `latest_version` on the `skills` table for performance,
        // but since we don't have that, let's just list skills and separate version fetching or join.
        // Actually, let's use a subquery approach if possible, or just list skills and let frontend fetch versions?
        // No, list usually needs version.
        // Let's keep it simple: List skills, and for each skill, find the latest version.
        // N+1 issue but okay for small scale.

        const filters = []
        if (catalog) filters.push(eq(skills.catalog, catalog))
        if (name) filters.push(eq(skills.name, name))

        const skillList = await db.query.skills.findMany({
            where: and(...filters),
            orderBy: [desc(skills.updatedAt)],
            with: {
                // accessing relations would need definition in schema.ts
                // since we didn't define relations (yet), let's do manual query
            }
        })

        // Fetch latest versions manually
        const results = await Promise.all(skillList.map(async (skill: any) => {
            const versions = await db.select()
                .from(skillVersions)
                .where(eq(skillVersions.skillId, skill.id))
                .orderBy(desc(skillVersions.version)) // assuming YYYYMMDD format string sorts correctly
                .limit(1)

            return {
                ...skill,
                latestVersion: versions[0]?.version || null
            }
        }))

        return c.json({ ok: true, items: results })
    })

    // ---- CREATE/UPDATE (multipart/form-data from shell script curl) ---------
    app.post("/", async (c) => {
        const formData = await c.req.formData().catch(() => null)
        if (!formData) {
            return c.json({ ok: false, error: "invalid_form_data" }, 400)
        }

        const file = formData.get("file") as File | null
        const name = formData.get("name") as string | null
        const catalog = formData.get("catalog") as string | null
        const version = formData.get("version") as string | null
        const userId = formData.get("userId") as string | null
        const description = (formData.get("description") as string) || ""

        if (!file || !name || !catalog || !version || !userId) {
            return c.json({ ok: false, error: "missing_fields", message: "file, name, catalog, version, userId are required" }, 400)
        }

        const db = getDb()

        // Resolve user
        let ownerId: number
        const [user] = await db.select().from(schema.users).where(eq(schema.users.name, userId))
        if (!user) {
            const numId = Number(userId)
            if (!isNaN(numId)) {
                ownerId = numId
            } else {
                return c.json({ ok: false, error: "user_not_found", message: `User '${userId}' not found` }, 404)
            }
        } else {
            ownerId = user.id
        }

        // Upsert skill record
        let skillId: number
        const [existing] = await db.select().from(skills).where(and(eq(skills.name, name), eq(skills.catalog, catalog)))

        if (existing) {
            skillId = existing.id
            const [existingVersion] = await db.select().from(skillVersions).where(and(eq(skillVersions.skillId, skillId), eq(skillVersions.version, version)))
            if (existingVersion) {
                return c.json({ ok: false, error: "version_exists", message: `Version ${version} already exists` }, 409)
            }
            await db.update(skills).set({ updatedAt: new Date(), description: description || existing.description }).where(eq(skills.id, skillId))
        } else {
            const result = await db.insert(skills).values({
                name,
                catalog,
                description,
                userId: ownerId,
            } as any)
            skillId = Number(result[0].insertId)
        }

        // Save uploaded tar.gz directly (no local packing needed)
        const fileName = `${skillId}-${version}.tar.gz`
        const finalPath = join(STORAGE_DIR, fileName)
        const buffer = await file.arrayBuffer()
        await writeFile(finalPath, Buffer.from(buffer))

        await db.insert(skillVersions).values({
            skillId,
            version,
            path: finalPath,
        } as any)

        return c.json({ ok: true, skillId, version })
    })

    // ---- DOWNLOAD -----------------------------------------------------------
    app.get("/:id/download", async (c) => {
        const id = Number(c.req.param("id"))
        if (isNaN(id)) return c.json({ ok: false, error: "invalid_id" }, 400)

        const db = getDb()

        // Find skill
        const [skill] = await db.select().from(skills).where(eq(skills.id, id))
        if (!skill) return c.json({ ok: false, error: "skill_not_found" }, 404)

        // Find latest version
        const [latestVersion] = await db.select()
            .from(skillVersions)
            .where(eq(skillVersions.skillId, id))
            .orderBy(desc(skillVersions.version))
            .limit(1)

        if (!latestVersion) return c.json({ ok: false, error: "version_not_found" }, 404)

        const file = Bun.file(latestVersion.path)
        if (!(await file.exists())) {
            return c.json({ ok: false, error: "file_not_found" }, 404)
        }

        const fileName = `${skill.name}-${latestVersion.version}.tar.gz`
        c.header('Content-Type', 'application/gzip')
        c.header('Content-Disposition', `attachment; filename="${fileName}"`)

        return c.body(file.stream() as any)
    })

    // /install 路由已移除 — 解压由 opencode 服务器的 skill_sync.sh 脚本完成

    return app
}
