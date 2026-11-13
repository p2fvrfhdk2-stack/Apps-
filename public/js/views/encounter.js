import {
  h, mount, api, can, state, clear, fmtDateTime, fmtDate, buildForm, modal, toast, section, btn, tabs, debounce,
  confirmDialog, promptDialog, news2Badge, fullName, sexAge, table,
} from '../lib.js';
import { patientBanner, uploadDocumentDialog, documentsList, labOrderCard, vitalsSummary, labResultTable } from './common.js';

let lastTab = 'notes';

export async function encounterView(el, id) {
  const data = await api(`/api/encounters/${id}`);
  const { encounter: e, patient: p } = data;
  const isActive = e.status === 'open' || e.status === 'admitted';
  const defs = state.meta.note_defs;
  const reload = async () => {
    const fresh = h('div', { class: 'view' });
    await encounterView(fresh, id);
    el.replaceWith(fresh);
  };

  // ----- action toolbar -----
  const noteBtn = (kind, label) => (isActive && can(defs[kind].perm) ? btn(label, () => noteDialog(e, kind, null, reload)) : null);
  const toolbar = h('div', { class: 'toolbar' },
    noteBtn('clerking', '+ Clerking'),
    noteBtn('progress', "+ Doctor's note / plan"),
    noteBtn('nursing', "+ Nurses' note"),
    isActive && can('vitals.write') ? btn('+ Vitals', () => vitalsDialog(e, p, reload)) : null,
    isActive && can('dx.write') ? btn('+ Diagnosis', () => diagnosisDialog(e, reload)) : null,
    isActive && can('rx.write') ? btn('+ Prescription', () => prescriptionDialog(e, reload)) : null,
    isActive && can('lab.order') ? btn('+ Lab request', () => labOrderDialog(e, reload)) : null,
    noteBtn('theatre', '+ Theatre note'),
    noteBtn('procedure', '+ Procedure'),
    can('doc.write') ? btn('Upload document', () => uploadDocumentDialog(p.id, e.id, reload)) : null,
    h('span', { class: 'spacer' }),
    isActive && can('enc.admit') ? btn(e.status === 'admitted' ? 'Transfer ward/bed' : 'Admit', () => admitDialog(e, reload)) : null,
    isActive && can('enc.close') ? btn(e.status === 'admitted' ? 'Discharge' : 'Close visit', () => closeDialog(e, data, reload), 'danger-outline') : null,
    can('clin.read') ? h('a', { class: 'btn', href: `#/encounters/${e.id}/print`, target: '_blank' }, 'Print summary') : null);

  // ----- tabs -----
  const tabDefs = [];
  if (can('clin.read')) {
    tabDefs.push({ id: 'notes', label: 'Notes', count: data.notes.filter((n) => !n.superseded_by).length, render: () => notesPanel(data.notes, e, isActive, reload) });
    tabDefs.push({ id: 'vitals', label: 'Vitals', count: data.vitals.length, render: () => vitalsPanel(data.vitals) });
    tabDefs.push({ id: 'meds', label: 'Prescriptions', count: data.prescriptions.filter((r) => r.status === 'active').length, render: () => rxPanel(data.prescriptions, isActive, reload) });
  }
  if (can('lab.read')) tabDefs.push({ id: 'labs', label: 'Labs', count: data.labs.length, render: () => labsPanel(data.labs, reload) });
  if (can('doc.read')) tabDefs.push({ id: 'docs', label: 'Documents', count: data.documents.length, render: () => section('Documents for this visit', documentsList(data.documents)) });
  if (e.discharge_summary || e.follow_up) {
    tabDefs.push({ id: 'discharge', label: e.status === 'discharged' ? 'Discharge summary' : 'Closing summary', render: () => section('Summary', h('div', null,
      h('p', null, h('b', null, 'Outcome: '), e.outcome || ''), h('div', { class: 'prewrap' }, e.discharge_summary || ''), e.follow_up ? h('p', null, h('b', null, 'Follow-up: '), e.follow_up) : null)) });
  }
  const t = tabDefs.length ? tabs(tabDefs.map((d) => ({ ...d, render: () => { lastTab = d.id; return d.render(); } })), lastTab) : null;

  // ----- side panel -----
  const side = can('clin.read') ? h('aside', { class: 'side' },
    section('Diagnoses', dxList(data.diagnoses, isActive, reload)),
    section('Latest vitals', data.vitals[0]
      ? h('div', null, h('p', null, vitalsSummary(data.vitals[0])), news2Badge(data.vitals[0].news2), h('p', { class: 'muted small' }, fmtDateTime(data.vitals[0].recorded_at)))
      : h('p', { class: 'muted' }, 'None recorded')),
    section('Active medications', activeMeds(data.prescriptions))) : null;

  mount(el, patientBanner(p, e), toolbar,
    !isActive ? h('p', { class: 'alert' }, 'This encounter is closed and read-only. Start a new visit from the patient chart to add entries.') : null,
    h('div', { class: side ? 'enc-layout' : '' }, h('div', { class: 'enc-main' }, t ? t.el : h('p', { class: 'muted' }, 'You do not have access to clinical details.')), side));
}

