import { api } from '../lib/api.js';
import { rp, fmt, stateLabel, stateCls, toast } from '../lib/ui.js';

const today = () => new Date().toISOString().slice(0, 10);

// ── LIST ──────────────────────────────────────────────────────────────
export const pengajuanList = () => ({
  rows: [], loading: true, filter: { state: '', kategori: '', from: '', to: '' },
  confirmRow: null,
  rp, stateLabel, stateCls,
  async init() { await this.load(); },
  // filter tanggal (by pengajuan.tanggal, 'YYYY-MM-DD' → banding string aman) di sisi klien
  get shown() {
    return this.rows.filter((r) =>
      (!this.filter.from || (r.tanggal || '') >= this.filter.from) &&
      (!this.filter.to || (r.tanggal || '') <= this.filter.to));
  },
  // hapus: verif/approver/admin boleh semua; pengaju cuma miliknya
  canDelete(r) {
    const s = this.$store.session;
    return s.has('admin') || s.has('approver') || s.has('verifikator') || r.pengajuId === s.user?.id;
  },
  askDelete(r) { this.confirmRow = r; this.$nextTick(() => window.lucide?.createIcons()); },
  async doDelete() {
    const r = this.confirmRow;
    if (!r) return;
    try {
      await api.del('/pengajuan/' + r.id);
      toast('Pengajuan ' + r.nbr + ' dihapus');
      this.confirmRow = null;
      await this.load();
    } catch (e) { toast(e.message, false); }
  },
  async load() {
    this.loading = true;
    try {
      const q = new URLSearchParams();
      if (this.filter.state) q.set('state', this.filter.state);
      if (this.filter.kategori) q.set('kategori', this.filter.kategori);
      const r = await api.get('/pengajuan' + (q.toString() ? '?' + q : ''));
      this.rows = Array.isArray(r) ? r : (r.rows || r.items || []);
    } catch (e) { toast(e.message, false); }
    this.loading = false;
    this.$nextTick(() => window.lucide?.createIcons());
  },
  open(id) { location.hash = '#/pengajuan/' + id; },
});

