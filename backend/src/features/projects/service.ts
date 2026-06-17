import { eq } from 'drizzle-orm';
import { db } from '../../shared/db/client';
import { projects } from '../../shared/db/schema';
import { writeAudit } from '../../shared/audit';

/** Row proyek (master kode unik / REKAP COP). Diturunkan lokal — schema belum export tipe ini. */
export type Project = typeof projects.$inferSelect;

/** Input bikin proyek baru. `kode` jadi PK (REKAP COP), `active` default true. */
export interface ProjectInput {
  kode: string;
  deskripsi: string;
}

/**
 * Daftar proyek. Default hanya yang `active=true`.
 * `includeInactive` → ikut yang non-aktif juga (buat admin / arsip).
 */
export async function listProjects(opts?: { includeInactive?: boolean }): Promise<Project[]> {
  if (opts?.includeInactive) {
    return db.select().from(projects);
  }
  return db.select().from(projects).where(eq(projects.active, true));
}

/**
 * Bikin master proyek baru. `kode` adalah PK (mis. 'PRO001') → kalau bentrok,
 * insert akan gagal di level DB. Selalu mulai `active=true`.
 */
export async function createProject(input: ProjectInput): Promise<Project> {
  await db.insert(projects).values({
    kode: input.kode,
    deskripsi: input.deskripsi,
    active: true,
  });

  await writeAudit({
    entity: 'project',
    entityId: input.kode,
    action: 'create',
    meta: { deskripsi: input.deskripsi },
  });

  const created = await db.query.projects.findFirst({ where: eq(projects.kode, input.kode) });
  return created!;
}

/**
 * Aktif / non-aktifkan proyek. Soft toggle — proyek lama tetap jadi FK valid
 * buat pengajuan yang sudah ada, cuma ga muncul di daftar default lagi.
 */
export async function setActive(kode: string, active: boolean): Promise<Project> {
  const existing = await db.query.projects.findFirst({ where: eq(projects.kode, kode) });
  if (!existing) throw new Error('proyek tidak ditemukan');

  await db.update(projects).set({ active }).where(eq(projects.kode, kode));

  await writeAudit({
    entity: 'project',
    entityId: kode,
    action: active ? 'activate' : 'deactivate',
    meta: { active },
  });

  const updated = await db.query.projects.findFirst({ where: eq(projects.kode, kode) });
  return updated!;
}