// ================= Notes =================
function notesPanel(notes, e, isActive, reload) {
  const defs = state.meta.note_defs;
  let filter = 'all';
  const list = h('div', { class: 'notes' });
  const filters = [['all', 'All'], ['doctor', 'Doctors'], ['nursing', 'Nursing'], ['theatre', 'Theatre & procedures']];
  const bar = h('div', { class: 'chips' });
  const render = () => {
    clear(bar).append(...filters.map(([k, label]) => h('button', { class: `chip${filter === k ? ' active' : ''}`, onclick: () => { filter = k; render(); } }, label)));
    const shown = notes.filter((n) => filter === 'all'
      || (filter === 'doctor' && (n.kind === 'clerking' || n.kind === 'progress'))
      || (filter === 'nursing' && n.kind === 'nursing')
      || (filter === 'theatre' && (n.kind === 'theatre' || n.kind === 'procedure')));
    clear(list).append(...(shown.length ? shown.map((n) => noteCard(n, defs[n.kind], e, isActive, reload)) : [h('p', { class: 'muted empty' }, 'No notes yet.')]));
  };
  render();
  return h('div', null, bar, list);
}

function noteCard(n, def, e, isActive, reload) {
  const fields = def ? def.sections.flatMap((s) => s.fields.map((f) => ({ ...f, heading: s.heading }))) : [];
  const body = h('div', { class: 'note-body' });
  let lastHeading = null;
  for (const f of fields) {
    const v = n.data[f.key];
    if (v === undefined || v === null || v === '') continue;
    if (f.heading && f.heading !== lastHeading && def.sections.length > 1) { body.append(h('h4', null, f.heading)); lastHeading = f.heading; }
    body.append(h('div', { class: 'note-field' }, h('span', { class: 'note-label' }, f.label), h('div', { class: 'prewrap' }, String(v))));
  }
  const canAmend = isActive && !n.superseded_by && (n.author_id === state.me.id || state.me.role === 'admin') && can(def.perm);
  return h('article', { class: `note kind-${n.kind}${n.superseded_by ? ' superseded' : ''}` },
    h('header', null,
      h('strong', null, def ? def.label : n.kind),
      n.amends_id ? h('span', { class: 'badge' }, 'Amended version') : null,
      n.superseded_by ? h('span', { class: 'badge warn' }, 'Superseded – see amended version') : null,
      h('span', { class: 'muted small' }, `${fmtDateTime(n.created_at)} · ${[n.author_title, n.author].filter(Boolean).join(' ')} (${n.author_role})`),
      canAmend ? h('button', { class: 'btn small', onclick: () => noteDialog(e, n.kind, n, reload) }, 'Amend') : null),
    n.superseded_by ? h('details', null, h('summary', null, 'Show original text'), body) : body);
}