// ── FORM (buat / edit draft) ──────────────────────────────────────────
export const pengajuanForm = () => ({
  editId: null, loading: false, saving: false, showPreview: false,
  kategori: 'reimbursement', prioritas: 'not_urgent', nama: '', kode: '', tanggal: today(),
  projects: [], rekenings: [],
  rekeningEntries: [{ sel: '', bankName: '', number: '', holderName: '' }],
  items: [{ item: '', qty: 1, satuan: '', harga: 0, remark: '' }],
  notaFiles: [], notaPreviews: [], existingNotaKeys: [],
  rp, fmt,
  onNotaChange(e) {
    const incoming = Array.from(e.target.files || []);
    const room = 10 - this.existingNotaKeys.length - this.notaFiles.length;
    if (room <= 0) { toast('Maksimal 10 lampiran', false); e.target.value = ''; return; }
    if (incoming.length > room) toast(`Cuma ${room} lampiran lagi yang muat (maks 10)`, false);
    this.notaFiles = [...this.notaFiles, ...incoming.slice(0, room)];
    this.notaPreviews = this.notaFiles.map((f) => ({ name: f.name, url: URL.createObjectURL(f) }));
    e.target.value = ''; // reset biar bisa pilih file yang sama / nambah lagi
  },
  removeNota(i) { this.notaFiles.splice(i, 1); this.notaPreviews.splice(i, 1); },
  get notaCount() { return this.notaFiles.length + this.existingNotaKeys.length; },
  async init() {
    const id = this.$store.router.id;
    try {
      const [proj, rek] = await Promise.all([api.get('/projects'), api.get('/me/bank-accounts').catch(() => [])]);
      this.projects = proj || [];
      this.rekenings = rek || [];
      if (this.projects[0]) this.kode = this.projects[0].kode;
      if (this.rekenings[0]) this.rekeningEntries[0].sel = (this.rekenings.find((r) => r.isDefault) || this.rekenings[0]).id;
    } catch (e) { toast(e.message, false); }
    if (id) { this.editId = id; await this.loadExisting(id); }
    this.$nextTick(() => window.lucide?.createIcons());
  },
  async loadExisting(id) {
    this.loading = true;
    try {
      const p = await api.get('/pengajuan/' + id);
      Object.assign(this, {
        kategori: p.kategori, prioritas: p.prioritas, nama: p.nama, kode: p.kodeProyek,
        tanggal: p.tanggal,
        items: (p.items || []).map((it) => ({ item: it.item, qty: it.qty, satuan: it.satuan || '', harga: it.harga, remark: it.remark || '' })),
      });
      // rekeningList snapshot → cocokin ke rekening tersimpan (by nomor), kalau gak ada → ad-hoc
      const rl = Array.isArray(p.rekeningList) ? p.rekeningList : [];
      if (rl.length) {
        this.rekeningEntries = rl.map((r) => {
          const match = this.rekenings.find((x) => x.number === r.number);
          return match
            ? { sel: match.id, bankName: '', number: '', holderName: '' }
            : { sel: '__other__', bankName: r.bankName, number: r.number, holderName: r.holderName };
        });
      } else if (p.bankAccountId) {
        this.rekeningEntries = [{ sel: p.bankAccountId, bankName: '', number: '', holderName: '' }];
      }
      try { const v = JSON.parse(p.notaUrl || '[]'); this.existingNotaKeys = Array.isArray(v) ? v : (p.notaUrl ? [p.notaUrl] : []); } catch { this.existingNotaKeys = p.notaUrl ? [p.notaUrl] : []; }
    } catch (e) { toast(e.message, false); }
    this.loading = false;
  },
  get total() { return this.items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.harga) || 0), 0); },
  get katLabel() { return this.kategori === 'reimbursement' ? 'Reimbursement' : 'Pengajuan Baru'; },
  // tujuan pencairan: bisa >1, tiap entry pilih rekening tersimpan ATAU "Rekening lainnya" (isi manual)
  addRekening() { this.rekeningEntries.push({ sel: '', bankName: '', number: '', holderName: '' }); this.$nextTick(() => window.lucide?.createIcons()); },
  removeRekening(i) { if (this.rekeningEntries.length > 1) this.rekeningEntries.splice(i, 1); },
  resolveRekening(e) {
    if (e.sel === '__other__') {
      if (!e.bankName.trim() || !e.number.trim() || !e.holderName.trim()) return null;
      return { bankName: e.bankName.trim(), number: e.number.trim(), holderName: e.holderName.trim() };
    }
    const r = this.rekenings.find((x) => x.id === e.sel);
    return r ? { bankName: r.bankName, number: r.number, holderName: r.holderName } : null;
  },
  get rekeningLines() { return this.rekeningEntries.map((e) => this.resolveRekening(e)).filter(Boolean).map((r) => `${r.number} ${r.bankName} a.n ${r.holderName}`); },
  addItem() { this.items.push({ item: '', qty: 1, satuan: '', harga: 0, remark: '' }); this.$nextTick(() => window.lucide?.createIcons()); },
  removeItem(i) { if (this.items.length > 1) this.items.splice(i, 1); },
  fmtNum(n) { return n ? new Intl.NumberFormat('id-ID').format(n) : ''; },
  parseNum(s) { return Number(String(s).replace(/[^\d]/g, '')) || 0; },
  payload() {
    const rekeningList = this.rekeningEntries.map((e) => this.resolveRekening(e)).filter(Boolean);
    const firstSaved = this.rekeningEntries.find((e) => e.sel && e.sel !== '__other__');
    return {
      nama: this.nama, kodeProyek: this.kode, kategori: this.kategori,
      prioritas: this.prioritas, tanggal: this.tanggal,
      bankAccountId: firstSaved ? firstSaved.sel : null,
      rekeningList: rekeningList.length ? rekeningList : null,
      items: this.items.map((it) => ({ item: it.item, qty: Number(it.qty) || 0, satuan: it.satuan || null, harga: Number(it.harga) || 0, remark: (it.remark || '').trim() || null })),
    };
  },
  valid() {
    if (!this.nama.trim()) { toast('Nama pengajuan masih kosong', false); return false; }
    if (this.items.some((it) => !it.item.trim() || !(it.qty > 0) || !(it.harga > 0))) { toast('Ada baris rincian yang belum lengkap', false); return false; }
    if (this.rekeningEntries.some((e) => e.sel === '__other__' && (!e.bankName.trim() || !e.number.trim() || !e.holderName.trim()))) { toast('Rekening lainnya belum lengkap (bank / no. rek / atas nama)', false); return false; }
    return true;
  },
  async save(submitAfter) {
    if (!this.valid()) return;
    this.saving = true;
    try {
      // upload nota/bukti dulu → kumpulin key (ikut di-embed ke docx)
      const notaKeys = [...this.existingNotaKeys];
      for (const f of this.notaFiles) { const r = await api.upload('/uploads', f); notaKeys.push(r.key); }
      const data = { ...this.payload(), notaUrl: notaKeys.length ? JSON.stringify(notaKeys) : null };
      let id = this.editId;
      if (id) await api.patch('/pengajuan/' + id, data);
      else { const r = await api.post('/pengajuan', data); id = r.id; }
      if (submitAfter) {
        const s = await api.post('/pengajuan/' + id + '/submit');
        toast(s.anomaly?.flagged ? 'Disubmit — kena flag anomali, perlu alasan' : 'Pengajuan disubmit ✓');
      } else toast('Draft tersimpan ✓');
      location.hash = '#/pengajuan/' + id;
    } catch (e) { toast(e.message, false); }
    this.saving = false;
  },
});

