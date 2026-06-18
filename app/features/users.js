import { api } from '../lib/api.js';
import { toast } from '../lib/ui.js';

// Manajemen user — list + tambah/edit (nama, email, password, roles, department).
export const usersView = () => ({
  loading: true,
  rows: [],
  showForm: false,
  saving: false,
  editing: false,
  editId: null,
  f: { nama: '', email: '', password: '', roles: [], department: '' },

  ROLES: [
    { key: 'pengaju', label: 'Pengaju' },
    { key: 'verifikator', label: 'Verifikator' },
    { key: 'approver', label: 'Approver' },
    { key: 'admin', label: 'Admin' },
  ],

  init() {
    this.load();
  },

  async load() {
    this.loading = true;
    try {
      const r = await api.get('/users');
      this.rows = Array.isArray(r) ? r : [];
      this.loading = false;
      this.$nextTick(() => window.lucide?.createIcons());
    } catch (e) {
      this.loading = false;
      toast(e.message, false);
    }
  },

  openAdd() {
    this.editing = false;
    this.editId = null;
    this.f = { nama: '', email: '', password: '', roles: ['pengaju'], department: '' };
    this.showForm = true;
    this.$nextTick(() => window.lucide?.createIcons());
  },

  openEdit(u) {
    this.editing = true;
    this.editId = u.id;
    this.f = {
      nama: u.nama,
      email: u.email,
      password: '',
      roles: [...(u.roles || [])],
      department: u.department || '',
    };
    this.showForm = true;
    this.$nextTick(() => window.lucide?.createIcons());
  },

  toggleRole(key) {
    if (this.f.roles.includes(key)) {
      this.f.roles = this.f.roles.filter((r) => r !== key);
    } else {
      this.f.roles.push(key);
    }
  },

  async save() {
    if (!this.f.nama.trim() || !this.f.email.trim()) {
      toast('Lengkapi nama & email', false);
      return;
    }
    if (!this.editing && (!this.f.password || this.f.password.length < 4)) {
      toast('Password minimal 4 karakter', false);
      return;
    }
    if (this.f.roles.length < 1) {
      toast('Pilih minimal 1 role', false);
      return;
    }
    this.saving = true;
    try {
      if (this.editing) {
        await api.patch('/users/' + this.editId, {
          nama: this.f.nama,
          department: this.f.department || null,
          roles: this.f.roles,
          ...(this.f.password ? { password: this.f.password } : {}),
        });
      } else {
        await api.post('/users', {
          nama: this.f.nama,
          email: this.f.email.trim().toLowerCase(),
          password: this.f.password,
          roles: this.f.roles,
          department: this.f.department || null,
        });
      }
      toast('Tersimpan');
      this.showForm = false;
      await this.load();
    } catch (e) {
      toast(e.message, false);
    } finally {
      this.saving = false;
    }
  },
});
