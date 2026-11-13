import { h, mount, api, can, state, table, fullName, sexAge, fmtDateTime, news2Badge, section, clear } from '../lib.js';

export async function dashboardView(el) {
  const d = await api('/api/dashboard');
  const tile = (label, value, href) => h(href ? 'a' : 'div', { class: 'tile', href }, h('span', { class: 'tile-value' }, value), h('span', { class: 'tile-label' }, label));

  const search = h('input', { type: 'search', placeholder: 'Find patient: name, folder no., phone, NHIS or Ghana Card…', class: 'big-search', 'aria-label': 'Find patient' });
  const searchForm = h('form', { class: 'search-row', onsubmit: (e) => { e.preventDefault(); location.hash = `#/patients?q=${encodeURIComponent(search.value.trim())}`; } },
    search, h('button', { class: 'btn primary', type: 'submit' }, 'Search'),
    can('patient.write') ? h('a', { class: 'btn', href: '#/patients/new' }, '+ Register patient') : null);

  mount(el, 
    h('div', { class: 'page-head' }, h('h1', null, `Akwaaba, ${[state.me.title, state.me.full_name.split(' ')[0]].filter(Boolean).join(' ')}`)),
    can('patient.read') ? searchForm : null,
    h('div', { class: 'tiles' },
      tile('Open OPD / emergency visits', d.opd_open),
      tile('Inpatients', d.inpatients, can('clin.read') ? '#/wards' : null),
      tile('Registered today', d.registered_today),
      tile('Lab requests pending', d.labs_pending, can('lab.read') ? '#/labs' : null)));

  if (d.labs_unseen_abnormal && d.labs_unseen_abnormal.length) {
    mount(el, section('Abnormal results on your requests (last 3 days)', table([
      { label: 'Resulted', render: (r) => fmtDateTime(r.resulted_at) },
      { label: 'Patient', render: (r) => `${r.first_name} ${r.last_name} (${r.folder_no})` },
      { label: 'Test', key: 'test_name' },
    ], d.labs_unseen_abnormal, { onRowClick: (r) => { location.hash = `#/encounters/${r.encounter_id}`; } })));
  }

  if (can('patient.read')) {
    const deptSel = h('select', { 'aria-label': 'Department' }, h('option', { value: '' }, 'All departments'), state.meta.departments.map((x) => h('option', { value: x }, x)));
    const body = h('div');
    const load = async () => {
      const qs = new URLSearchParams({ status: 'open' });
      if (deptSel.value) qs.set('department', deptSel.value);
      const rows = await api(`/api/encounters?${qs}`);
      clear(body).append(table([
        { label: 'Arrived', render: (r) => fmtDateTime(r.start_at) },
        { label: 'Patient', render: (r) => h('span', null, h('b', null, fullName(r)), h('br'), h('small', { class: 'muted' }, `${sexAge(r)} · ${r.folder_no}`)) },
        { label: 'Type', render: (r) => h('span', { class: `badge type-${r.type.toLowerCase()}` }, r.type) },
        { label: 'Department', key: 'department' },
        { label: 'Complaint / reason', key: 'reason' },
        { label: 'Diagnosis', key: 'diagnosis' },
        { label: 'Payer', key: 'payer' },
        { label: 'NEWS2', render: (r) => news2Badge(r.news2) || '' },
      ], rows, { empty: 'No patients waiting.', onRowClick: (r) => { location.hash = `#/encounters/${r.id}`; } }));
    };
    deptSel.addEventListener('change', load);
    await load();
    mount(el, section('Clinic queue – open visits', body, deptSel));
  }
}
