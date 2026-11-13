import { h, mount, api, can, state, table, fullName, fmtDate, fmtDateTime, buildForm, modal, toast, section, btn, tabs } from '../lib.js';
import { patientBanner, uploadDocumentDialog, documentsList, labOrderCard, vitalsSummary } from './common.js';

export async function patientChartView(el, id) {
  const data = await api(`/api/patients/${id}`);
  const p = data.patient;
  const reload = () => { location.hash = `#/patients/${id}?t=${Date.now()}`; };
  const active = data.encounters.find((e) => e.status === 'open' || e.status === 'admitted');

  const actions = h('div', { class: 'toolbar' },
    active ? h('a', { class: 'btn primary', href: `#/encounters/${active.id}` }, `Open current ${active.type === 'IPD' ? 'admission' : 'visit'} →`) : null,
    !active && can('enc.write') ? btn('+ New OPD visit', () => newEncounterDialog(p, 'OPD'), 'primary') : null,
    !active && can('enc.write') ? btn('+ Emergency', () => newEncounterDialog(p, 'EMERGENCY')) : null,
    !active && can('enc.admit') ? btn('+ Direct admission', () => newEncounterDialog(p, 'IPD')) : null,
    can('doc.write') ? btn('Upload document', () => uploadDocumentDialog(p.id, null, reload)) : null,
    can('patient.write') ? h('a', { class: 'btn', href: `#/patients/${p.id}/edit` }, 'Edit details') : null,
    can('clin.read') ? btn('Export (FHIR)', () => exportFhir(p)) : null);

  const encTable = table([
    { label: 'Date', render: (e) => fmtDateTime(e.start_at) },
    { label: 'Type', render: (e) => h('span', { class: `badge type-${e.type.toLowerCase()}` }, e.type) },
    { label: 'Status', render: (e) => h('span', { class: `badge status-${e.status}` }, e.status) },
    { label: 'Department / ward', render: (e) => [e.department, e.ward_name].filter(Boolean).join(' · ') },
    { label: 'Diagnoses', key: 'diagnoses' },
    { label: 'Outcome', key: 'outcome' },
  ], data.encounters, { empty: 'No visits yet.', onRowClick: (e) => { location.hash = `#/encounters/${e.id}`; } });

  const overview = () => h('div', { class: 'grid-2' },
    h('div', null,
      can('clin.read') ? section('Active problems', data.problems.length
        ? h('ul', { class: 'plain' }, data.problems.map((d) => h('li', null, d.icd10_code ? h('code', null, d.icd10_code) : null, ' ', d.description,
          h('span', { class: 'muted small' }, ` · ${d.certainty} · ${fmtDate(d.created_at)}`))))
        : h('p', { class: 'muted' }, 'None recorded')) : null,
      can('clin.read') ? section('Current medications', data.medications.length
        ? h('ul', { class: 'plain' }, data.medications.map((r) => h('li', null, h('b', null, r.drug), ` ${[r.dose, r.route, r.frequency, r.duration].filter(Boolean).join(' ')}`)))
        : h('p', { class: 'muted' }, 'None active')) : null,
      can('clin.read') ? section('Last vital signs', h('p', null, vitalsSummary(data.last_vitals), data.last_vitals ? h('span', { class: 'muted small' }, ` (${fmtDateTime(data.last_vitals.recorded_at)})`) : null)) : null),
    h('div', null, section('Demographics', demographics(p))));

  const t = tabs([
    { id: 'overview', label: 'Overview', render: overview },
    { id: 'visits', label: 'Visits', count: data.encounters.length, render: () => section('Visits & admissions', encTable) },
    can('lab.read') ? { id: 'labs', label: 'Lab results', count: data.labs.length, render: () => section('All laboratory requests',
      data.labs.length ? h('div', null, data.labs.map((l) => labOrderCard(l))) : h('p', { class: 'muted' }, 'No lab requests')) } : null,
    can('doc.read') ? { id: 'docs', label: 'Documents', count: data.documents.length, render: () => section('Scanned documents', documentsList(data.documents, 'No documents uploaded'),
      can('doc.write') ? btn('Upload', () => uploadDocumentDialog(p.id, null, reload), 'small') : null) } : null,
  ].filter(Boolean), 'overview');

  mount(el, patientBanner(p), actions, t.el);
}

function demographics(p) {
  const row = (k, v) => (v ? h('div', { class: 'kv' }, h('dt', null, k), h('dd', null, v)) : null);
  return h('dl', { class: 'kv-list' },
    row('Ghana Card', p.ghana_card), row('NHIS no.', p.nhis_no), row('NHIS expiry', fmtDate(p.nhis_expiry)),
    row('Phone', p.phone), row('Address', p.address), row('GPS address', p.gps_address), row('Hometown', p.hometown), row('Region', p.region),
    row('Occupation', p.occupation), row('Religion', p.religion), row('Marital status', p.marital_status),
    row('Next of kin', [p.nok_name, p.nok_relation && `(${p.nok_relation})`, p.nok_phone].filter(Boolean).join(' ')),
    row('Registered', fmtDateTime(p.created_at)));
}

export function newEncounterDialog(p, type) {
  const m = state.meta;
  const nhisOk = p.nhis_no && (!p.nhis_expiry || p.nhis_expiry >= new Date().toISOString().slice(0, 10));
  const fields = [
    { key: 'department', label: 'Department / clinic', type: 'select', options: m.departments, required: true, span: 'half' },
    { key: 'payer', label: 'Payer', type: 'select', options: m.payers, required: true, span: 'half' },
    { key: 'reason', label: type === 'IPD' ? 'Reason for admission' : 'Chief complaint / reason for visit', span: 'full' },
    { key: 'attending_id', label: 'Doctor / consultant', type: 'select', options: m.doctors.map((d) => [d.id, [d.title, d.full_name].filter(Boolean).join(' ')]), span: 'half' },
  ];
  if (type === 'IPD') {
    fields.push({ key: 'ward_id', label: 'Ward', type: 'select', options: m.wards.map((w) => [w.id, w.name]), required: true, span: 'half' });
    fields.push({ key: 'bed', label: 'Bed', span: 'half' });
  }
  const form = buildForm(fields, { payer: nhisOk ? 'NHIS' : 'Cash', department: type === 'EMERGENCY' ? 'Emergency' : 'General OPD' });
  modal({
    title: type === 'IPD' ? 'Admit patient' : type === 'EMERGENCY' ? 'New emergency visit' : 'New OPD visit',
    body: h('div', null, p.nhis_no && !nhisOk ? h('p', { class: 'alert warn' }, 'NHIS membership has expired – confirm renewal or bill as cash.') : null, form.el),
    actions: [{ label: 'Cancel' }, { label: 'Start', primary: true, onClick: async () => {
      if (!form.validate()) return false;
      const r = await api(`/api/patients/${p.id}/encounters`, { method: 'POST', body: { ...form.values(), type } });
      toast('Visit started');
      location.hash = `#/encounters/${r.id}`;
    } }],
  });
}

async function exportFhir(p) {
  const bundle = await api(`/api/patients/${p.id}/fhir`);
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/fhir+json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `patient-${p.folder_no.replace(/\W+/g, '-')}-fhir.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
