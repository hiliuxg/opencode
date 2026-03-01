import { mysqlTable, varchar, text, timestamp, boolean, int, bigint, serial, uniqueIndex } from "drizzle-orm/mysql-core"

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

export const skills = mysqlTable("skills", {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    catalog: varchar("catalog", { length: 50 }).notNull(),
    description: text("description"),
    userId: int("user_id").notNull(),
    stars: int("stars").default(0),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
}, (t) => ({
    unq: uniqueIndex("name_catalog_idx").on(t.name, t.catalog),
}))

export const skillVersions = mysqlTable("skill_versions", {
    id: serial("id").primaryKey(),
    skillId: int("skill_id").notNull(),
    version: varchar("version", { length: 50 }).notNull(),
    path: varchar("path", { length: 1024 }).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
})

export const configs = mysqlTable("configs", {
    id: serial("id").primaryKey(),
    key: varchar("key", { length: 255 }).notNull().unique(),
    value: text("value").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
})

export const dockerContainers = mysqlTable("docker_containers", {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    image: varchar("image", { length: 255 }).notNull(),
    status: varchar("status", { length: 50 }).default("running"),
    ports: varchar("ports", { length: 255 }),
    userId: int("user_id"),
    containerId: varchar("container_id", { length: 255 }),
    host: varchar("host", { length: 255 }),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
})

export const dataReports = mysqlTable("data_reports", {
    id: serial("id").primaryKey(),
    title: varchar("title", { length: 255 }).notNull(),
    type: varchar("type", { length: 50 }).notNull(),
    status: varchar("status", { length: 50 }).default("pending"),
    content: text("content"),
    result: text("result"),
    userId: int("user_id"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
})

export const guidedTopics = mysqlTable("guided_topics", {
    id: serial("id").primaryKey(),
    skillname: varchar("skillname", { length: 255 }).notNull(),
    question: text("question").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
})
