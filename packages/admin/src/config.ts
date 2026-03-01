import { join } from "node:path"

export const Config = {
  /** Server port */
  port: 8787,
  /** Server host */
  hostname: "0.0.0.0",
  basepath: "",
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
  },
  /** Guided Topics configuration */
  guidedTopics: {
    /** OpenCode server URL */
    opencodeHost: process.env.OPENCODE_HOST ?? "http://localhost:4096",
    /** Directory for the opencode session */
    directory: process.env.OPENCODE_DIR ?? "/Users/leoliu/myroom/myskill-creator",
    /** Comma-separated list of skill names to generate topics for */
    skillNames: process.env.GUIDED_TOPIC_SKILLS
      ? process.env.GUIDED_TOPIC_SKILLS.split(",").map(s => s.trim()).filter(Boolean)
      : ["酷狗音乐会员分析", "skill-creator"],
    /** Cron expression for topic generation (default: every day at 3AM) */
    cronExpression: process.env.GUIDED_TOPIC_CRON ?? "0 3 * * *",
    /** Timezone for cron */
    timezone: process.env.GUIDED_TOPIC_TZ ?? "Asia/Shanghai",
  }
}

