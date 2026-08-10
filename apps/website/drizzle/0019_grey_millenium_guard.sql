CREATE TABLE `project` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_user_normalized_name_unique` ON `project` (`user_id`,`normalized_name`);--> statement-breakpoint
CREATE INDEX `project_user_created_at_idx` ON `project` (`user_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `agent_notification` ADD `project_id` text REFERENCES project(id) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `agent_notification` ADD `read_at` integer;--> statement-breakpoint
ALTER TABLE `agent_notification` ADD `body_format` text;--> statement-breakpoint
ALTER TABLE `agent_notification` ADD `summary` text;--> statement-breakpoint
ALTER TABLE `event` ADD `project_id` text REFERENCES project(id) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `event` ADD `read_at` integer;--> statement-breakpoint
ALTER TABLE `event` ADD `body_format` text;--> statement-breakpoint
ALTER TABLE `event` ADD `summary` text;--> statement-breakpoint
UPDATE `event` SET `read_at` = `created_at` WHERE `read_at` IS NULL;--> statement-breakpoint
UPDATE `agent_notification` SET `read_at` = `created_at` WHERE `read_at` IS NULL;--> statement-breakpoint
CREATE INDEX `agent_notification_project_created_at_idx` ON `agent_notification` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_notification_unread_idx` ON `agent_notification` (`user_id`,`created_at`) WHERE "read_at" is null;--> statement-breakpoint
CREATE INDEX `event_project_created_at_idx` ON `event` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `event_unread_idx` ON `event` (`service_id`,`created_at`) WHERE "read_at" is null;
