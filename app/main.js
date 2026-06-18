import { auth } from './lib/auth.js';
import { pengajuanList, pengajuanForm, pengajuanDetail } from './features/pengajuan.js';
import { approvalsQueue } from './features/approval.js';
import { rekeningView } from './features/rekening.js';
import { monitoredView } from './features/monitored.js';
import { projectsView } from './features/projects.js';
import { usersView } from './features/users.js';
import { dashboardView } from './features/dashboard.js';

function parseRoute() {
  const h = (location.hash.slice(1) || '/');
  const parts = h.split('/').filter(Boolean);
  if (parts.length === 0) return { view: 'home', id: null };
  if (parts[0] === 'login') return { view: 'login', id: null };
  if (parts[0] === 'buat') return { view: 'form', id: null };
  if (parts[0] === 'approvals') return { view: 'approvals', id: null };
  if (parts[0] === 'rekening') return { view: 'rekening', id: null };
  if (parts[0] === 'monitored') return { view: 'monitored', id: null };
  if (parts[0] === 'projects') return { view: 'projects', id: null };
  if (parts[0] === 'users') return { view: 'users', id: null };
  if (parts[0] === 'dashboard') return { view: 'dashboard', id: null };
  if (parts[0] === 'pengajuan') {
    if (parts[1] && parts[2] === 'edit') return { view: 'form', id: parts[1] };
    if (parts[1]) return { view: 'detail', id: parts[1] };
    return { view: 'list', id: null };
  }
  return { view: 'list', id: null };
}

document.addEventListener('alpine:init', () => {
  const Alpine = window.Alpine;

  Alpine.store('session', {
    user: auth.current(),
    get authed() { return !!this.user; },
    has(role) { return !!this.user?.roles?.includes(role); },
    async login(email, password) { this.user = await auth.login(email, password); location.hash = '#/'; },
    logout() { auth.logout(); this.user = null; location.hash = '#/login'; },
  });

  Alpine.store('router', {
    view: 'login', id: null,
    sync() {
      const r = parseRoute();
      const authed = !!auth.current();
      if (!authed && r.view !== 'login') { this.view = 'login'; this.id = null; if (location.hash !== '#/login') location.hash = '#/login'; return; }
      if (authed && r.view === 'login') { this.view = 'home'; this.id = null; location.hash = '#/'; return; }
      this.view = r.view; this.id = r.id;
      this.$nextTick ? this.$nextTick(() => window.lucide?.createIcons()) : setTimeout(() => window.lucide?.createIcons(), 30);
    },
  });

  Alpine.data('loginView', () => ({
    email: '', password: '', busy: false, err: '',
    async submit() {
      this.busy = true; this.err = '';
      try { await this.$store.session.login(this.email.trim().toLowerCase(), this.password); }
      catch (e) { this.err = e.message; }
      this.busy = false;
    },
  }));
  Alpine.data('pengajuanList', pengajuanList);
  Alpine.data('pengajuanForm', pengajuanForm);
  Alpine.data('pengajuanDetail', pengajuanDetail);
  Alpine.data('approvalsQueue', approvalsQueue);
  Alpine.data('rekeningView', rekeningView);
  Alpine.data('monitoredView', monitoredView);
  Alpine.data('projectsView', projectsView);
  Alpine.data('usersView', usersView);
  Alpine.data('dashboardView', dashboardView);

  window.addEventListener('hashchange', () => { Alpine.store('router').sync(); });
});

window.toggleDark = function () {
  document.documentElement.classList.toggle('dark');
  try { localStorage.fg_dark = document.documentElement.classList.contains('dark') ? '1' : '0'; } catch {}
};
if ((() => { try { return localStorage.fg_dark === '1'; } catch { return false; } })()) document.documentElement.classList.add('dark');