function noteDialog(e, kind, original, reload) {
  const def = state.meta.note_defs[kind];
  const fields = def.sections.flatMap((s) => [{ heading: s.heading }, ...s.fields.map((f) => ({ ...f, span: f.type === 'textarea' ? 'full' : 'third' }))]);
  const form = buildForm(fields, original ? original.data : {});
  const draftKey = `hmis-draft-${e.id}-${kind}-${original ? original.id : 'new'}`;
  // Keep an unsent draft in this browser in case the tab is closed accidentally.
  try {
    const saved = !original && JSON.parse(localStorage.getItem(draftKey) || 'null');
    if (saved) for (const [k, v] of Object.entries(saved)) if (form.inputs[k] && v) form.inputs[k].value = v;
  } catch { /* storage unavailable */ }
  form.el.addEventListener('input', debounce(() => { try { localStorage.setItem(draftKey, JSON.stringify(form.values())); } catch { /* ignore */ } }, 500));
  modal({
    title: original ? `Amend ${def.label.toLowerCase()}` : def.label, wide: true,
    body: h('div', null, original ? h('p', { class: 'alert' }, 'The original note is kept in the record and marked as superseded.') : null, form.el),
    actions: [{ label: 'Cancel' }, { label: 'Save & sign', primary: true, onClick: async () => {
      if (!form.validate()) return false;
      await api(`/api/encounters/${e.id}/notes`, { method: 'POST', body: { kind, data: form.values(), amends_id: original ? original.id : undefined } });
      try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
      toast('Note saved');
      lastTab = 'notes';
      reload();
    } }],
  });
}

// ================= Vitals =================
function vitalsPanel(vitals) {
  const bmi = (v) => (v.weight && v.height ? (v.weight / ((v.height / 100) ** 2)).toFixed(1) : '');
  return section('Vital signs', table([
    { label: 'Time', render: (v) => fmtDateTime(v.recorded_at) },
    { label: 'Temp °C', key: 'temp' },
    { label: 'Pulse', key: 'pulse' },
    { label: 'RR', key: 'resp_rate' },
    { label: 'BP', render: (v) => (v.bp_sys ? `${v.bp_sys}/${v.bp_dia ?? ''}` : '') },
    { label: 'SpO₂ %', render: (v) => (v.spo2 !== null ? `${v.spo2}${v.on_oxygen ? ' (O₂)' : ''}` : '') },
    { label: 'AVPU', key: 'avpu' },
    { label: 'Wt kg', key: 'weight' },
    { label: 'Ht cm', key: 'height' },
    { label: 'BMI', render: bmi },
    { label: 'MUAC', key: 'muac' },
    { label: 'Gluc', key: 'glucose' },
    { label: 'Pain', key: 'pain' },
    { label: 'NEWS2', render: (v) => news2Badge(v.news2) || '' },
    { label: 'By', key: 'recorder' },
    { label: 'Comment', key: 'comment' },
  ], vitals, { empty: 'No vitals recorded for this visit.' }));
}

function vitalsDialog(e, p, reload) {
  const form = buildForm([
    { key: 'temp', label: 'Temperature (°C)', type: 'number' },
    { key: 'pulse', label: 'Pulse (bpm)', type: 'number' },
    { key: 'resp_rate', label: 'Respiratory rate (/min)', type: 'number' },
    { key: 'bp_sys', label: 'BP systolic (mmHg)', type: 'number' },
    { key: 'bp_dia', label: 'BP diastolic (mmHg)', type: 'number' },
    { key: 'spo2', label: 'SpO₂ (%)', type: 'number' },
    { key: 'on_oxygen', label: 'On supplemental oxygen', type: 'checkbox' },
    { key: 'avpu', label: 'Consciousness (AVPU)', type: 'select', options: [['A', 'Alert'], ['C', 'New confusion'], ['V', 'Voice'], ['P', 'Pain'], ['U', 'Unresponsive']] },
    { key: 'pain', label: 'Pain score (0–10)', type: 'number' },
    { key: 'weight', label: 'Weight (kg)', type: 'number' },
    { key: 'height', label: 'Height (cm)', type: 'number' },
    { key: 'muac', label: 'MUAC (cm)', type: 'number' },
    { key: 'glucose', label: 'Blood glucose (mmol/L)', type: 'number' },
    { key: 'comment', label: 'Comment', span: 'full' },
  ], { avpu: 'A' });
  const preview = h('p', { class: 'muted small' }, 'NEWS2 is calculated for adults when RR, SpO₂, BP, pulse, temperature and AVPU are entered.');
  modal({
    title: `Record vital signs – ${p.first_name} ${p.last_name}`, wide: true,
    body: h('div', null, form.el, preview),
    actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async () => {
      const r = await api(`/api/encounters/${e.id}/vitals`, { method: 'POST', body: form.values() });
      if (r.news2 !== null && r.news2 >= 5) toast(`NEWS2 = ${r.news2}: ${r.news2 >= 7 ? 'HIGH – emergency review needed' : 'MEDIUM – urgent review by clinician'}`, 'error');
      else toast('Vitals saved');
      lastTab = 'vitals';
      reload();
    } }],
  });
}

