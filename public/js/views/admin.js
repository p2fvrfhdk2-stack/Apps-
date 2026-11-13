import { h, mount, api, state, table, buildForm, modal, toast, section, btn, tabs, fmtDateTime, clear } from '../lib.js';

let lastTab = 'users';

export async function adminView(el) {
  const [users, wards, tests] = await Promise.all([api('/api/admin/users'), api('/api/admin/wards'), api('/api/admin/lab-tests')]);
  const reload = async () => { const fresh = h('div', { class: 'view' }); await adminView(fresh); el.replaceWith(fresh); };
  const t = tabs([
    { id: 'users', label: 'Users', render: () => { lastTab = 'users'; return usersPanel(users, reload); } },
    { id: 'wards', label: 'Wards', render: () => { lastTab = 'wards'; return wardsPanel(wards, reload); } },
    { id: 'labs', label: 'Lab tests', render: () => { lastTab = 'labs'; return labTestsPanel(tests, reload); } },
    { id: 'icd', label: 'ICD-10 / G-DRG', render: () => { lastTab = 'icd'; return icdPanel(); } },
    { id: 'settings', label: 'Settings', render: () => { lastTab = 'settings'; return settingsPanel(); } },
    { id: 'audit', label: 'Audit log', render: () => { lastTab = 'audit'; return auditPanel(users); } },
  ], lastTab);
  mount(el, h('div', { class: 'page-head' }, h('h1', null, 'Administration')), t.el);
}

function usersPanel(users, reload) {
  const edit = (u) => {
    const form = buildForm([
      ...(u ? [] : [{ key: 'username', label: 'Username', required: true, span: 'half' }]),
      { key: 'full_name', label: 'Full name', required: true, span: 'half' },
      { key: 'title', label: 'Title', placeholder: 'Dr, Nurse, MLS…', span: 'third' },
      { key: 'role', label: 'Role', type: 'select', options: state.meta.roles, required: true, span: 'third' },
      ...(u ? [{ key: 'active', label: 'Account active', type: 'checkbox', span: 'third' }] : []),
      { key: 'password', label: u ? 'Reset password (leave blank to keep)' : 'Temporary password', type: 'password', required: !u, span: 'half',
        help: 'User must change it at next sign-in.' },
    ], u ? { ...u, active: !!u.active } : { role: 'doctor' });
    modal({
      title: u ? `Edit ${u.username}` : 'New user', body: form.el,
      actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async () => {
        if (!form.validate()) return false;
        const v = form.values();
        if (u) { if (!v.password) delete v.password; await api(`/api/admin/users/${u.id}`, { method: 'PUT', body: v }); }
        else await api('/api/admin/users', { method: 'POST', body: v });
        toast('User saved'); reload();
      } }],
    });
  };
  return section('Staff accounts', table([
    { label: 'Username', key: 'username' },
    { label: 'Name', render: (u) => [u.title, u.full_name].filter(Boolean).join(' ') },
    { label: 'Role', key: 'role' },
    { label: 'Status', render: (u) => h('span', { class: `badge ${u.active ? 'ok' : 'warn'}` }, u.active ? 'Active' : 'Disabled') },
    { label: 'Created', render: (u) => fmtDateTime(u.created_at) },
  ], users, { onRowClick: edit }), btn('+ New user', () => edit(null), 'primary small'));
}

function wardsPanel(wards, reload) {
  const edit = (w) => {
    const form = buildForm([
      { key: 'name', label: 'Ward name', required: true, span: 'half' },
      { key: 'kind', label: 'Type', type: 'select', options: ['Medical', 'Surgical', 'Maternity', 'Paediatric', 'Emergency', 'ICU', 'Private', 'Other'], span: 'third' },
      { key: 'beds', label: 'Number of beds', type: 'number', span: 'third' },
      ...(w ? [{ key: 'active', label: 'Active', type: 'checkbox', span: 'third' }] : []),
    ], w ? { ...w, active: !!w.active } : {});
    modal({ title: w ? `Edit ${w.name}` : 'New ward', body: form.el, actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async () => {
      if (!form.validate()) return false;
      if (w) await api(`/api/admin/wards/${w.id}`, { method: 'PUT', body: form.values() });
      else await api('/api/admin/wards', { method: 'POST', body: form.values() });
      toast('Ward saved'); reload();
    } }] });
  };
  return section('Wards', table([
    { label: 'Name', key: 'name' }, { label: 'Type', key: 'kind' }, { label: 'Beds', key: 'beds' },
    { label: 'Status', render: (w) => (w.active ? 'Active' : 'Closed') },
  ], wards, { onRowClick: edit }), btn('+ New ward', () => edit(null), 'primary small'));
}

// Parameters are edited one per line: name | unit | low | high | LOINC   or   name | options: A, B, C | abnormal: B | LOINC
const paramsToText = (params) => params.map((p) => (p.options
  ? [p.name, `options: ${p.options.join(', ')}`, `abnormal: ${(p.abnormal || []).join(', ')}`, p.loinc || ''].join(' | ')
  : [p.name, p.unit || '', p.low ?? '', p.high ?? '', p.loinc || ''].join(' | '))).join('\n');
function textToParams(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const c = line.split('|').map((x) => x.trim());
    if (c[1] && c[1].toLowerCase().startsWith('options:')) {
      const options = c[1].slice(8).split(',').map((x) => x.trim()).filter(Boolean);
      const abnormal = (c[2] || '').replace(/^abnormal:/i, '').split(',').map((x) => x.trim()).filter(Boolean);
      return { name: c[0], options, abnormal, loinc: c[3] || null };
    }
    return { name: c[0], unit: c[1] || '', low: c[2] || null, high: c[3] || null, loinc: c[4] || null };
  });
}

