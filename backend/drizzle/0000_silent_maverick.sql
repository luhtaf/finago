CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`actor_id` text,
	`meta` text,
	`at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bank_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`bank_name` text NOT NULL,
	`number` text NOT NULL,
	`holder_name` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`attachment_url` text,
	`verified_by` text,
	`verified_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `docx_files` (
	`id` text PRIMARY KEY NOT NULL,
	`pengajuan_id` text NOT NULL,
	`r2_key` text,
	`onedrive_url` text,
	`status` text DEFAULT 'generated' NOT NULL,
	FOREIGN KEY (`pengajuan_id`) REFERENCES `pengajuan`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `monitored_items` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT 'other' NOT NULL,
	`last_event_at` integer,
	`expected_interval_days` integer,
	`owner_department` text,
	`watched_by` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `outbox_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`processed_at` integer
);
--> statement-breakpoint
CREATE TABLE `pengajuan` (
	`id` text PRIMARY KEY NOT NULL,
	`nbr` text NOT NULL,
	`tanggal` text NOT NULL,
	`kode_proyek` text NOT NULL,
	`kategori` text NOT NULL,
	`prioritas` text DEFAULT 'not_urgent' NOT NULL,
	`nama` text NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`pengaju_id` text NOT NULL,
	`bank_account_id` text,
	`nota_url` text,
	`state` text DEFAULT 'draft' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`kode_proyek`) REFERENCES `projects`(`kode`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pengaju_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bank_account_id`) REFERENCES `bank_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pengajuan_nbr_unique` ON `pengajuan` (`nbr`);--> statement-breakpoint
CREATE TABLE `pengajuan_item` (
	`id` text PRIMARY KEY NOT NULL,
	`pengajuan_id` text NOT NULL,
	`item` text NOT NULL,
	`qty` real DEFAULT 0 NOT NULL,
	`satuan` text,
	`harga` integer DEFAULT 0 NOT NULL,
	`subtotal` integer DEFAULT 0 NOT NULL,
	`monitored` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`pengajuan_id`) REFERENCES `pengajuan`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`kode` text PRIMARY KEY NOT NULL,
	`deskripsi` text NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`nama` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text,
	`roles` text DEFAULT '["pengaju"]' NOT NULL,
	`department` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);