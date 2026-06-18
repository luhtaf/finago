import { api } from '../lib/api.js';
import { toast, rp, fmt, stateLabel, stateCls } from '../lib/ui.js';

// Label state pengajuan buat chart doughnut.
const STATE_LABEL = {
  submitted: 'Menunggu',
  needs_justification: 'Perlu alasan',
  verified: 'Verified',
  approved: 'Disetujui',
  returned: 'Dikembalikan',
  rejected: 'Ditolak',
  paid: 'Cair',
  draft: 'Draft',
};

// Palet warna brand navy + teal + aksen.
const PALETTE = ['#1e2a8e', '#14b8a6', '#f59e0b', '#10b981', '#f43f5e', '#64748b', '#8e9ae8', '#0d9488'];

// ⚠️ Chart instance disimpan di module scope, BUKAN di state Alpine — kalau di state,
// Alpine bikin Proxy ke instance Chart-nya → canvas blank (Chart.js gak bisa render).
const charts = {};

// Dashboard ringkasan pengajuan — stats + 3 chart (tren bulanan, sebaran status, per proyek).
export const dashboardView = () => ({
  loading: false,
  filter: { from: '', to: '', kategori: '', state: '', kodeProyek: '' },
  stats: null,
  projects: [],
  rp, fmt, stateLabel, stateCls,
  async init() {
    try { this.projects = await api.get('/projects'); } catch {}
    await this.apply();
  },
  async apply() {
    this.loading = true;
    try {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(this.filter)) {
        if (v) params.set(k, v);
      }
      this.stats = await api.get('/dashboard/stats?' + params.toString());
      this.loading = false;
      this.$nextTick(() => this.renderCharts());
    } catch (e) {
      toast(e.message, false);
      this.loading = false;
    }
  },
  renderCharts() {
    if (!window.Chart || !this.stats) return;
    const make = (id, config) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (charts[id]) charts[id].destroy();
      charts[id] = new window.Chart(el, config);
    };

    make('ch-month', {
      type: 'line',
      data: {
        labels: this.stats.byMonth.map(m => m.month),
        datasets: [{
          label: 'Nominal',
          data: this.stats.byMonth.map(m => m.amount),
          borderColor: '#1e2a8e',
          backgroundColor: 'rgba(30,42,142,.12)',
          fill: true,
          tension: .3,
        }],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false, position: 'bottom' } } },
    });

    make('ch-state', {
      type: 'doughnut',
      data: {
        labels: this.stats.byState.map(s => STATE_LABEL[s.state] || s.state),
        datasets: [{
          data: this.stats.byState.map(s => s.count),
          backgroundColor: PALETTE,
        }],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, position: 'bottom' } } },
    });

    make('ch-proyek', {
      type: 'bar',
      data: {
        labels: this.stats.byProyek.map(p => p.kodeProyek),
        datasets: [{
          data: this.stats.byProyek.map(p => p.amount),
          backgroundColor: '#14b8a6',
        }],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false, position: 'bottom' } } },
    });
  },
});
