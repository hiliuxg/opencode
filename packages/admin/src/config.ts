import { join } from "node:path"
import { homedir } from "node:os"

export const Config = {
  /** Server port */
  port: Number(process.env.ADMIN_PORT ?? 8787),
  /** Server host */
  hostname: process.env.ADMIN_HOST ?? "0.0.0.0",
  /** MySQL Database configuration */
  db: {
    host: process.env.MYSQL_HOST ?? "localhost",
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER ?? "root",
    password: process.env.MYSQL_PASSWORD ?? "password",
    database: process.env.MYSQL_DATABASE ?? "admin_db",
  },
  /** Storage configuration */
  skills: {
    storageDir: process.env.SKILLS_STORAGE_DIR ?? join(process.cwd(), "storage", "skills"),
    syncScript: process.env.SKILL_SYNC_SCRIPT ?? join(process.cwd(), "..", "..", "scripts", "skill_sync.sh"),
  }
}
