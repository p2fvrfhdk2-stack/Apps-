import { h, mount, api, fmtDate, age, news2Badge, section } from '../lib.js';

export async function wardsView(el) {
  const wards = await api('/api/wards');
  const total = wards.reduce((s, w) => s + w.patients.length, 0);
  const beds = wards.reduce((s, w) => s + w.beds, 0);
  mount(el, h('div', { class: 'page-head' }, h('h1', null, 'Wards'), h('span', { class: 'muted' }, `${total} inpatients · ${beds} beds`)));
  const grid = h('div', { class: 'ward-grid' });
  for (const w of wards) {
    const pct = w.beds ? Math.round((w.patients.length / w.beds) * 100) : 0;
    grid.append(section(`${w.name}`, h('div', null,
      h('div', { class: 'occupancy', title: `${pct}% occupied` }, h('div', { class: `occ-bar${pct > 100 ? ' over' : ''}`, style: null, dataset: { pct: Math.min(pct, 100) } })),
      w.patients.length ? h('ul', { class: 'ward-list' }, w.patients.map((p) => h('li', null,
        h('a', { href: `#/encounters/${p.encounter_id}` },
          h('span', { class: 'bed' }, p.bed || '—'),
          h('span', { class: 'who' }, h('b', null, `${p.first_name} ${p.last_name}`), h('small', { class: 'muted' }, ` ${p.sex} ${age(p.dob)} · ${p.folder_no}`),
            h('br'), h('small', null, p.diagnosis || 'No diagnosis yet'), h('small', { class: 'muted' }, ` · adm. ${fmtDate(p.admitted_at)}`)),
          news2Badge(p.news2))))) : h('p', { class: 'muted' }, 'No patients')),
      h('span', { class: 'muted small' }, `${w.patients.length}/${w.beds} beds`)));
  }
  mount(el, grid);
  // CSP forbids inline style attributes from markup; set widths via CSSOM instead.
  for (const bar of el.querySelectorAll('.occ-bar')) bar.style.width = `${bar.dataset.pct}%`;
}
