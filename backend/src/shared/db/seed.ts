import { db } from './client';
import { projects, users, bankAccounts } from './schema';
import { hashPassword } from '../../features/auth/password';

// Seed master data dari REKAP COP + 1 demo user + rekening verified.
// Jalanin: npm run seed
async function main() {
  // password semua user demo: "fina123"
  const PW = await hashPassword('fina123');

  await db.insert(projects).values([
    { kode: 'PRO001', deskripsi: 'APP Group — QC Canal Limbah OKI' },
    { kode: 'PRO002', deskripsi: 'Pemda Raja Ampat — PPBW' },
    { kode: 'PRO003', deskripsi: 'Waskita — UAV LiDAR Takengon' },
    { kode: 'BIM001', deskripsi: 'BWI — Modeling Grand Makarti Jaksel' },
    { kode: 'ADM', deskripsi: 'Administrasi / Head Office' },
    { kode: 'HR', deskripsi: 'Human Resources' },
  ]).onConflictDoNothing();

  await db.insert(users).values([
    { id: 'u_demo', nama: 'Adinda RN', email: 'adinda@kartabhumi.id', passwordHash: PW, roles: ['pengaju', 'verifikator', 'approver', 'admin'], department: 'ADM' },
    { id: 'u_bagus', nama: 'Bagus DJ', email: 'bagus@kartabhumi.id', passwordHash: PW, roles: ['pengaju'], department: 'PRO' },
    { id: 'u_wahyu', nama: 'Wahyu Banitara', email: 'wahyu@kartabhumi.id', passwordHash: PW, roles: ['approver', 'verifikator'], department: 'BOD' },
  ]).onConflictDoUpdate({ target: users.id, set: { passwordHash: PW } });

  await db.insert(bankAccounts).values([
    { id: 'bank_demo', userId: 'u_demo', bankName: 'Bank Mandiri', number: '1370020855504', holderName: 'Adinda Rizqi Novia', status: 'verified', isDefault: true },
    { id: 'bank_bagus', userId: 'u_bagus', bankName: 'Bank Mandiri', number: '1370023979061', holderName: 'Bagus Dananjaya', status: 'verified', isDefault: true },
  ]).onConflictDoNothing();

  console.log('✓ seed selesai');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
