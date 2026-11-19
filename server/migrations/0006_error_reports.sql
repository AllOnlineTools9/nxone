CREATE TABLE `error_reports` (
	`fingerprint` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`message` text NOT NULL,
	`stack` text,
	`path` text,
	`user_agent` text,
	`count` integer DEFAULT 1 NOT NULL,
	`first_seen` integer NOT NULL,
	`last_seen` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `error_reports_last_seen_idx` ON `error_reports` (`last_seen`);
