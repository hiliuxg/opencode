import { getDb } from "../db/client"
import { users, cronJobs } from "../db/schema"
import { sql } from "drizzle-orm"

/**
 * Simple migration: create tables if they don't exist.
 * For a production system, use drizzle-kit migrate.
 */
export async function runMigrations() {
  const db = getDb()

  console.log("[migrate] dropping existing tables...")
  await db.execute(sql.raw(`DROP TABLE IF EXISTS cron_executions`))
  await db.execute(sql.raw(`DROP TABLE IF EXISTS cron_jobs`))
  await db.execute(sql.raw(`DROP TABLE IF EXISTS users`))
  await db.execute(sql.raw(`DROP TABLE IF EXISTS skill_versions`))
  await db.execute(sql.raw(`DROP TABLE IF EXISTS skills`))

  console.log("[migrate] creating tables...")
  await db.execute(sql.raw(`
    CREATE TABLE users (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      name            VARCHAR(255) NOT NULL,
      container_id    VARCHAR(255),
      container_host  VARCHAR(255) DEFAULT 'http://127.0.0.1:4096',
      auth_token      TEXT,
      status          VARCHAR(50) DEFAULT 'active',
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `))

  await db.execute(sql.raw(`
    CREATE TABLE cron_jobs (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      user_id         INT NOT NULL,
      name            VARCHAR(255) NOT NULL,
      cron_expression VARCHAR(255) NOT NULL,
      timezone        VARCHAR(50) DEFAULT 'UTC',
      prompt          TEXT,
      config          TEXT,
      workspace_dir   VARCHAR(1024),
      enabled         BOOLEAN DEFAULT TRUE,
      max_retries     INT DEFAULT 3,
      timeout_seconds INT DEFAULT 300,
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `))

  await db.execute(sql.raw(`
    CREATE TABLE cron_executions (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      job_id          INT NOT NULL,
      status          VARCHAR(50) NOT NULL,
      session_id      VARCHAR(255),
      error           TEXT,
      duration        BIGINT,
      started_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at    TIMESTAMP NULL
    )
  `))

  await db.execute(sql.raw(`
    CREATE TABLE skills (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      name            VARCHAR(255) NOT NULL,
      catalog         VARCHAR(50) NOT NULL,
      description     TEXT,
      user_id         INT NOT NULL,
      stars           INT DEFAULT 0,
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY name_catalog_idx (name, catalog)
    )
  `))

  await db.execute(sql.raw(`
    CREATE TABLE skill_versions (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      skill_id        INT NOT NULL,
      version         VARCHAR(50) NOT NULL,
      path            VARCHAR(1024) NOT NULL,
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `))

  try {
    await db.execute(sql.raw(`CREATE INDEX idx_exec_job ON cron_executions(job_id)`))
  } catch (e) { }

  try {
    await db.execute(sql.raw(`CREATE INDEX idx_exec_started ON cron_executions(started_at)`))
  } catch (e) { }

  // Ensure default user exists
  try {
    await db.execute(sql.raw(`
      INSERT INTO users (id, name, container_id, container_host, status)
      VALUES (1, 'leoliu', NULL, 'http://127.0.0.1:4096', 'active')
      ON DUPLICATE KEY UPDATE name = 'leoliu'
    `))
    console.log("[migrate] default user 'leoliu' (id: 1) ensured")
  } catch (err: any) {
    console.warn("[migrate] failed to seed default user:", err.message)
  }

  console.log("[migrate] tables ensured")
}

// Run if called directly
if (import.meta.path === Bun.main) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[migrate] failed:", err)
      process.exit(1)
    })
}
