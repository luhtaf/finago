import { api } from '../lib/api.js';
import { rp, stateLabel, stateCls, toast } from '../lib/ui.js';

// Antrian approval — pengajuan yang nunggu verifikasi/approve.
export const approvalsQueue = () => ({
  rows: [], loading: true,
  rp, stateLabel, stateCls,
  async init() {
    this.loading = true;
    try {
      const r = await api.get('/approvals/pending');
      this.rows = Array.isArray(r) ? r : (r.items || r.rows || []);
    } catch (e) { toast(e.message, false); }
    this.loading = false;
    this.$nextTick(() => window.lucide?.createIcons());
  },
  open(id) { location.hash = '#/pengajuan/' + id; },
});
