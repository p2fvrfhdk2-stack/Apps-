// Small UI toolkit: safe DOM builder, API client, forms, modals, formatting.

export const state = { me: null, meta: null };

// h('div', {class: 'x', onclick: fn}, 'text', child) — strings become text nodes (never HTML).
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'value' && 'value' in el) el.value = v;
      else if (k === 'checked' || k === 'selected' || k === 'disabled' || k === 'required') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
// Like el.append but skips null/false and flattens arrays.
export const mount = (el, ...children) => { append(el, children); return el; };
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function api(path, { method = 'GET', body, raw, contentType } = {}) {
  const headers = { 'X-HMIS': '1' };
  let payload;
  if (raw) { payload = raw; headers['Content-Type'] = contentType || 'application/octet-stream'; }
  else if (body !== undefined) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
  const res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    if (res.status === 401 && path !== '/api/login') window.dispatchEvent(new Event('hmis:logout'));
    throw new ApiError(res.status, (data && data.error) || `Request failed (${res.status})`);
  }
  return data;
}

export const can = (perm) => {
  const p = state.me ? state.me.perms : [];
  return p.includes('*') || p.includes(perm);
};

// ---------- formatting ----------
const toDate = (s) => (s ? new Date(/Z|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + (s.length > 10 ? 'Z' : '')) : null);
export const fmtDate = (s) => {
  const d = toDate(s);
  return d && !Number.isNaN(+d) ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
};
export const fmtDateTime = (s) => {
  const d = toDate(s);
  return d && !Number.isNaN(+d) ? `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : '';
};
export function age(dob) {
  if (!dob) return '';
  const d = new Date(dob), now = new Date();
  let y = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) y--;
  if (y >= 2) return `${y}y`;
  const months = (now.getFullYear() - d.getFullYear()) * 12 + now.getMonth() - d.getMonth() - (now.getDate() < d.getDate() ? 1 : 0);
  if (months >= 1) return `${months}m`;
  return `${Math.max(0, Math.floor((now - d) / 86400000))}d`;
}
export const fullName = (p) => [p.title, p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ');
export const sexAge = (p) => [p.sex === 'M' ? 'Male' : 'Female', age(p.dob)].filter(Boolean).join(', ');
export const today = () => new Date().toISOString().slice(0, 10);
export function nhisStatus(p) {
  if (!p.nhis_no) return null;
  if (!p.nhis_expiry) return { ok: true, label: 'NHIS' };
  const ok = p.nhis_expiry >= today();
  return { ok, label: ok ? `NHIS valid to ${fmtDate(p.nhis_expiry)}` : `NHIS expired ${fmtDate(p.nhis_expiry)}` };
}
export function news2Badge(score) {
  if (score === null || score === undefined) return null;
  const cls = score >= 7 ? 'high' : score >= 5 ? 'med' : 'low';
  return h('span', { class: `badge news ${cls}`, title: 'NEWS2 early warning score' }, `NEWS2 ${score}`);
}

// ---------- toast ----------
export function toast(msg, type = 'ok') {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div', { id: 'toasts' }); document.body.append(box); }
  const t = h('div', { class: `toast ${type}`, role: 'status' }, msg);
  box.append(t);
  setTimeout(() => t.remove(), type === 'error' ? 6000 : 3000);
}

// ---------- modal ----------
export function modal({ title, body, actions = [], wide = false, onClose }) {
  const prevFocus = document.activeElement;
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); if (onClose) onClose(); if (prevFocus) prevFocus.focus(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const footer = h('div', { class: 'modal-foot' });
  const box = h('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-head' }, h('h2', null, title), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, '×')),
    h('div', { class: 'modal-body' }, body), footer);
  for (const a of actions) {
    const btn = h('button', { class: a.primary ? 'btn primary' : a.danger ? 'btn danger' : 'btn', type: 'button' }, a.label);
    btn.addEventListener('click', async () => {
      if (!a.onClick) return close();
      btn.disabled = true;
      try {
        const r = await a.onClick();
        if (r !== false) close();
      } catch (err) {
        toast(err.message, 'error');
      } finally { btn.disabled = false; }
    });
    footer.append(btn);
  }
  if (!actions.length) footer.append(h('button', { class: 'btn', onclick: close }, 'Close'));
  const overlay = h('div', { class: 'overlay', onmousedown: (e) => { if (e.target === overlay) overlay.dataset.down = '1'; },
    onmouseup: (e) => { if (e.target === overlay && overlay.dataset.down) close(); delete overlay.dataset.down; } }, box);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  const first = box.querySelector('input:not([type=hidden]),select,textarea');
  (first || box.querySelector('.btn')).focus();
  return { close, box };
}

export function confirmDialog(message, { okLabel = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    modal({ title: 'Please confirm', body: h('p', null, message), onClose: () => { if (!answered) resolve(false); },
      actions: [{ label: 'Cancel' }, { label: okLabel, primary: !danger, danger, onClick: () => { answered = true; resolve(true); } }] });
  });
}

export function promptDialog(title, label, { required = true } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const input = h('textarea', { rows: 2 });
    modal({ title, body: h('label', { class: 'field' }, h('span', null, label), input), onClose: () => { if (!answered) resolve(null); },
      actions: [{ label: 'Cancel' }, { label: 'OK', primary: true, onClick: () => {
        if (required && !input.value.trim()) { toast(`${label} is required`, 'error'); return false; }
        answered = true; resolve(input.value.trim());
      } }] });
  });
}

// ---------- forms ----------
// fields: [{key, label, type, options, required, rows, span: 'full'|'half'|'third', placeholder, help}]
// A field may also be {heading: 'Section'}.
export function buildForm(fields, values = {}) {
  const inputs = {};
  const el = h('div', { class: 'form-grid' });
  for (const f of fields) {
    if (f.heading !== undefined && !f.key) { if (f.heading) el.append(h('h3', { class: 'form-heading' }, f.heading)); continue; }
    const v = values[f.key];
    let input;
    if (f.type === 'textarea') input = h('textarea', { rows: f.rows || 3, placeholder: f.placeholder }, v ?? '');
    else if (f.type === 'select') {
      input = h('select', null, h('option', { value: '' }, f.placeholder || '—'),
        (f.options || []).map((o) => {
          const [val, lab] = Array.isArray(o) ? o : typeof o === 'object' ? [o.value, o.label] : [o, o];
          return h('option', { value: val, selected: String(v ?? '') === String(val) }, lab);
        }));
    } else if (f.type === 'checkbox') input = h('input', { type: 'checkbox', checked: !!v });
    else input = h('input', { type: f.type || 'text', value: v ?? '', placeholder: f.placeholder, step: f.step || (f.type === 'number' ? 'any' : null), list: f.list, autocomplete: 'off', maxlength: f.maxlength });
    if (f.required) input.required = true;
    input.name = f.key;
    inputs[f.key] = input;
    const span = f.span || (f.type === 'textarea' ? 'full' : 'third');
    if (f.type === 'checkbox') {
      el.append(h('label', { class: `field check ${span}` }, input, h('span', null, f.label)));
    } else {
      el.append(h('label', { class: `field ${span}` }, h('span', null, f.label, f.required ? h('b', { class: 'req' }, ' *') : null), input, f.help ? h('small', null, f.help) : null));
    }
  }
  return {
    el, inputs,
    values() {
      const out = {};
      for (const [k, i] of Object.entries(inputs)) out[k] = i.type === 'checkbox' ? i.checked : i.value.trim();
      return out;
    },
    validate() {
      for (const f of fields) {
        if (!f.required || !f.key) continue;
        const i = inputs[f.key];
        if (!i.value.trim()) { i.focus(); toast(`${f.label} is required`, 'error'); return false; }
      }
      return true;
    },
  };
}

export function table(columns, rows, { empty = 'Nothing to show', onRowClick } = {}) {
  if (!rows.length) return h('p', { class: 'muted empty' }, empty);
  return h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
    h('thead', null, h('tr', null, columns.map((c) => h('th', { class: c.cls }, c.label)))),
    h('tbody', null, rows.map((r) => h('tr', { class: onRowClick ? 'clickable' : null, onclick: onRowClick ? () => onRowClick(r) : null },
      columns.map((c) => h('td', { class: c.cls, 'data-label': c.label }, c.render ? c.render(r) : r[c.key] ?? '')))))));
}

export function tabs(defs, initial) {
  const bar = h('div', { class: 'tabs', role: 'tablist' });
  const panel = h('div', { class: 'tab-panel' });
  let current = defs.find((d) => d.id === initial) ? initial : defs[0].id;
  const render = () => {
    clear(bar);
    for (const d of defs) {
      bar.append(h('button', { class: `tab${d.id === current ? ' active' : ''}`, role: 'tab', 'aria-selected': d.id === current ? 'true' : 'false',
        onclick: () => { current = d.id; render(); } }, d.label, d.count ? h('span', { class: 'count' }, d.count) : null));
    }
    clear(panel);
    const def = defs.find((d) => d.id === current);
    const content = def.render();
    if (content) panel.append(content);
  };
  render();
  return { el: h('div', null, bar, panel), current: () => current };
}

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export const section = (title, body, actions) =>
  h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, title), actions ? h('div', { class: 'card-actions' }, actions) : null), body);

export const btn = (label, onclick, cls = '') => h('button', { class: `btn ${cls}`.trim(), type: 'button', onclick }, label);
