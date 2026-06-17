import { api } from '../lib/api.js';
import { toast } from '../lib/ui.js';

// Rekening bank milik user — list + tambah (nunggu verifikasi).
export const rekeningView = () => ({
  loading: true,
  mine: [],
  pending: [],
  showAdd: false,
  saving: false,
  f: { bankName: '', number: '', holderName: '', isDefault: false },

  get canManage() { return this.$store.session.has('verifikator') || this.$store.session.has('admin'); },

  init() {
    this.load();
    if (this.canManage) this.loadPending();
  },

  async loadPending() {
    try { const r = await api.get('/bank-accounts/pending'); this.pending = Array.isArray(r) ? r : []; }
    catch (e) { toast(e.message, false); }
    this.$nextTick(() => window.lucide?.createIcons());
  },

  async verify(id, decision) {
    try {
      await api.post('/bank-accounts/' + id + '/verify', { decision });
      toast(decision === 'verified' ? 'Rekening diverifikasi ✓' : 'Rekening ditolak');
      await this.loadPending();
      await this.load();
    } catch (e) { toast(e.message, false); }
  },

  async load() {
    this.loading = true;
    try {
      const r = await api.get('/me/bank-accounts');
      this.mine = Array.isArray(r) ? r : [];
      this.loading = false;
      this.$nextTick(() => window.lucide?.createIcons());
    } catch (e) {
      this.loading = false;
      toast(e.message, false);
    }
  },

  async add() {
    if (!this.f.bankName || !this.f.number || !this.f.holderName) {
      toast('Lengkapi data rekening', false);
      return;
    }
    this.saving = true;
    try {
      await api.post('/me/bank-accounts', {
        bankName: this.f.bankName,
        number: this.f.number,
        holderName: this.f.holderName,
        isDefault: this.f.isDefault,
      });
      toast('Rekening ditambah — nunggu verifikasi');
      this.showAdd = false;
      this.f = { bankName: '', number: '', holderName: '', isDefault: false };
      await this.load();
    } catch (e) {
      toast(e.message, false);
    } finally {
      this.saving = false;
    }
  },

  statusLabel(s) {
    if (s === 'pending') return 'Menunggu';
    if (s === 'verified') return 'Terverifikasi';
    if (s === 'rejected') return 'Ditolak';
    return s;
  },

  statusCls(s) {
    if (s === 'verified') return 'bg-accent-500/15 text-accent-700 dark:text-accent-300';
    if (s === 'rejected') return 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300';
    return 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300';
  },
});
