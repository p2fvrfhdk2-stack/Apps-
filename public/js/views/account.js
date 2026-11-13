import { h, mount, api, state, buildForm, toast, section } from '../lib.js';

export async function accountView(el) {
  const form = buildForm([
    { key: 'current', label: 'Current password', type: 'password', required: true, span: 'third' },
    { key: 'password', label: 'New password', type: 'password', required: true, span: 'third', help: 'At least 8 characters with letters and numbers.' },
    { key: 'confirm', label: 'Repeat new password', type: 'password', required: true, span: 'third' },
  ]);
  mount(el, 
    h('div', { class: 'page-head' }, h('h1', null, 'My account')),
    section('Profile', h('p', null, `${[state.me.title, state.me.full_name].filter(Boolean).join(' ')} · ${state.me.username} · role: ${state.me.role}`)),
    h('form', { onsubmit: async (e) => {
      e.preventDefault();
      if (!form.validate()) return;
      const v = form.values();
      if (v.password !== v.confirm) return toast('New passwords do not match', 'error');
      try { await api('/api/me/password', { method: 'POST', body: v }); toast('Password changed'); e.target.reset(); } catch (err) { toast(err.message, 'error'); }
    } }, section('Change password', h('div', null, form.el, h('button', { class: 'btn primary', type: 'submit' }, 'Change password')))));
}