// ================= Diagnoses =================
function dxList(list, isActive, reload) {
  const shown = list.filter((d) => d.status !== 'error');
  if (!shown.length) return h('p', { class: 'muted' }, 'No diagnosis yet');
  return h('ul', { class: 'dx-list' }, shown.map((d) => h('li', { class: d.status === 'resolved' ? 'resolved' : '' },
    h('div', null,
      d.rank === 'primary' ? h('span', { class: 'badge primary' }, 'Primary') : null,
      d.icd10_code ? h('code', null, d.icd10_code) : h('span', { class: 'badge' }, 'Uncoded'), ' ',
      h('span', null, d.description)),
    h('div', { class: 'muted small' }, [d.certainty, d.status !== 'active' ? d.status : null, d.gdrg_code ? `G-DRG ${d.gdrg_code}` : null, d.author].filter(Boolean).join(' · ')),
    d.note ? h('div', { class: 'small' }, d.note) : null,
    isActive && can('dx.write') ? h('div', { class: 'dx-actions' },
      d.rank !== 'primary' ? h('button', { class: 'linklike small', onclick: () => patchDx(d, { rank: 'primary' }, reload) }, 'Primary') : null,
      d.certainty !== 'confirmed' ? h('button', { class: 'linklike small', onclick: () => patchDx(d, { certainty: 'confirmed' }, reload) }, 'Confirm') : null,
      d.status === 'active' ? h('button', { class: 'linklike small', onclick: () => patchDx(d, { status: 'resolved' }, reload) }, 'Resolved') : null,
      h('button', { class: 'linklike small danger', onclick: async () => { if (await confirmDialog('Mark this diagnosis as entered in error?', { danger: true, okLabel: 'Entered in error' })) patchDx(d, { status: 'error' }, reload); } }, 'Error')) : null)));
}

async function patchDx(d, body, reload) {
  try { await api(`/api/diagnoses/${d.id}`, { method: 'PATCH', body }); reload(); } catch (err) { toast(err.message, 'error'); }
}

function diagnosisDialog(e, reload) {
  let chosen = null;
  const search = h('input', { type: 'search', placeholder: 'Search ICD-10 by code or words, e.g. "malaria", "I10"', 'aria-label': 'Search ICD-10' });
  const results = h('ul', { class: 'icd-results' });
  const chosenBox = h('div', { class: 'chosen' });
  const form = buildForm([
    { key: 'description', label: 'Diagnosis description', span: 'full', help: 'Filled from ICD-10; you may refine it, or type a free-text diagnosis if no code fits.' },
    { key: 'rank', label: 'Rank', type: 'select', options: [['primary', 'Primary'], ['secondary', 'Secondary']], span: 'third' },
    { key: 'certainty', label: 'Certainty', type: 'select', options: [['provisional', 'Provisional'], ['confirmed', 'Confirmed'], ['differential', 'Differential']], span: 'third' },
    { key: 'gdrg_code', label: 'G-DRG code (NHIS)', span: 'third' },
    { key: 'note', label: 'Note', span: 'full', type: 'textarea', rows: 2 },
  ], { rank: 'primary', certainty: 'provisional' });
  const pick = (c) => {
    chosen = c;
    form.inputs.description.value = c.title;
    form.inputs.gdrg_code.value = c.gdrg_code || '';
    clear(chosenBox).append(h('span', null, 'Selected: ', h('code', null, c.code), ` ${c.title}`), h('button', { class: 'linklike small', onclick: () => { chosen = null; clear(chosenBox); } }, 'clear'));
  };
  const load = async () => {
    const rows = await api(`/api/icd10?q=${encodeURIComponent(search.value.trim())}`);
    clear(results).append(...rows.map((c) => h('li', null, h('button', { type: 'button', onclick: () => pick(c) }, h('code', null, c.code), ` ${c.title}`, c.gdrg_code ? h('span', { class: 'muted small' }, ` · G-DRG ${c.gdrg_code}`) : null))));
    if (!rows.length) results.append(h('li', { class: 'muted' }, 'No match – type a free-text diagnosis below, or ask the administrator to import the full ICD-10 list.'));
  };
  search.addEventListener('input', debounce(load, 200));
  load();
  modal({
    title: 'Add diagnosis (ICD-10)', wide: true,
    body: h('div', null, search, results, chosenBox, form.el),
    actions: [{ label: 'Cancel' }, { label: 'Add diagnosis', primary: true, onClick: async () => {
      const v = form.values();
      if (!v.description && !chosen) { toast('Choose an ICD-10 code or enter a description', 'error'); return false; }
      await api(`/api/encounters/${e.id}/diagnoses`, { method: 'POST', body: { ...v, icd10_code: chosen ? chosen.code : null } });
      toast('Diagnosis added');
      reload();
    } }],
  });
  search.focus();
}

