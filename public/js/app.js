import { h, clear, api, state, can, toast, buildForm } from './lib.js';
import { dashboardView } from './views/dashboard.js';
import { patientListView, patientFormView } from './views/patients.js';
import { patientChartView } from './views/patient.js';
import { encounterView, encounterPrintView } from './views/encounter.js';
import { labsView } from './views/labs.js';
import { wardsView } from './views/wards.js';
import { adminView } from './views/admin.js';
import { accountView } from './views/account.js';

const root = document.getElementById('root');

const ROUTES = [
  [/^\/$/, dashboardView],
  [/^\/patients$/, patientListView],
  [/^\/patients\/new$/, (el) => patientFormView(el, null)],
  [/^\/patients\/(\d+)\/edit$/, (el, [id]) => patientFormView(el, id)],
  [/^\/patients\/(\d+)$/, (el, [id]) => patientChartView(el, id)],
  [/^\/encounters\/(\d+)\/print$/, (el, [id]) => encounterPrintView(el, id)],
  [/^\/encounters\/(\d+)$/, (el, [id]) => encounterView(el, id)],
  [/^\/labs$/, labsView],
  [/^\/wards$/, wardsView],
  [/^\/admin$/, adminView],
  [/^\/account$/, accountView],
];

const NAV = [
  { href: '#/', label: 'Dashboard', icon: '▦' },
  { href: '#/patients', label: 'Patients', icon: '☰', perm: 'patient.read' },
  { href: '#/wards', label: 'Wards', icon: '⌂', perm: 'clin.read' },
  { href: '#/labs', label: 'Laboratory', icon: '⚗', perm: 'lab.read' },
  { href: '#/admin', label: 'Administration', icon: '⚙', perm: 'admin' },
];

async function boot() {
  try {
    state.me = await api('/api/me');
  } catch {
    return loginScreen();
  }
  if (state.me.must_change_password) return changePasswordScreen();
  state.meta = await api('/api/meta');
  document.title = `${state.meta.hospital_name} · HMIS`;
  shell();
}

function shell() {
  clear(root);
  const main = h('main', { id: 'main', tabindex: '-1' });
  const nav = h('nav', { class: 'nav' },
    NAV.filter((n) => !n.perm || can(n.perm)).map((n) => h('a', { href: n.href, 'data-href': n.href }, h('span', { class: 'ico', 'aria-hidden': 'true' }, n.icon), h('span', null, n.label))));
  const sidebar = h('aside', { class: 'sidebar' },
    h('div', { class: 'brand' }, h('img', { src: '/favicon.svg', alt: '', width: 28, height: 28 }), h('div', null, h('strong', null, 'HMIS'), h('small', null, state.meta.hospital_name))),
    nav,
    h('div', { class: 'user-box' },
      h('a', { href: '#/account', class: 'user-name' }, [state.me.title, state.me.full_name].filter(Boolean).join(' ')),
      h('small', null, state.me.role),
      h('button', { class: 'btn small', onclick: logout }, 'Sign out')));
  const toggle = h('button', { class: 'menu-toggle', 'aria-label': 'Menu', onclick: () => document.body.classList.toggle('nav-open') }, '☰');
  root.append(h('div', { class: 'layout' }, toggle, sidebar, main));
  window.onhashchange = () => route(main, nav);
  route(main, nav);
}

async function route(main, nav) {
  document.body.classList.remove('nav-open');
  const path = (location.hash || '#/').slice(1) || '/';
  const [pathname] = path.split('?');
  for (const a of nav.querySelectorAll('a')) {
    const href = a.dataset.href.slice(1);
    a.classList.toggle('active', href === '/' ? pathname === '/' : pathname.startsWith(href));
  }
  document.body.classList.toggle('print-mode', /\/print$/.test(pathname));
  for (const [re, view] of ROUTES) {
    const m = re.exec(pathname);
    if (!m) continue;
    clear(main);
    main.append(h('p', { class: 'muted' }, 'Loading…'));
    try {
      const content = h('div', { class: 'view' });
      await view(content, m.slice(1));
      clear(main).append(content);
      main.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    } catch (err) {
      clear(main).append(h('div', { class: 'card error-card' }, h('h2', null, 'Could not load this page'), h('p', null, err.message)));
    }
    return;
  }
  clear(main).append(h('div', { class: 'card' }, h('h2', null, 'Page not found'), h('a', { href: '#/' }, 'Go to dashboard')));
}

function loginScreen() {
  clear(root);
  const form = buildForm([
    { key: 'username', label: 'Username', required: true, span: 'full' },
    { key: 'password', label: 'Password', type: 'password', required: true, span: 'full' },
  ]);
  form.inputs.username.autocomplete = 'username';
  form.inputs.password.autocomplete = 'current-password';
  const err = h('p', { class: 'form-error', role: 'alert' });
  const submit = async (e) => {
    e.preventDefault();
    err.textContent = '';
    try {
      await api('/api/login', { method: 'POST', body: form.values() });
      boot();
    } catch (ex) { err.textContent = ex.message; }
  };
  root.append(h('div', { class: 'login-wrap' },
    h('form', { class: 'login card', onsubmit: submit },
      h('div', { class: 'brand big' }, h('img', { src: '/favicon.svg', alt: '', width: 40, height: 40 }), h('div', null, h('strong', null, 'Hospital Information System'), h('small', null, 'Authorised staff only'))),
      form.el, err, h('button', { class: 'btn primary block', type: 'submit' }, 'Sign in'))));
  form.inputs.username.focus();
}

function changePasswordScreen() {
  clear(root);
  const form = buildForm([
    { key: 'current', label: 'Current (temporary) password', type: 'password', required: true, span: 'full' },
    { key: 'password', label: 'New password', type: 'password', required: true, span: 'full', help: 'At least 8 characters with letters and numbers.' },
    { key: 'confirm', label: 'Repeat new password', type: 'password', required: true, span: 'full' },
  ]);
  const err = h('p', { class: 'form-error', role: 'alert' });
  root.append(h('div', { class: 'login-wrap' },
    h('form', { class: 'login card', onsubmit: async (e) => {
      e.preventDefault();
      const v = form.values();
      if (v.password !== v.confirm) { err.textContent = 'New passwords do not match'; return; }
      try {
        await api('/api/me/password', { method: 'POST', body: v });
        toast('Password changed');
        boot();
      } catch (ex) { err.textContent = ex.message; }
    } },
      h('h2', null, 'Set your password'),
      h('p', { class: 'muted' }, `Welcome ${state.me.full_name}. Please choose a personal password before continuing.`),
      form.el, err,
      h('button', { class: 'btn primary block', type: 'submit' }, 'Save password'),
      h('button', { class: 'btn link block', type: 'button', onclick: logout }, 'Sign out'))));
}

async function logout() {
  try { await api('/api/logout', { method: 'POST' }); } catch { /* ignore */ }
  state.me = null;
  location.hash = '#/';
  loginScreen();
}

window.addEventListener('hmis:logout', () => {
  if (state.me) { state.me = null; toast('Your session has ended. Please sign in again.', 'error'); loginScreen(); }
});

boot();
