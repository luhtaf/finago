// Helper UI dipakai lintas view.
export const rp = (n) => 'Rp' + new Intl.NumberFormat('id-ID').format(Math.round(Number(n) || 0));
export const fmt = (n) => new Intl.NumberFormat('id-ID').format(Math.round(Number(n) || 0));

export const STATE_META = {
  draft:               { label: 'Draft',          cls: 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300' },
  submitted:           { label: 'Menunggu verif', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  needs_justification: { label: 'Perlu alasan',   cls: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300' },
  verified:            { label: 'Terverifikasi',  cls: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' },
  approved:            { label: 'Disetujui',      cls: 'bg-accent-500/15 text-accent-700 dark:text-accent-300' },
  returned:            { label: 'Dikembalikan',   cls: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300' },
  rejected:            { label: 'Ditolak',        cls: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300' },
  paid:                { label: 'Cair',           cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
};
export const stateLabel = (s) => STATE_META[s]?.label ?? s;
export const stateCls = (s) => STATE_META[s]?.cls ?? STATE_META.draft.cls;

export function toast(msg, ok = true) {
  const t = document.getElementById('toast');
  if (!t) return;
  document.getElementById('toast-msg').textContent = msg;
  document.getElementById('toast-box').className =
    'text-white text-[13px] font-semibold px-4 py-2.5 rounded-fld shadow-paper flex items-center gap-2 ' + (ok ? 'bg-ink' : 'bg-rose-500');
  document.getElementById('toast-icon').setAttribute('data-lucide', ok ? 'check-circle-2' : 'alert-triangle');
  t.classList.remove('hidden');
  window.lucide?.createIcons();
  clearTimeout(window._tt);
  window._tt = setTimeout(() => t.classList.add('hidden'), 2800);
}
