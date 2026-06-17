import { db } from '../src/shared/db/client';
import { pengajuan } from '../src/shared/db/schema';
import { generateDocx } from '../src/features/pengajuan/docx';
import { writeFileSync } from 'node:fs';

const row = await db.query.pengajuan.findFirst();
if (!row) { console.error('tidak ada pengajuan di db — jalanin smoke test dulu'); process.exit(1); }
const { r2Key, bytes } = await generateDocx(row.id);
writeFileSync('/tmp/formulir.docx', bytes);
console.log(`✓ generated ${r2Key} (${bytes.length} bytes) → /tmp/formulir.docx [nbr=${row.nbr}, total=${row.total}]`);
process.exit(0);
