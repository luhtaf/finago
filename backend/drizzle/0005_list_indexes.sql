CREATE INDEX `pengajuan_tanggal_idx` ON `pengajuan` (`tanggal`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `pengajuan_state_tanggal_idx` ON `pengajuan` (`state`,`tanggal`);--> statement-breakpoint
CREATE INDEX `pengajuan_pengaju_tanggal_idx` ON `pengajuan` (`pengaju_id`,`tanggal`);--> statement-breakpoint
CREATE INDEX `pengajuan_proyek_tanggal_idx` ON `pengajuan` (`kode_proyek`,`tanggal`);--> statement-breakpoint
CREATE INDEX `pengajuan_item_pengajuan_idx` ON `pengajuan_item` (`pengajuan_id`);