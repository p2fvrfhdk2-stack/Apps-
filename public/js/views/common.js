import { h, fullName, sexAge, nhisStatus, fmtDate, fmtDateTime, api, modal, toast, state, buildForm, today } from '../lib.js';

export function patientBanner(p, e) {
  const nhis = nhisStatus(p);
  return h('div', { class: 'banner' },
    h('div', { class: 'banner-main' },
      h('a', { href: `#/patients/${p.id}`, class: 'banner-name' }, fullName(p)),
      h('span', { class: 'banner-meta' },
        h('span', null, sexAge(p)),
        p.dob ? h('span', null, `DOB ${fmtDate(p.dob)}${p.dob_estimated ? ' (est.)' : ''}`) : null,
        h('span', null, 'Folder ', h('b', null, p.folder_no)),
        p.phone ? h('span', null, p.phone) : null,
        nhis ? h('span', { class: `badge ${nhis.ok ? 'ok' : 'warn'}` }, nhis.label) : h('span', { class: 'badge' }, 'No NHIS'),
        p.blood_group ? h('span', { class: 'badge' }, p.blood_group) : null)),
    h('div', { class: `allergy ${p.allergies ? 'has' : ''}` }, p.allergies ? `⚠ Allergies: ${p.allergies}` : 'No known allergies recorded'),
    e ? h('div', { class: 'banner-enc' },
      h('span', { class: `badge type-${e.type.toLowerCase()}` }, e.type === 'IPD' ? 'Inpatient' : e.type === 'EMERGENCY' ? 'Emergency' : 'Outpatient'),
      h('span', { class: `badge status-${e.status}` }, e.status),
      e.department ? h('span', null, e.department) : null,
      e.ward_name ? h('span', null, `${e.ward_name}${e.bed ? ` · Bed ${e.bed}` : ''}`) : null,
      h('span', null, `Started ${fmtDateTime(e.start_at)}`),
      e.admitted_at ? h('span', null, `Admitted ${fmtDateTime(e.admitted_at)}`) : null,
      e.end_at ? h('span', null, `Ended ${fmtDateTime(e.end_at)}${e.outcome ? ` – ${e.outcome}` : ''}`) : null,
      e.payer ? h('span', null, e.payer) : null,
      e.attending_name ? h('span', null, `Consultant: ${e.attending_name}`) : null) : null);
}

// Upload a scanned document/photo for a patient (optionally linked to an encounter).
export function uploadDocumentDialog(patientId, encounterId, onDone) {
  const form = buildForm([
    { key: 'title', label: 'Title', required: true, span: 'full', placeholder: 'e.g. Old folder 2019–2023, Referral from Korle Bu' },
    { key: 'category', label: 'Category', type: 'select', options: state.meta.doc_categories, required: true, span: 'half' },
    { key: 'doc_date', label: 'Document date', type: 'date', span: 'half', },
  ], { doc_date: today() });
  const file = h('input', { type: 'file', accept: 'application/pdf,image/jpeg,image/png,image/webp,image/tiff', capture: 'environment' });
  modal({
    title: 'Upload scanned document',
    body: h('div', null, form.el, h('label', { class: 'field full' }, h('span', null, 'File (PDF, JPEG, PNG, WEBP, TIFF – max 25 MB)'), file),
      h('p', { class: 'muted small' }, 'On a phone or tablet you can photograph the document directly.')),
    actions: [{ label: 'Cancel' }, { label: 'Upload', primary: true, onClick: async () => {
      if (!form.validate()) return false;
      const f = file.files[0];
      if (!f) { toast('Choose a file', 'error'); return false; }
      if (f.size > 25 * 1024 * 1024) { toast('File is larger than 25 MB', 'error'); return false; }
      const v = form.values();
      const qs = new URLSearchParams({ title: v.title, category: v.category, doc_date: v.doc_date });
      if (encounterId) qs.set('encounter_id', encounterId);
      await api(`/api/patients/${patientId}/documents?${qs}`, { method: 'POST', raw: f, contentType: f.type });
      toast('Document uploaded');
      onDone && onDone();
    } }],
  });
}