function labTestsPanel(tests, reload) {
  const edit = (t) => {
    const form = buildForm([
      { key: 'code', label: 'Code', required: true, span: 'third' },
      { key: 'name', label: 'Test name', required: true, span: 'third' },
      { key: 'section', label: 'Section', type: 'select', options: ['Haematology', 'Chemistry', 'Microbiology', 'Serology', 'Parasitology', 'Histopathology', 'Other'], span: 'third' },
      { key: 'specimen', label: 'Specimen', span: 'third' },
      ...(t ? [{ key: 'active', label: 'Available for ordering', type: 'checkbox', span: 'third' }] : []),
      { key: 'params', label: 'Parameters (one per line)', type: 'textarea', rows: 8, required: true,
        help: 'Numeric:  Name | unit | low | high | LOINC      Choice:  Name | options: Negative, Positive | abnormal: Positive | LOINC      Free text:  Name' },
    ], t ? { ...t, active: !!t.active, params: paramsToText(t.params) } : {});
    form.inputs.params.classList.add('mono');
    modal({ title: t ? `Edit ${t.name}` : 'New lab test', wide: true, body: form.el, actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async () => {
      if (!form.validate()) return false;
      const v = form.values();
      v.params = textToParams(v.params);
      if (t) await api(`/api/admin/lab-tests/${t.id}`, { method: 'PUT', body: v });
      else await api('/api/admin/lab-tests', { method: 'POST', body: v });
      toast('Lab test saved'); reload();
    } }] });
  };
  return section('Laboratory test catalogue', h('div', null,
    h('p', { class: 'muted small' }, 'Reference intervals are adult defaults in SI units. Replace them with your laboratory\'s validated intervals.'),
    table([
      { label: 'Code', key: 'code' }, { label: 'Name', key: 'name' }, { label: 'Section', key: 'section' }, { label: 'Specimen', key: 'specimen' },
      { label: 'Parameters', render: (t) => t.params.map((p) => p.name).join(', ') },
      { label: 'Status', render: (t) => (t.active ? 'Active' : 'Inactive') },
    ], tests, { onRowClick: edit })), btn('+ New test', () => edit(null), 'primary small'));
}

function icdPanel() {
  const file = h('input', { type: 'file', accept: '.csv,text/csv,text/plain' });
  const out = h('div');
  return section('Import ICD-10 codes and G-DRG mapping', h('div', null,
    h('p', null, 'Upload a CSV file with columns ', h('code', null, 'code,title,gdrg_code'), '. Existing codes are updated; new codes are added. ',
      'Use this to load the full WHO ICD-10 list and to map codes to the current NHIA G-DRG tariff. The title column may be left empty to update only the G-DRG code.'),
    h('pre', { class: 'mono small' }, 'code,title,gdrg_code\nB50.9,"Plasmodium falciparum malaria, unspecified",<G-DRG code>\nI10,Essential (primary) hypertension,<G-DRG code>'),
    h('label', { class: 'field' }, h('span', null, 'CSV file'), file),
    btn('Import', async () => {
      const f = file.files[0];
      if (!f) return toast('Choose a CSV file', 'error');
      try {
        const r = await api('/api/admin/icd10/import', { method: 'POST', raw: f, contentType: 'text/csv' });
        clear(out).append(h('p', { class: 'alert' }, `Imported: ${r.added} added, ${r.updated} updated, ${r.skipped} skipped.`));
      } catch (err) { toast(err.message, 'error'); }
    }, 'primary'), out));
}

function settingsPanel() {
  const form = buildForm([{ key: 'hospital_name', label: 'Facility name (shown on screens and printouts)', span: 'full', required: true }], { hospital_name: state.meta.hospital_name });
  return section('Facility settings', h('div', null, form.el, btn('Save', async () => {
    if (!form.validate()) return;
    try { await api('/api/admin/settings', { method: 'PUT', body: form.values() }); state.meta.hospital_name = form.values().hospital_name; toast('Saved – reload to see the new name everywhere'); } catch (err) { toast(err.message, 'error'); }
  }, 'primary')));
}

function auditPanel(users) {
  const userSel = h('select', { 'aria-label': 'User' }, h('option', { value: '' }, 'All users'), users.map((u) => h('option', { value: u.id }, u.username)));
  const pid = h('input', { type: 'number', placeholder: 'Patient ID', 'aria-label': 'Patient ID' });
  const body = h('div');
  const load = async () => {
    const qs = new URLSearchParams();
    if (userSel.value) qs.set('user_id', userSel.value);
    if (pid.value) qs.set('patient_id', pid.value);
    try {
      const rows = await api(`/api/admin/audit?${qs}`);
      clear(body).append(table([
        { label: 'Time', render: (r) => fmtDateTime(r.at) }, { label: 'User', key: 'username' }, { label: 'Action', key: 'action' },
        { label: 'Record', render: (r) => (r.entity ? `${r.entity}${r.entity_id ? ' #' + r.entity_id : ''}` : '') },
        { label: 'Patient', key: 'folder_no' }, { label: 'Detail', key: 'detail' }, { label: 'IP', key: 'ip' },
      ], rows));
    } catch (err) { toast(err.message, 'error'); }
  };
  userSel.addEventListener('change', load);
  pid.addEventListener('change', load);
  load();
  return section('Audit trail (latest 300 events)', body, h('span', { class: 'row-actions' }, userSel, pid));
}