// ── DETAIL + aksi approval ────────────────────────────────────────────
export const pengajuanDetail = () => ({
  p: null, loading: true, busy: false, anomaly: null, justifyText: '', notaUrls: [],
  monitoredAll: [], monitoredListOpen: false,
  rp, fmt, stateLabel, stateCls,
  async init() { await this.load(); },
  get canTag() { return this.$store.session.has('verifikator') || this.$store.session.has('admin'); },
  // toggle flag "dipantau" di 1 item (verif). Simpel on/off.
  async toggleMonitor(it) {
    try { await api.post('/pengajuan-items/' + it.id + '/monitor', { on: !it.monitored }); await this.load(); }
    catch (e) { toast(e.message, false); }
  },
  async openMonitoredList() {
    try { this.monitoredAll = await api.get('/monitored-items'); this.monitoredListOpen = true; this.$nextTick(() => window.lucide?.createIcons()); }
    catch (e) { toast(e.message, false); }
  },
  goto(id) { this.monitoredListOpen = false; location.hash = '#/pengajuan/' + id; },
  async load() {
    this.loading = true; this.notaUrls = [];
    try {
      this.p = await api.get('/pengajuan/' + this.$store.router.id);
      // lampiran bukti → blob url biar bisa ditampilin
      let keys = [];
      try { const v = JSON.parse(this.p.notaUrl || '[]'); keys = Array.isArray(v) ? v : (this.p.notaUrl ? [this.p.notaUrl] : []); }
      catch { keys = this.p.notaUrl ? [this.p.notaUrl] : []; }
      // muat tiap bukti dgn 2x percobaan (kadang gambar "ga metu" — transient) → tandai failed biar bisa retry manual
      for (const k of keys) {
        let url = null;
        for (let att = 0; att < 2 && !url; att++) { try { url = await api.blobUrl('/uploads/file?key=' + encodeURIComponent(k)); } catch { url = null; } }
        this.notaUrls.push({ key: k, url, failed: !url });
      }
    } catch (e) { toast(e.message, false); }
    this.loading = false;
    this.$nextTick(() => window.lucide?.createIcons());
  },
  async retryNota(n) {
    try { n.url = await api.blobUrl('/uploads/file?key=' + encodeURIComponent(n.key)); n.failed = false; this.$nextTick(() => window.lucide?.createIcons()); }
    catch { toast('Masih gagal muat bukti, coba lagi', false); }
  },
  has(role) { return this.$store.session.has(role); },
  get isOwner() { return this.p && this.$store.session.user?.id === this.p.pengajuId; },
  get canJustify() { return this.p && this.p.state === 'needs_justification' && this.isOwner; },
  get canRevise() { return this.p && this.p.state === 'returned' && this.isOwner; },
  async justify() {
    if (!this.justifyText.trim()) { toast('Tulis alasan dulu', false); return; }
    this.busy = true;
    try { await api.post('/pengajuan/' + this.p.id + '/justify', { alasan: this.justifyText.trim() }); toast('Justifikasi terkirim ✓'); this.justifyText = ''; await this.load(); }
    catch (e) { toast(e.message, false); }
    this.busy = false;
  },
  get canVerify() { return this.p && ['submitted', 'needs_justification'].includes(this.p.state) && this.has('verifikator'); },
  get canApprove() { return this.p && this.p.state === 'verified' && this.has('approver'); },
  get canReject() { return this.p && !['rejected', 'paid', 'draft'].includes(this.p.state) && (this.has('verifikator') || this.has('approver')); },
  get canReturn() { return this.p && ['submitted', 'verified'].includes(this.p.state) && (this.has('verifikator') || this.has('approver')); },
  get canPay() { return this.p && this.p.state === 'approved' && this.has('admin'); },
  // revisi keputusan: rejected/returned bisa dibuka lagi oleh verif/approver/admin
  get canReopen() { return this.p && ['rejected', 'returned'].includes(this.p.state) && (this.has('verifikator') || this.has('approver') || this.has('admin')); },
  get canEdit() { return this.p && this.p.state === 'draft' && this.isOwner; },
  get hasDoc() { return this.p && this.p.state !== 'draft'; },
  async act(path, body) {
    this.busy = true;
    try { await api.post('/pengajuan/' + this.p.id + path, body); toast('Berhasil ✓'); await this.load(); }
    catch (e) { toast(e.message, false); }
    this.busy = false;
  },
  reason: { open: false, action: '', title: '', confirmLabel: '', danger: false, text: '' },
  askReason(action, title, confirmLabel, danger = false) {
    this.reason = { open: true, action, title, confirmLabel, danger, text: '' };
    this.$nextTick(() => window.lucide?.createIcons());
  },
  async submitReason() {
    if (!this.reason.text.trim()) { toast('Tulis alasan dulu', false); return; }
    const action = this.reason.action;
    const alasan = this.reason.text.trim();
    this.reason.open = false;
    await this.act(action, { alasan });
  },
  async download() {
    try { await api.download('/pengajuan/' + this.p.id + '/docx/download', this.p.nbr + '.docx'); }
    catch (e) { toast(e.message, false); }
  },
  edit() { location.hash = '#/pengajuan/' + this.p.id + '/edit'; },
});
