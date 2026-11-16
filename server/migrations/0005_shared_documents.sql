CREATE TABLE `shared_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`org_id` text NOT NULL,
	`document_id` text NOT NULL,
	`number` text NOT NULL,
	`snapshot` text NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	`view_count` integer DEFAULT 0 NOT NULL,
	`last_viewed_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shared_documents_token_idx` ON `shared_documents` (`token`);
--> statement-breakpoint
CREATE INDEX `shared_documents_org_idx` ON `shared_documents` (`org_id`);
--> statement-breakpoint
CREATE INDEX `shared_documents_document_idx` ON `shared_documents` (`document_id`);
