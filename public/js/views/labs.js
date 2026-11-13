import { h, mount, api, can, clear, fmtDateTime, modal, toast, table, sexAge, promptDialog, buildForm } from '../lib.js';
import { labResultTable } from './common.js';

let currentStatus = 'pending';

export async function labsView(el) {
  const body = h('div');
  const chips = h('div', { class: 'chips' });
  const statuses = [['pending', 'Pending (to collect / result)'], ['resulted', 'Resulted (14 days)'], ['cancelled', 'Cancelled']];
  const load = async () => {
    clear(chips).append(...statuses.map(([k, l]) => h('button', { class: `chip${currentStatus === k ? ' active' : ''}`, onclick: () => { currentStatus = k; load(); } }, l)));
    const rows = await api(`/api/labs?status=${currentStatus}`);
    clear(body).append(table([
      { label: 'Priority', render: (r) => (r.priority === 'routine' ? 'Routine' : h('span', { class: 'badge warn' }, r.priority.toUpperCase())) },
      { label: 'Ordered', render: (r) => fmtDateTime(r.ordered_at) },
      { label: 'Patient', render: (r) => h('span', null, h('b', null, `${r.first_name} ${r.last_name}`), h('br'), h('small', { class: 'muted' }, `${sexAge(r)} · ${r.folder_no}`)) },
      { label: 'Test', render: (r) => h('span', null, r.test_name, h('br'), h('small', { class: 'muted' }, r.specimen || '')) },
      { label: 'Clinical info', key: 'clinical_info' },
      { label: 'Requested by', key: 'ordered_by_name' },
      { label: 'Status', render: (r) => h('span', { class: `badge status-${r.status}` }, r.status, r.sample_id ? ` · ${r.sample_id}` : '') },
      { label: '', render: (r) => actions(r, load) },
    ], rows, { empty: currentStatus === 'pending' ? 'No pending requests. 🎉' : 'Nothing here.' }));
  };
  mount(el, h('div', { class: 'page-head' }, h('h1', null, 'Laboratory'), h('button', { class: 'btn', onclick: load }, 'Refresh')), chips, body);
  await load();
}

function actions(r, reload) {
  const out = h('span', { class: 'row-actions' });
  if (can('lab.result') && r.status === 'ordered') {
    out.append(h('button', { class: 'btn small', onclick: () => collectDialog(r, reload) }, 'Collect sample'));
  }
  if (can('lab.result') && (r.status === 'ordered' || r.status === 'collected')) {
    out.append(h('button', { class: 'btn small primary', onclick: () => resultDialog(r.id, reload) }, 'Enter results'));
    out.append(h('button', { class: 'btn small', onclick: async () => {
      const reason = await promptDialog('Reject / cancel request', 'Reason (e.g. haemolysed sample, wrong container)');
      if (!reason) return;
      try { await api(`/api/labs/${r.id}/cancel`, { method: 'POST', body: { reason } }); reload(); } catch (err) { toast(err.message, 'error'); }
    } }, 'Reject'));
  }
  if (r.status === 'resulted') {
    out.append(h('button', { class: 'btn small', onclick: () => modal({ title: `${r.test_name} – ${r.first_name} ${r.last_name}`, wide: true,
      body: h('div', null, labResultTable(r.results), r.comment ? h('p', null, h('b', null, 'Comment: '), r.comment) : null,
        h('p', { class: 'muted small' }, `Resulted ${fmtDateTime(r.resulted_at)} by ${r.resulted_by_name}`)) }) }, 'View'));
    if (can('lab.result')) out.append(h('button', { class: 'btn small', onclick: () => resultDialog(r.id, reload, true) }, 'Correct'));
  }
  if (can('clin.read')) out.append(h('a', { class: 'btn small', href: `#/encounters/${r.encounter_id}` }, 'Chart'));
  return out;
}

function collectDialog(r, reload) {
  const form = buildForm([{ key: 'sample_id', label: 'Sample / accession number', span: 'full', placeholder: 'Leave blank to auto-number' }]);
  modal({
    title: `Collect sample – ${r.test_name}`, body: form.el,
    actions: [{ label: 'Cancel' }, { label: 'Mark collected', primary: true, onClick: async () => {
      await api(`/api/labs/${r.id}/collect`, { method: 'POST', body: form.values() });
      toast('Sample collected'); reload();
    } }],
  });
}

async function resultDialog(id, reload, correcting = false) {
  const { order, params } = await api(`/api/labs/${id}`);
  const existing = Object.fromEntries((order.results || []).map((x) => [x.name, x.value]));
  const inputs = {};
  const flag = (p, v) => {
    if (v === '') return '';
    if (p.options) return (p.abnormal || []).includes(v) ? 'Abnormal' : '';
    const n = Number(v);
    if (Number.isNaN(n)) return '';
    if (p.low !== null && p.low !== undefined && n < p.low) return '▼ Low';
    if (p.high !== null && p.high !== undefined && n > p.high) return '▲ High';
    return '';
  };
  const rows = params.map((p) => {
    const input = p.options
      ? h('select', null, h('option', { value: '' }, '—'), p.options.map((o) => h('option', { value: o, selected: existing[p.name] === o }, o)))
      : (p.unit || (p.low !== null && p.low !== undefined) || (p.high !== null && p.high !== undefined))
        ? h('input', { type: 'text', inputmode: 'decimal', value: existing[p.name] ?? '' })
        : h('textarea', { rows: 2 }, existing[p.name] ?? '');
    inputs[p.name] = input;
    const flagEl = h('span', { class: 'flag' });
    const update = () => { flagEl.textContent = flag(p, input.value.trim()); };
    input.addEventListener('input', update);
    input.addEventListener('change', update);
    update();
    const ref = p.low !== null && p.low !== undefined && p.high !== null && p.high !== undefined ? `${p.low} – ${p.high}`
      : p.high !== null && p.high !== undefined ? `< ${p.high}` : p.low !== null && p.low !== undefined ? `> ${p.low}` : '';
    return h('tr', null, h('th', null, p.name), h('td', null, input), h('td', null, p.unit || ''), h('td', { class: 'muted small' }, ref), h('td', null, flagEl));
  });
  const comment = h('textarea', { rows: 2 }, order.comment || '');
  modal({
    title: `${correcting ? 'Correct' : 'Enter'} results – ${order.test_name}`, wide: true,
    body: h('div', null,
      h('p', null, h('b', null, `${order.first_name} ${order.last_name}`), ` · ${sexAge(order)} · ${order.folder_no}`, order.clinical_info ? h('span', { class: 'muted' }, ` · ${order.clinical_info}`) : null),
      correcting ? h('p', { class: 'alert warn' }, 'Correcting a released result is logged in the audit trail with the previous values.') : null,
      h('table', { class: 'result-entry' }, h('tbody', null, rows)),
      h('label', { class: 'field full' }, h('span', null, 'Comment / interpretation'), comment)),
    actions: [{ label: 'Cancel' }, { label: 'Release results', primary: true, onClick: async () => {
      const values = Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value.trim()]));
      await api(`/api/labs/${id}/result`, { method: 'POST', body: { values, comment: comment.value.trim() } });
      toast('Results released'); reload();
    } }],
  });
}
