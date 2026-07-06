import { eq } from 'drizzle-orm';
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, BorderStyle, VerticalAlign, ImageRun,
} from 'docx';
import { db } from '../../shared/db/client';
import { pengajuan, pengajuanItem, docxFiles, bankAccounts, users } from '../../shared/db/schema';
import { r2 } from '../../shared/r2/client';
import { newId } from '../../shared/util';

// TODO: derive dari record approval pas state 'approved'. Sementara konstanta direktur.

const NAVY = '15183A';
const TEAL_TINT = 'E7F7F4';
const HAIRLINE = 'D7DAE8';

const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(Math.round(n));
const rp = (n: number) => 'Rp' + fmt(n);

const kategoriLabel = (k: string) => (k === 'reimbursement' ? 'Reimbursement' : 'Pengajuan Baru');
const tglDDMMYYYY = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
};
const noDokumen = (h: { nbr: string; kodeProyek: string; kategori: string }) =>
  `${h.nbr}/${h.kodeProyek}/${kategoriLabel(h.kategori).replace(' ', '-')}`;

const NO_BORDER = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};
const GRID = { style: BorderStyle.SINGLE, size: 4, color: HAIRLINE };
const GRID_BORDERS = { top: GRID, bottom: GRID, left: GRID, right: GRID };

const FONT = 'Aptos Narrow';
const txt = (text: string, opts: { bold?: boolean; italics?: boolean; size?: number; color?: string } = {}) =>
  new TextRun({ text, bold: opts.bold, italics: opts.italics, size: opts.size ?? 20, color: opts.color, font: FONT });

const cell = (children: Paragraph[], opts: { width?: number; fill?: string; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; border?: boolean } = {}) =>
  new TableCell({
    children,
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.fill ? { fill: opts.fill } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    borders: opts.border === false ? NO_BORDER : GRID_BORDERS,
  });

const p = (runs: TextRun[], align?: (typeof AlignmentType)[keyof typeof AlignmentType]) =>
  new Paragraph({ children: runs, alignment: align });

// Baca dimensi + tipe gambar dari bytes (PNG / JPEG) tanpa dependency.
function imageMeta(b: Uint8Array): { w: number; h: number; type: 'png' | 'jpg' } | null {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) {
    const w = ((b[16]! << 24) | (b[17]! << 16) | (b[18]! << 8) | b[19]!) >>> 0;
    const h = ((b[20]! << 24) | (b[21]! << 16) | (b[22]! << 8) | b[23]!) >>> 0;
    return { w, h, type: 'png' };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1]!;
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        const h = (b[i + 5]! << 8) | b[i + 6]!;
        const w = (b[i + 7]! << 8) | b[i + 8]!;
        return { w, h, type: 'jpg' };
      }
      i += 2 + ((b[i + 2]! << 8) | b[i + 3]!);
    }
    return { w: 0, h: 0, type: 'jpg' };
  }
  return null;
}

// Ambil daftar key nota dari notaUrl (bisa JSON array, atau 1 string).
function parseNotaKeys(notaUrl: string | null): string[] {
  if (!notaUrl) return [];
  try { const v = JSON.parse(notaUrl); return Array.isArray(v) ? v : [notaUrl]; }
  catch { return [notaUrl]; }
}

/**
 * Generate dokumen FORMULIR pengajuan (.docx) nyata pakai library `docx`.
 * Layout ngikut FORMULIR asli: header + No. Dokumen, judul, tabel rincian
 * (No | Rincian Anggaran | Kuantitas | Sat. | Jumlah) + TOTAL, dikirim ke rekening,
 * blok tanda tangan Prepared/Approved. Simpan ke R2 + upsert `docx_files`.
 */