// ================= Prescriptions =================
const ROUTES = ['PO (oral)', 'IV', 'IM', 'SC', 'PR', 'PV', 'SL', 'Topical', 'Inhaled', 'Nebulised', 'Eye drops', 'Ear drops', 'Nasal'];
const FREQS = ['Stat', 'OD (once daily)', 'BD (12-hourly)', 'TDS (8-hourly)', 'QDS (6-hourly)', 'Nocte', 'Mane', 'PRN (as needed)', '4-hourly', 'Weekly'];

function activeMeds(rx) {
  const active = rx.filter((r) => r.status === 'active');
  if (!active.length) return h('p', { class: 'muted' }, 'None');
  return h('ul', { class: 'plain' }, active.map((r) => h('li', null, h('b', null, r.drug), ` ${[r.dose, r.route, r.frequency, r.duration].filter(Boolean).join(' · ')}`)));
}

function rxPanel(rx, isActive, reload) {
  return section('Prescriptions / medication orders', table([
    { label: 'Ordered', render: (r) => fmtDateTime(r.created_at) },
    { label: 'Drug', render: (r) => h('b', null, r.drug) },
    { label: 'Dose', key: 'dose' }, { label: 'Route', key: 'route' }, { label: 'Frequency', key: 'frequency' }, { label: 'Duration', key: 'duration' },
    { label: 'Instructions', key: 'instructions' },
    { label: 'Prescriber', key: 'prescriber' },
    { label: 'Status', render: (r) => h('span', { class: `badge status-${r.status}` }, r.status) },
    { label: '', render: (r) => (isActive && r.status === 'active' && can('rx.write') ? h('button', { class: 'btn small', onclick: async () => {
      if (!(await confirmDialog(`Stop ${r.drug}?`, { okLabel: 'Stop' }))) return;
      await api(`/api/prescriptions/${r.id}`, { method: 'PATCH', body: { status: 'stopped' } });
      lastTab = 'meds'; reload();
    } }, 'Stop') : '') },
  ], rx, { empty: 'No prescriptions.' }));
}

function prescriptionDialog(e, reload) {
  const form = buildForm([
    { key: 'drug', label: 'Drug (generic name & strength)', required: true, span: 'full', placeholder: 'e.g. Artemether-lumefantrine 20/120 mg', list: 'drug-list' },
    { key: 'dose', label: 'Dose', placeholder: 'e.g. 4 tablets' },
    { key: 'route', label: 'Route', type: 'select', options: ROUTES },
    { key: 'frequency', label: 'Frequency', type: 'select', options: FREQS },
    { key: 'duration', label: 'Duration', placeholder: 'e.g. 3 days' },
    { key: 'instructions', label: 'Instructions', span: 'full', placeholder: 'e.g. take with fatty food' },
  ], { route: 'PO (oral)' });
  const datalist = h('datalist', { id: 'drug-list' }, COMMON_DRUGS.map((d) => h('option', { value: d })));
  let added = 0;
  const save = async () => {
    if (!form.validate()) return false;
    await api(`/api/encounters/${e.id}/prescriptions`, { method: 'POST', body: form.values() });
    added++;
    return true;
  };
  modal({
    title: 'Prescribe', wide: true, body: h('div', null, form.el, datalist),
    onClose: () => { if (added) { lastTab = 'meds'; reload(); } },
    actions: [
      { label: 'Cancel' },
      { label: 'Save & add another', onClick: async () => {
        if (await save()) { toast('Prescription added'); for (const k of ['drug', 'dose', 'duration', 'instructions']) form.inputs[k].value = ''; form.inputs.drug.focus(); }
        return false;
      } },
      { label: 'Save', primary: true, onClick: async () => { if (!(await save())) return false; toast('Prescription added'); } },
    ],
  });
}

