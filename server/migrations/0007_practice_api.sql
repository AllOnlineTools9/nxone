CREATE TABLE `access_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`requester_id` text NOT NULL REFERENCES `users`(`id`),
	`email` text NOT NULL,
	`business_name` text,
	`note` text,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`accepted_org_id` text,
	`declined_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_requests_token_idx` ON `access_requests` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `access_requests_requester_idx` ON `access_requests` (`requester_id`);
--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL REFERENCES `organisations`(`id`),
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`created_by` text REFERENCES `users`(`id`),
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_hash_idx` ON `api_keys` (`key_hash`);
--> statement-breakpoint
CREATE INDEX `api_keys_org_idx` ON `api_keys` (`org_id`);
--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL REFERENCES `organisations`(`id`),
	`url` text NOT NULL,
	`secret` text NOT NULL,
	`events` text NOT NULL,
	`created_by` text REFERENCES `users`(`id`),
	`created_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE INDEX `webhooks_org_idx` ON `webhooks` (`org_id`);
--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`webhook_id` text NOT NULL REFERENCES `webhooks`(`id`),
	`event` text NOT NULL,
	`payload` text NOT NULL,
	`status` integer,
	`ok` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`delivered_at` integer
);
--> statement-breakpoint
CREATE INDEX `webhook_deliveries_hook_idx` ON `webhook_deliveries` (`webhook_id`, `created_at`);
