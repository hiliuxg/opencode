-- OpenCode Schema Initialization SQL
-- This file is generated based on packages/admin/src/db/migrate.ts and schema.ts

SET FOREIGN_KEY_CHECKS = 0;

-- Drop existing tables if they exist
DROP TABLE IF EXISTS `data_reports`;
DROP TABLE IF EXISTS `guided_topics`;
DROP TABLE IF EXISTS `docker_containers`;
DROP TABLE IF EXISTS `configs`;
DROP TABLE IF EXISTS `cron_executions`;
DROP TABLE IF EXISTS `cron_jobs`;
DROP TABLE IF EXISTS `users`;
DROP TABLE IF EXISTS `skill_versions`;
DROP TABLE IF EXISTS `skills`;

-- Create tables
CREATE TABLE `users` (
  `id`              INT AUTO_INCREMENT PRIMARY KEY,
  `name`            VARCHAR(255) NOT NULL,
  `container_id`    VARCHAR(255),
  `container_host`  VARCHAR(255) DEFAULT 'http://127.0.0.1:4096',
  `auth_token`      TEXT,
  `status`          VARCHAR(50) DEFAULT 'active',
  `created_at`      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE `cron_jobs` (
  `id`              INT AUTO_INCREMENT PRIMARY KEY,
  `user_id`         INT NOT NULL,
  `name`            VARCHAR(255) NOT NULL,
  `cron_expression` VARCHAR(255) NOT NULL,
  `timezone`        VARCHAR(50) DEFAULT 'UTC',
  `prompt`          TEXT,
  `config`          TEXT,
  `workspace_dir`   VARCHAR(1024),
  `enabled`         BOOLEAN DEFAULT TRUE,
  `max_retries`     INT DEFAULT 3,
  `timeout_seconds` INT DEFAULT 300,
  `created_at`      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE `cron_executions` (
  `id`              INT AUTO_INCREMENT PRIMARY KEY,
  `job_id`          INT NOT NULL,
  `status`          VARCHAR(50) NOT NULL,
  `session_id`      VARCHAR(255),
  `error`           TEXT,
  `duration`        BIGINT,
  `started_at`      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `completed_at`    TIMESTAMP NULL
);

CREATE TABLE `skills` (
  `id`              INT AUTO_INCREMENT PRIMARY KEY,
  `name`            VARCHAR(255) NOT NULL,
  `catalog`         VARCHAR(50) NOT NULL,
  `description`     TEXT,
  `user_id`         INT NOT NULL,
  `stars`           INT DEFAULT 0,
  `created_at`      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE `skill_versions` (
  `id`              INT AUTO_INCREMENT PRIMARY KEY,
  `skill_id`        INT NOT NULL,
  `version`         VARCHAR(50) NOT NULL,
  `path`            VARCHAR(1024) NOT NULL,
  `created_at`      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE `configs` (
  `id`              INT AUTO_INCREMENT PRIMARY KEY,
  `key`             VARCHAR(255) NOT NULL UNIQUE,
  `value`           TEXT NOT NULL,
  `created_at`      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE `docker_containers` (
  `id`              INT AUTO_INCREMENT PRIMARY KEY,
  `name`            VARCHAR(255) NOT NULL,
  `image`           VARCHAR(255) NOT NULL,
  `status`          VARCHAR(50) DEFAULT 'running',
  `ports`           VARCHAR(255),
  `user_id`         INT,
  `container_id`    VARCHAR(255),
  `host`            VARCHAR(255),
  `created_at`      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE `data_reports` (
  `id`              INT AUTO_INCREMENT PRIMARY KEY,
  `title`           VARCHAR(255) NOT NULL,
  `type`            VARCHAR(50) NOT NULL,
  `status`          VARCHAR(50) DEFAULT 'pending',
  `content`         TEXT,
  `result`          TEXT,
  `user_id`         INT,
  `created_at`      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE `guided_topics` (
  `id`              INT AUTO_INCREMENT PRIMARY KEY,
  `skillname`       VARCHAR(255) NOT NULL,
  `question`        TEXT NOT NULL,
  `created_at`      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Seed default user
INSERT INTO `users` (`id`, `name`, `container_id`, `container_host`, `status`)
VALUES (1, 'leoliu', NULL, 'http://127.0.0.1:4096', 'active')
ON DUPLICATE KEY UPDATE `name` = 'leoliu';

SET FOREIGN_KEY_CHECKS = 1;
