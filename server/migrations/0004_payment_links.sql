CREATE TABLE `payment_links` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`document_id` text NOT NULL,
	`number` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`reference` text NOT NULL,
	`url` text NOT NULL,
	`expires_at` integer,
	`paid_at` integer,
	`paid_on` text,
	`paid_amount_minor` integer,
	`method` text,
	`payment_reference` text,
	`delivered_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_links_reference_idx` ON `payment_links` (`reference`);
--> statement-breakpoint
CREATE INDEX `payment_links_org_idx` ON `payment_links` (`org_id`);
--> statement-breakpoint
CREATE INDEX `payment_links_document_idx` ON `payment_links` (`document_id`);