// Ghana Essential Medicines List – common items for quick entry (free text is always allowed).
const COMMON_DRUGS = [
  'Artemether-lumefantrine 20/120 mg tablet', 'Artesunate injection 60 mg', 'Amodiaquine-artesunate tablet', 'Paracetamol 500 mg tablet',
  'Paracetamol 120 mg/5 ml syrup', 'Ibuprofen 400 mg tablet', 'Diclofenac 50 mg tablet', 'Amoxicillin 500 mg capsule',
  'Amoxicillin-clavulanate 625 mg tablet', 'Ceftriaxone 1 g injection', 'Ciprofloxacin 500 mg tablet', 'Metronidazole 400 mg tablet',
  'Metronidazole 500 mg/100 ml infusion', 'Azithromycin 500 mg tablet', 'Doxycycline 100 mg capsule', 'Cotrimoxazole 960 mg tablet',
  'Gentamicin 80 mg injection', 'Flucloxacillin 500 mg capsule', 'Nifedipine 20 mg SR tablet', 'Amlodipine 10 mg tablet',
  'Lisinopril 10 mg tablet', 'Hydrochlorothiazide 25 mg tablet', 'Methyldopa 250 mg tablet', 'Labetalol injection',
  'Magnesium sulphate 50% injection', 'Oxytocin 10 IU injection', 'Misoprostol 200 mcg tablet', 'Metformin 500 mg tablet',
  'Glibenclamide 5 mg tablet', 'Soluble insulin', 'Omeprazole 20 mg capsule', 'Magnesium trisilicate tablet', 'ORS sachet',
  'Zinc 20 mg tablet', 'Ferrous sulphate 200 mg tablet', 'Folic acid 5 mg tablet', 'Albendazole 400 mg tablet', 'Salbutamol inhaler 100 mcg',
  'Prednisolone 5 mg tablet', 'Hydrocortisone 100 mg injection', 'Furosemide 40 mg tablet', 'Furosemide 20 mg injection',
  'Normal saline 0.9% 500 ml', "Ringer's lactate 500 ml", 'Dextrose 5% 500 ml', 'Dextrose 50% injection', 'Tramadol 50 mg capsule',
  'Morphine 10 mg injection', 'Pethidine 100 mg injection', 'Diazepam 10 mg injection', 'Phenobarbital 30 mg tablet', 'Carbamazepine 200 mg tablet',
  'Chlorpheniramine 4 mg tablet', 'Promethazine 25 mg injection', 'Metoclopramide 10 mg injection', 'Hyoscine butylbromide 20 mg injection',
  'Tetanus toxoid injection', 'Anti-snake venom', 'Enoxaparin 40 mg injection', 'Vitamin K 1 mg injection', 'Tenofovir/lamivudine/dolutegravir (TLD) tablet',
];

// ================= Labs =================
function labsPanel(labs, reload) {
  return section('Laboratory requests & results', labs.length ? h('div', null, labs.map((l) => labOrderCard(l,
    (l.status === 'ordered' || l.status === 'collected') && (can('lab.result') || l.ordered_by === state.me.id)
      ? h('button', { class: 'btn small', onclick: async () => {
        const reason = await promptDialog('Cancel lab request', 'Reason');
        if (!reason) return;
        try { await api(`/api/labs/${l.id}/cancel`, { method: 'POST', body: { reason } }); lastTab = 'labs'; reload(); } catch (err) { toast(err.message, 'error'); }
      } }, 'Cancel') : null))) : h('p', { class: 'muted' }, 'No lab requests for this visit.'));
}