export function viewDocument(d) {
  const src = `/api/documents/${d.id}/file`;
  const viewer = d.mime === 'application/pdf'
    ? h('iframe', { src, class: 'doc-frame', title: d.title })
    : d.mime === 'image/tiff'
      ? h('p', null, 'TIFF files cannot be shown in most browsers. ', h('a', { href: src, download: '' }, 'Download the file'))
      : h('img', { src, alt: d.title, class: 'doc-img' });
  modal({
    title: d.title, wide: true,
    body: h('div', null, h('p', { class: 'muted small' }, `${d.category} · ${fmtDate(d.doc_date || d.uploaded_at)} · uploaded by ${d.uploaded_by_name}`, ' · ',
      h('a', { href: src, target: '_blank', rel: 'noopener' }, 'Open in new tab')), viewer),
  });
}

export function documentsList(docs, empty = 'No documents') {
  if (!docs || !docs.length) return h('p', { class: 'muted empty' }, empty);
  return h('ul', { class: 'doc-list' }, docs.map((d) => h('li', null,
    h('button', { class: 'linklike', onclick: () => viewDocument(d) }, h('span', { class: 'doc-ico', 'aria-hidden': 'true' }, d.mime === 'application/pdf' ? 'PDF' : 'IMG'), d.title),
    h('span', { class: 'muted small' }, ` ${d.category} · ${fmtDate(d.doc_date || d.uploaded_at)} · ${(d.size / 1024).toFixed(0)} KB`))));
}

export function labResultTable(results) {
  return h('table', { class: 'results' },
    h('thead', null, h('tr', null, h('th', null, 'Test'), h('th', null, 'Result'), h('th', null, 'Unit'), h('th', null, 'Reference'), h('th', null, ''))),
    h('tbody', null, results.map((r) => h('tr', { class: r.flag ? 'abn' : '' },
      h('td', null, r.name), h('td', { class: 'val' }, r.value), h('td', null, r.unit), h('td', null, r.ref),
      h('td', null, r.flag ? h('span', { class: 'flag' }, r.flag === 'H' ? '▲ High' : r.flag === 'L' ? '▼ Low' : 'Abnormal') : '')))));
}

export function labOrderCard(l, actions) {
  return h('div', { class: `lab-order status-${l.status}` },
    h('div', { class: 'lab-head' },
      h('strong', null, l.test_name),
      l.priority !== 'routine' ? h('span', { class: 'badge warn' }, l.priority.toUpperCase()) : null,
      h('span', { class: `badge status-${l.status}` }, l.status),
      h('span', { class: 'muted small' }, `Ordered ${fmtDateTime(l.ordered_at)} by ${l.ordered_by_name}`),
      actions ? h('span', { class: 'lab-actions' }, actions) : null),
    l.clinical_info ? h('div', { class: 'muted small' }, `Clinical info: ${l.clinical_info}`) : null,
    l.results ? labResultTable(l.results) : null,
    l.comment ? h('p', { class: 'small' }, h('b', null, 'Comment: '), l.comment) : null,
    l.resulted_at ? h('div', { class: 'muted small' }, `Resulted ${fmtDateTime(l.resulted_at)} by ${l.resulted_by_name}${l.sample_id ? ` · Sample ${l.sample_id}` : ''}`) : null,
    l.cancel_reason ? h('div', { class: 'muted small' }, `Cancelled: ${l.cancel_reason}`) : null);
}

export const vitalsSummary = (v) => {
  if (!v) return 'No vitals recorded';
  const parts = [];
  if (v.temp !== null) parts.push(`T ${v.temp}°C`);
  if (v.pulse !== null) parts.push(`P ${v.pulse}`);
  if (v.resp_rate !== null) parts.push(`RR ${v.resp_rate}`);
  if (v.bp_sys !== null) parts.push(`BP ${v.bp_sys}/${v.bp_dia ?? '?'}`);
  if (v.spo2 !== null) parts.push(`SpO₂ ${v.spo2}%${v.on_oxygen ? ' (O₂)' : ''}`);
  if (v.weight !== null) parts.push(`Wt ${v.weight}kg`);
  if (v.glucose !== null) parts.push(`Gluc ${v.glucose}`);
  return parts.join(' · ');
};
