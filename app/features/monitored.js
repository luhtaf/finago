import { api } from '../lib/api.js';
import { toast } from '../lib/ui.js';

const CAT_LABELS = {
  vehicle: 'Kendaraan',
  equipment: 'Alat',
  software_license: 'Lisensi software',
  consumable: 'Consumable',
  other: 'Lainnya',
};

// Monitored items — master daftar item yang dipantau (anomaly check).
export const monitoredView = () => ({
  loading: true,
  rows: [],
  showAdd: false,
  saving: false,
  f: { name: '', category: 'other', expectedIntervalDays: null, ownerDepartment: '' },

  get canManage() {
    return this.$store.session.has('admin') || this.$store.session.has('verifikator');
  },

  init() {
    this.load();
  },

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

  async add() {
    if (!this.f.name.trim()) {
      toast('Nama item kosong', false);
      return;
    }
    this.saving = true;
    try {
      const body = {
        name: this.f.name,
        category: this.f.category,
        expectedIntervalDays: this.f.expectedIntervalDays || null,
        ownerDepartment: this.f.ownerDepartment || null,
      };
      await api.post('/monitored-items', body);
      toast('Item ditambah');
      this.showAdd = false;
      this.f = { name: '', category: 'other', expectedIntervalDays: null, ownerDepartment: '' };
      await this.load();
    } catch (e) {
      toast(e.message, false);
    } finally {
      this.saving = false;
    }
  },

  catLabel(c) {
    return CAT_LABELS[c] || c;
  },
});
