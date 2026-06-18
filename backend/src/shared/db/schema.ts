import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ── master kode unik / proyek (REKAP COP) ─────────────────────────────
export const projects = sqliteTable('projects', {
  kode: text('kode').primaryKey(), // PRO001, BIM001, ADM, HR
  deskripsi: text('deskripsi').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
});

// ── users + role (1 user boleh multi-role) ────────────────────────────
export type Role = 'pengaju' | 'verifikator' | 'approver' | 'admin';
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  nama: text('nama').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),
  roles: text('roles', { mode: 'json' }).$type<Role[]>().notNull().default(['pengaju']),
  department: text('department'),
});

// ── rekening (hybrid input + finance verify) ──────────────────────────
export const bankAccounts = sqliteTable('bank_accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  bankName: text('bank_name').notNull(),
  number: text('number').notNull(),
  holderName: text('holder_name').notNull(),
  status: text('status', { enum: ['pending', 'verified', 'rejected'] }).notNull().default('pending'),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  attachmentUrl: text('attachment_url'),
  verifiedBy: text('verified_by'),
  verifiedAt: integer('verified_at', { mode: 'timestamp' }),
});

// ── pengajuan (header) ────────────────────────────────────────────────
export type PengajuanState =
  | 'draft' | 'submitted' | 'needs_justification'
  | 'verified' | 'approved' | 'returned' | 'rejected' | 'paid';
export const pengajuan = sqliteTable('pengajuan', {
  id: text('id').primaryKey(),
  nbr: text('nbr').notNull().unique(), // BR0xx
  tanggal: text('tanggal').notNull(),  // ISO date (YYYY-MM-DD)
  kodeProyek: text('kode_proyek').notNull().references(() => projects.kode),
  kategori: text('kategori', { enum: ['reimbursement', 'pengajuan_baru'] }).notNull(),
  prioritas: text('prioritas', { enum: ['urgent', 'not_urgent'] }).notNull().default('not_urgent'),
  nama: text('nama').notNull(),
  total: integer('total').notNull().default(0), // dihitung server = sum(item.subtotal)
  pengajuId: text('pengaju_id').notNull().references(() => users.id),
  bankAccountId: text('bank_account_id').references(() => bankAccounts.id),
  notaUrl: text('nota_url'),
  state: text('state', {
    enum: ['draft', 'submitted', 'needs_justification', 'verified', 'approved', 'returned', 'rejected', 'paid'],
  }).notNull().default('draft'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// ── pengajuan item (Detail Item) ──────────────────────────────────────
export const pengajuanItem = sqliteTable('pengajuan_item', {
  id: text('id').primaryKey(),
  pengajuanId: text('pengajuan_id').notNull().references(() => pengajuan.id, { onDelete: 'cascade' }),
  item: text('item').notNull(),
  qty: real('qty').notNull().default(0),
  satuan: text('satuan'),
  harga: integer('harga').notNull().default(0),
  subtotal: integer('subtotal').notNull().default(0),
  // flag "item ini dipantau" — di-toggle manual oleh verifikator. Simpel: on/off, no interval.
  monitored: integer('monitored', { mode: 'boolean' }).notNull().default(false),
});

// ── monitored items (anomaly detection) ───────────────────────────────
export const monitoredItems = sqliteTable('monitored_items', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  category: text('category', {
    enum: ['vehicle', 'equipment', 'software_license', 'consumable', 'other'],
  }).notNull().default('other'),
  lastEventAt: integer('last_event_at', { mode: 'timestamp' }),
  expectedIntervalDays: integer('expected_interval_days'),
  ownerDepartment: text('owner_department'),
  watchedBy: text('watched_by', { mode: 'json' }).$type<string[]>().notNull().default([]),
});

// ── outbox (DB → OneDrive async sync) ─────────────────────────────────
export const outboxEvents = sqliteTable('outbox_events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(), // 'sync_pengajuan' | 'upload_docx'
  payload: text('payload', { mode: 'json' }),
  status: text('status', { enum: ['pending', 'done', 'failed'] }).notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  processedAt: integer('processed_at', { mode: 'timestamp' }),
});

// ── docx files (R2 hot + OneDrive cold) ───────────────────────────────
export const docxFiles = sqliteTable('docx_files', {
  id: text('id').primaryKey(),
  pengajuanId: text('pengajuan_id').notNull().references(() => pengajuan.id),
  r2Key: text('r2_key'),
  onedriveUrl: text('onedrive_url'),
  status: text('status', { enum: ['generated', 'synced', 'failed'] }).notNull().default('generated'),
});

// ── audit trail ───────────────────────────────────────────────────────
export const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey(),
  entity: text('entity').notNull(),
  entityId: text('entity_id').notNull(),
  action: text('action').notNull(),
  actorId: text('actor_id'),
  meta: text('meta', { mode: 'json' }),
  at: integer('at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export type Pengajuan = typeof pengajuan.$inferSelect;
export type NewPengajuan = typeof pengajuan.$inferInsert;
export type PengajuanItem = typeof pengajuanItem.$inferSelect;
export type User = typeof users.$inferSelect;
export type BankAccount = typeof bankAccounts.$inferSelect;
export type MonitoredItem = typeof monitoredItems.$inferSelect;
