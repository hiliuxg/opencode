import { mysqlTable, varchar, text, timestamp, boolean, int, bigint, serial } from "drizzle-orm/mysql-core"

export const users = mysqlTable("users", {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    containerId: varchar("container_id", { length: 255 }),
    containerHost: varchar("container_host", { length: 255 }).default("http://127.0.0.1:4096"),
    authToken: text("auth_token"),
    status: varchar("status", { length: 50 }).default("active"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
})

export const cronJobs = mysqlTable("cron_jobs", {
    id: serial("id").primaryKey(),
    userId: int("user_id").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    cronExpression: varchar("cron_expression", { length: 255 }).notNull(),
    timezone: varchar("timezone", { length: 50 }).default("UTC"),
    prompt: text("prompt"),
    config: text("config"), // JSON string
    workspaceDir: varchar("workspace_dir", { length: 1024 }),
    enabled: boolean("enabled").default(true),
    maxRetries: int("max_retries").default(3),
    timeout_seconds: int("timeout_seconds").default(300),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
})

export const cronExecutions = mysqlTable("cron_executions", {
    id: serial("id").primaryKey(),
    jobId: int("job_id").notNull(),
    status: varchar("status", { length: 50 }).notNull(), // running, completed, error
    sessionId: varchar("session_id", { length: 255 }),
    error: text("error"),
    duration: bigint("duration", { mode: "number" }), // ms
    startedAt: timestamp("started_at").defaultNow(),
    completedAt: timestamp("completed_at"),
})
