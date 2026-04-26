CREATE TABLE `session_catalog` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`directory` text NOT NULL,
	`key` text,
	`name` text NOT NULL,
	`icon` text NOT NULL,
	`sort` integer NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_session_catalog_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `session` ADD `catalog_id` text REFERENCES session_catalog(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `session` ADD `time_pinned` integer;--> statement-breakpoint
CREATE INDEX `session_catalog_project_directory_idx` ON `session_catalog` (`project_id`,`directory`);--> statement-breakpoint
CREATE INDEX `session_catalog_project_directory_sort_idx` ON `session_catalog` (`project_id`,`directory`,`sort`);--> statement-breakpoint
CREATE INDEX `session_catalog_idx` ON `session` (`catalog_id`);--> statement-breakpoint
CREATE INDEX `session_pinned_idx` ON `session` (`time_pinned`);
