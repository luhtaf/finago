import JSZip from 'jszip';

// Writer .xlsx minimal (SpreadsheetML) di atas jszip — jalan di Node DAN Workers, tanpa
// dependency berat. Cukup buat export tabel: banyak sheet, header bold + freeze, angka
// beneran (bisa di-SUM di Excel), lebar kolom. Bukan library spreadsheet umum.
export type Cell = string | number | null | undefined;
export interface Sheet {
  name: string;          // maks 31 char, tanpa : \ / ? * [ ]
  columns: { header: string; width?: number; money?: boolean }[];
  rows: Cell[][];
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    // buang control char yang bikin XML invalid (selain tab/newline)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

const colName = (i: number) => {
  let s = ''; i += 1;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
};

const safeSheetName = (n: string) => n.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31) || 'Sheet';

// style index: 0 = default, 1 = header bold+fill, 2 = angka ribuan (#,##0)
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1E2A8E"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function sheetXml(sh: Sheet): string {
  const cols = sh.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 16}" customWidth="1"/>`).join('');
  const cellXml = (v: Cell, ref: string, style: number) => {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
  };
  const head = `<row r="1">${sh.columns.map((c, i) => cellXml(c.header, `${colName(i)}1`, 1)).join('')}</row>`;
  const body = sh.rows.map((r, ri) => {
    const n = ri + 2;
    return `<row r="${n}">${r.map((v, ci) => cellXml(v, `${colName(ci)}${n}`, sh.columns[ci]?.money && typeof v === 'number' ? 2 : 0)).join('')}</row>`;
  }).join('');
  const last = `${colName(Math.max(sh.columns.length - 1, 0))}${sh.rows.length + 1}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${cols}</cols><sheetData>${head}${body}</sheetData><autoFilter ref="A1:${last}"/></worksheet>`;
}

export async function buildXlsx(sheets: Sheet[]): Promise<Uint8Array> {
  const zip = new JSZip();
  const names = sheets.map((s) => safeSheetName(s.name));
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${
  // autoFilter butuh defined name tersembunyi biar Excel gak "repair"
  `<definedNames>${sheets.map((s, i) => `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(names[i]!.replace(/'/g, "''"))}'!$A$1:$${colName(Math.max(s.columns.length - 1, 0))}$${s.rows.length + 1}</definedName>`).join('')}</definedNames>`
}</workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file('xl/styles.xml', STYLES);
  sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