function labOrderDialog(e, reload) {
  const tests = state.meta.lab_tests;
  const filter = h('input', { type: 'search', placeholder: 'Filter tests…', 'aria-label': 'Filter tests' });
  const boxes = new Map();
  const list = h('div', { class: 'test-picker' });
  const sections = [...new Set(tests.map((t) => t.section || 'Other'))];
  for (const s of sections) {
    const group = h('fieldset', null, h('legend', null, s));
    for (const t of tests.filter((x) => (x.section || 'Other') === s)) {
      const cb = h('input', { type: 'checkbox', value: t.id });
      boxes.set(t.id, cb);
      group.append(h('label', { class: 'check', 'data-name': `${t.name} ${t.code}`.toLowerCase() }, cb, h('span', null, t.name, h('small', { class: 'muted' }, ` ${t.specimen || ''}`))));
    }
    list.append(group);
  }
  filter.addEventListener('input', () => {
    const q = filter.value.toLowerCase();
    for (const l of list.querySelectorAll('label.check')) l.hidden = q && !l.dataset.name.includes(q);
  });
  const form = buildForm([
    { key: 'priority', label: 'Priority', type: 'select', options: [['routine', 'Routine'], ['urgent', 'Urgent'], ['stat', 'STAT (immediate)']], span: 'third' },
    { key: 'clinical_info', label: 'Clinical information / question', span: 'full', type: 'textarea', rows: 2 },
  ], { priority: 'routine' });
  modal({
    title: 'Request laboratory investigations', wide: true,
    body: h('div', null, filter, list, form.el),
    actions: [{ label: 'Cancel' }, { label: 'Send request', primary: true, onClick: async () => {
      const ids = [...boxes].filter(([, cb]) => cb.checked).map(([tid]) => tid);
      if (!ids.length) { toast('Select at least one test', 'error'); return false; }
      await api(`/api/encounters/${e.id}/labs`, { method: 'POST', body: { ...form.values(), test_ids: ids } });
      toast(`${ids.length} test${ids.length > 1 ? 's' : ''} requested`);
      lastTab = 'labs';
      reload();
    } }],
  });
}

// ================= Admission & discharge =================
function admitDialog(e, reload) {
  const m = state.meta;
  const form = buildForm([
    { key: 'ward_id', label: 'Ward', type: 'select', options: m.wards.map((w) => [w.id, `${w.name} (${w.beds} beds)`]), required: true, span: 'half' },
    { key: 'bed', label: 'Bed', span: 'half' },
    { key: 'attending_id', label: 'Consultant', type: 'select', options: m.doctors.map((d) => [d.id, [d.title, d.full_name].filter(Boolean).join(' ')]), span: 'half' },
  ], { ward_id: e.ward_id, bed: e.bed, attending_id: e.attending_id });
  modal({
    title: e.status === 'admitted' ? 'Transfer ward / bed' : 'Admit patient',
    body: form.el,
    actions: [{ label: 'Cancel' }, { label: e.status === 'admitted' ? 'Transfer' : 'Admit', primary: true, onClick: async () => {
      if (!form.validate()) return false;
      await api(`/api/encounters/${e.id}/admit`, { method: 'POST', body: form.values() });
      toast(e.status === 'admitted' ? 'Patient transferred' : 'Patient admitted');
      reload();
    } }],
  });
}

function closeDialog(e, data, reload) {
  const isIpd = e.status === 'admitted';
  const dx = (data.diagnoses || []).filter((d) => d.status !== 'error');
  const meds = (data.prescriptions || []).filter((r) => r.status === 'active');
  const template = [
    `Diagnosis: ${dx.map((d) => `${d.description}${d.icd10_code ? ` (${d.icd10_code})` : ''}`).join('; ') || ''}`,
    isIpd ? 'Summary of hospital course:\n' : 'Management:\n',
    `Medications on discharge: ${meds.map((r) => [r.drug, r.dose, r.frequency, r.duration].filter(Boolean).join(' ')).join('; ') || 'None'}`,
    'Condition at discharge: ',
  ].join('\n');
  const form = buildForm([
    { key: 'outcome', label: 'Outcome', type: 'select', options: state.meta.outcomes, required: true, span: 'half' },
    { key: 'discharge_summary', label: isIpd ? 'Discharge summary' : 'Visit summary', type: 'textarea', rows: 10 },
    { key: 'follow_up', label: 'Follow-up / review date / referral destination', span: 'full' },
  ], { outcome: isIpd ? 'Discharged' : 'Treated and sent home', discharge_summary: template });
  modal({
    title: isIpd ? 'Discharge patient' : 'Close visit', wide: true,
    body: h('div', null, !dx.length ? h('p', { class: 'alert warn' }, 'No diagnosis has been recorded. NHIS claims require at least one diagnosis.') : null, form.el),
    actions: [{ label: 'Cancel' }, { label: isIpd ? 'Discharge' : 'Close visit', danger: true, onClick: async () => {
      if (!form.validate()) return false;
      await api(`/api/encounters/${e.id}/close`, { method: 'POST', body: form.values() });
      toast(isIpd ? 'Patient discharged' : 'Visit closed');
      reload();
    } }],
  });
}