export async function generateDocx(pengajuanId: string): Promise<{ r2Key: string; bytes: Uint8Array }> {
  const header = await db.query.pengajuan.findFirst({ where: eq(pengajuan.id, pengajuanId) });
  if (!header) throw new Error(`pengajuan ${pengajuanId} tidak ditemukan`);

  const items = await db.select().from(pengajuanItem).where(eq(pengajuanItem.pengajuanId, pengajuanId));

  const pengajuUser = await db.query.users.findFirst({ where: eq(users.id, header.pengajuId) });
  const pengajuNama = pengajuUser?.nama ?? '-';

  let rekeningLines: string[] = [];
  const rekList = header.rekeningList as { bankName: string; number: string; holderName: string }[] | null;
  if (rekList && rekList.length) {
    rekeningLines = rekList.map((r) => `${r.number} ${r.bankName} a.n ${r.holderName}`);
  } else if (header.bankAccountId) {
    const bank = await db.query.bankAccounts.findFirst({ where: eq(bankAccounts.id, header.bankAccountId) });
    if (bank) rekeningLines = [`${bank.number} ${bank.bankName} a.n ${bank.holderName}`];
  }
  if (!rekeningLines.length) rekeningLines = ['-'];

  // ── header: brand kiri, No. Dokumen kanan (tabel borderless) ──
  const headerTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: NO_BORDER,
    rows: [
      new TableRow({
        children: [
          cell([
            p([txt('FINA go', { bold: true, size: 30, color: NAVY })]),
            p([txt('PT. KARTA BHUMI NUSANTARA', { size: 14, color: '8589A0' })]),
          ], { width: 60, border: false }),
          cell([
            p([txt('No. Dokumen', { size: 14, color: '8589A0' })], AlignmentType.RIGHT),
            p([txt(noDokumen(header), { bold: true, size: 16, color: NAVY })], AlignmentType.RIGHT),
          ], { width: 40, border: false }),
        ],
      }),
    ],
  });

  // ── tabel rincian ── (No | Rincian | Kuantitas | Sat. | Jumlah | Remark)
  const headRow = new TableRow({
    tableHeader: true,
    children: [
      cell([p([txt('No', { bold: true, color: 'FFFFFF' })], AlignmentType.CENTER)], { width: 6, fill: NAVY }),
      cell([p([txt('Rincian Anggaran', { bold: true, color: 'FFFFFF' })])], { width: 34, fill: NAVY }),
      cell([p([txt('Kuantitas', { bold: true, color: 'FFFFFF' })], AlignmentType.CENTER)], { width: 12, fill: NAVY }),
      cell([p([txt('Sat.', { bold: true, color: 'FFFFFF' })], AlignmentType.CENTER)], { width: 9, fill: NAVY }),
      cell([p([txt('Jumlah', { bold: true, color: 'FFFFFF' })], AlignmentType.RIGHT)], { width: 18, fill: NAVY }),
      cell([p([txt('Remark', { bold: true, color: 'FFFFFF' })])], { width: 21, fill: NAVY }),
    ],
  });

  const itemRows = items.map((it, i) =>
    new TableRow({
      children: [
        cell([p([txt(String(i + 1))], AlignmentType.CENTER)], { width: 6 }),
        cell([p([txt(it.item)])], { width: 34 }),
        cell([p([txt(String(it.qty))], AlignmentType.CENTER)], { width: 12 }),
        cell([p([txt(it.satuan ?? '-')], AlignmentType.CENTER)], { width: 9 }),
        cell([p([txt(fmt(it.subtotal))], AlignmentType.RIGHT)], { width: 18 }),
        cell([p([txt(it.remark ?? '')], )], { width: 21 }),
      ],
    }),
  );

  // baris TOTAL: gabung 4 kolom pertama lewat columnSpan; Remark dibiarkan kosong
  const totalRowSpan = new TableRow({
    children: [
      new TableCell({
        children: [p([txt('TOTAL', { bold: true })], AlignmentType.RIGHT)],
        columnSpan: 4, shading: { fill: TEAL_TINT }, borders: GRID_BORDERS, verticalAlign: VerticalAlign.CENTER,
      }),
      cell([p([txt(rp(header.total), { bold: true })], AlignmentType.RIGHT)], { width: 18, fill: TEAL_TINT }),
      cell([p([txt('')])], { width: 21, fill: TEAL_TINT }),
    ],
  });

  const itemsTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headRow, ...itemRows, totalRowSpan],
  });

  // ── blok tanda tangan (borderless) — 3 kolom + "Signed via System" otomatis per state ──
  const st = header.state;
  const preparedSigned = st !== 'draft';
  const reviewedSigned = st === 'verified' || st === 'approved' || st === 'paid';
  const approvedSigned = st === 'approved' || st === 'paid';

  const signCell = (label: string, name: string, signed: boolean) =>
    cell([
      p([txt(label, { size: 18, color: '64748B' })], AlignmentType.CENTER),
      signed
        ? new Paragraph({
            children: [txt('Signed via System', { italics: true, size: 16, color: '0D9488' })],
            alignment: AlignmentType.CENTER, spacing: { before: 220, after: 100 },
          })
        : new Paragraph({ children: [txt(' ')], spacing: { before: 320 } }),
      p([txt(name, { bold: true })], AlignmentType.CENTER),
    ], { width: 33, border: false });

  const signTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: NO_BORDER,
    rows: [
      new TableRow({
        children: [
          signCell('Prepared & Requested by', pengajuNama, preparedSigned),
          signCell('Reviewed by', header.reviewedBy ?? '', reviewedSigned),
          signCell('Approved by', header.approvedBy ?? '', approvedSigned),
        ],
      }),
    ],
  });

  // ── lampiran / bukti (gambar nota yang di-upload pengaju) ──
  const notaParas: Paragraph[] = [];
  for (const key of parseNotaKeys(header.notaUrl)) {
    const b = await r2.get(key);
    if (!b) continue;
    const meta = imageMeta(b);
    if (!meta) continue;
    const maxW = 340;
    const w0 = meta.w || maxW;
    const h0 = meta.h || Math.round(maxW * 0.75);
    const scale = Math.min(1, maxW / w0);
    const width = Math.round(w0 * scale);
    const height = Math.min(460, Math.round(h0 * scale));
    notaParas.push(new Paragraph({
      children: [new ImageRun({ type: meta.type, data: b, transformation: { width, height } })],
      spacing: { after: 120 },
    }));
  }
  const notaBlock = notaParas.length
    ? [
        new Paragraph({ text: '', spacing: { before: 220 } }),
        p([txt('LAMPIRAN / BUKTI', { bold: true, size: 16, color: NAVY })]),
        ...notaParas,
      ]
    : [];

  const doc = new Document({
    sections: [{
      children: [
        headerTable,
        new Paragraph({ text: '', border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: NAVY } }, spacing: { after: 200 } }),
        p([txt(`FORMULIR ${kategoriLabel(header.kategori).toUpperCase()}`, { bold: true, size: 24, color: NAVY })], AlignmentType.CENTER),
        p([txt(header.nama, { size: 20, color: '64748B' })], AlignmentType.CENTER),
        new Paragraph({ text: '', spacing: { after: 160 } }),
        itemsTable,
        new Paragraph({ text: '', spacing: { after: 120 } }),
        ...(rekeningLines.length === 1
          ? [p([txt('*Dikirim ke Rekening: ', { color: '64748B' }), txt(rekeningLines[0]!, { bold: true })])]
          : [
              p([txt('*Dikirim ke Rekening:', { color: '64748B' })]),
              ...rekeningLines.map((r, i) => p([txt(`${i + 1}. `, { color: '64748B' }), txt(r, { bold: true })])),
            ]),
        new Paragraph({ text: '', spacing: { after: 320 } }),
        signTable,
        ...notaBlock,
        new Paragraph({
          children: [txt(`${tglDDMMYYYY(header.tanggal)}  ·  FINA go`, { size: 14, color: '8589A0' })],
          alignment: AlignmentType.RIGHT, spacing: { before: 240 },
        }),
      ],
    }],
  });

  const bytes = new Uint8Array(await Packer.toBuffer(doc));

  const r2Key = `pengajuan/${header.nbr}.docx`;
  await r2.put(r2Key, bytes);

  const existing = await db.query.docxFiles.findFirst({ where: eq(docxFiles.pengajuanId, pengajuanId) });
  if (existing) {
    await db.update(docxFiles).set({ r2Key, status: 'generated' }).where(eq(docxFiles.id, existing.id));
  } else {
    await db.insert(docxFiles).values({ id: newId('docx'), pengajuanId, r2Key, status: 'generated' });
  }

  return { r2Key, bytes };
}
