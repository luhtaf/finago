import { api } from '../lib/api.js';
import { toast } from '../lib/ui.js';

// Daftar item yang dipantau (read-only) — ditandai verifikator dari detail pengajuan.
export const monitoredView = () => ({
  loading: true,
  rows: [],
  async init() { await this.load(); },
  async load() {
    this.loading = true;
    try {
      const r = await api.get('/monitored-items');
      this.rows = Array.isArray(r) ? r : [];
    } catch (e) {
      toast(e.message, false);
    }
    this.loading = false;
    this.$nextTick(() => window.lucide?.createIcons());
  },
  open(id) { location.hash = '#/pengajuan/' + id; },
});