// ================= Printable summary (discharge / referral / record copy) =================
export async function encounterPrintView(el, id) {
  const data = await api(`/api/encounters/${id}`);
  const { encounter: e, patient: p } = data;
  const defs = state.meta.note_defs;
  const kv = (k, v) => (v ? h('div', null, h('b', null, `${k}: `), v) : null);
  mount(el, 
    h('div', { class: 'print-actions no-print' }, btn('Print', () => window.print(), 'primary'), btn('Close', () => window.close())),
    h('header', { class: 'print-head' }, h('h1', null, state.meta.hospital_name), h('h2', null, e.status === 'discharged' ? 'Discharge summary' : 'Clinical summary')),
    h('div', { class: 'print-grid' },
      kv('Patient', fullName(p)), kv('Sex / age', sexAge(p)), kv('Folder no.', p.folder_no), kv('DOB', fmtDate(p.dob)),
      kv('NHIS no.', p.nhis_no), kv('Ghana Card', p.ghana_card), kv('Allergies', p.allergies || 'None known'),
      kv('Visit', `${e.type} · ${e.department || ''}`), kv('Ward', e.ward_name ? `${e.ward_name} ${e.bed || ''}` : null),
      kv('Start', fmtDateTime(e.start_at)), kv('Admitted', fmtDateTime(e.admitted_at)), kv('End', fmtDateTime(e.end_at)), kv('Outcome', e.outcome)),
    data.diagnoses ? h('section', null, h('h3', null, 'Diagnoses'), h('ul', null, data.diagnoses.filter((d) => d.status !== 'error').map((d) =>
      h('li', null, `${d.icd10_code ? d.icd10_code + ' – ' : ''}${d.description} (${d.rank}, ${d.certainty}${d.gdrg_code ? `, G-DRG ${d.gdrg_code}` : ''})`)))) : null,
    e.discharge_summary ? h('section', null, h('h3', null, 'Summary'), h('div', { class: 'prewrap' }, e.discharge_summary), e.follow_up ? kv('Follow-up', e.follow_up) : null) : null,
    data.prescriptions && data.prescriptions.length ? h('section', null, h('h3', null, 'Medications'), h('ul', null, data.prescriptions.map((r) =>
      h('li', null, `${r.drug} ${[r.dose, r.route, r.frequency, r.duration].filter(Boolean).join(' ')} – ${r.status}`)))) : null,
    data.labs && data.labs.some((l) => l.results) ? h('section', null, h('h3', null, 'Laboratory results'),
      data.labs.filter((l) => l.results).map((l) => h('div', null, h('h4', null, `${l.test_name} – ${fmtDateTime(l.resulted_at)}`), labResultTable(l.results)))) : null,
    data.notes ? h('section', null, h('h3', null, 'Clinical notes'), data.notes.filter((n) => !n.superseded_by).slice().reverse().map((n) => {
      const def = defs[n.kind];
      return h('div', { class: 'print-note' }, h('h4', null, `${def ? def.label : n.kind} – ${fmtDateTime(n.created_at)} – ${n.author}`),
        (def ? def.sections.flatMap((s) => s.fields) : []).filter((f) => n.data[f.key]).map((f) => h('div', null, h('b', null, `${f.label}: `), h('span', { class: 'prewrap' }, String(n.data[f.key])))));
    })) : null,
    h('footer', { class: 'print-foot' }, `Printed ${fmtDateTime(new Date().toISOString())} by ${state.me.full_name}. Confidential medical record.`));
}
