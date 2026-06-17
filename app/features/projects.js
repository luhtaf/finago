import { api } from '../lib/api.js';
import { toast } from '../lib/ui.js';

// Master proyek (kode unik) — list + tambah (admin only).
export const projectsView = () => ({
  loading: true,
  rows: [],
  showAdd: false,
  saving: false,
  f: { kode: '', deskripsi: '' },
  get canManage() { return this.$store.session.has('admin'); },
  init() { this.load(); },
  async load() {
    this.loading = true;
    try {
      const r = await api.get('/projects');
      this.rows = Array.isArray(r) ? r : [];
      this.loading = false;
      this.$nextTick(() => window.lucide?.createIcons());
    } catch (e) {
      this.loading = false;
      toast(e.message, false);
    }
  },
  async add() {
    if (!this.f.kode || !this.f.deskripsi) {
      toast('Lengkapi kode & deskripsi', false);
      return;
    }
    this.saving = true;
    try {
      await api.post('/projects', { kode: this.f.kode.trim(), deskripsi: this.f.deskripsi.trim() });
      toast('Proyek ditambah');
      this.showAdd = false;
      this.f = { kode: '', deskripsi: '' };
      await this.load();
    } catch (e) {
      toast(e.message, false);
    } finally {
      this.saving = false;
    }
  },
});
