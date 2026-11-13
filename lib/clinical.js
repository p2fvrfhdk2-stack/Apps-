// Clinical reference definitions shared with the browser through /api/meta.

export const REGIONS = [
  'Ahafo', 'Ashanti', 'Bono', 'Bono East', 'Central', 'Eastern', 'Greater Accra', 'North East',
  'Northern', 'Oti', 'Savannah', 'Upper East', 'Upper West', 'Volta', 'Western', 'Western North',
];

export const DEPARTMENTS = [
  'General OPD', 'Internal Medicine', 'Surgery', 'Obstetrics & Gynaecology', 'Paediatrics',
  'Emergency', 'Eye', 'ENT', 'Dental', 'Orthopaedics', 'Psychiatry', 'Antenatal Clinic',
  'Diabetes Clinic', 'Hypertension Clinic', 'HIV/ART Clinic', 'Physiotherapy',
];

export const PAYERS = ['NHIS', 'Cash', 'Private insurance', 'Corporate'];
export const OUTCOMES = ['Discharged', 'Referred', 'Discharged against medical advice (DAMA)', 'Absconded', 'Died', 'Treated and sent home'];
export const DOC_CATEGORIES = [
  'Scanned old folder', 'Referral letter', 'Lab report (external)', 'Imaging / radiology report',
  'Consent form', 'Theatre / anaesthesia record', 'Discharge summary', 'NHIS / insurance', 'ID document', 'Other',
];

const t = (key, label, extra = {}) => ({ key, label, type: 'textarea', ...extra });

// Note templates. Each section is free text; the server rejects unknown keys.
export const NOTE_DEFS = {
  clerking: {
    label: 'Clerking (history & examination)',
    perm: 'clin.write',
    sections: [
      { heading: 'History', fields: [
        t('presenting_complaint', 'Presenting complaint(s)', { rows: 2, required: true }),
        t('hpc', 'History of presenting complaint', { rows: 5 }),
        t('ros', 'Review of systems', { rows: 3 }),
        t('pmh', 'Past medical history (HTN, DM, SCD, asthma, TB, HIV…)'),
        t('psh', 'Past surgical history / transfusions'),
        t('obs_gyn', 'Obstetric & gynaecological history (G P, LMP, contraception)'),
        t('drug_history', 'Drug history (incl. herbal medicines)'),
        t('allergies', 'Allergies', { rows: 1 }),
        t('family_history', 'Family history'),
        t('social_history', 'Social history (occupation, alcohol, smoking, living situation)'),
      ] },
      { heading: 'Examination', fields: [
        t('general_exam', 'General (pallor, jaundice, cyanosis, dehydration, oedema, lymph nodes)'),
        t('cvs', 'Cardiovascular'),
        t('resp', 'Respiratory'),
        t('abdomen', 'Abdomen'),
        t('cns', 'Central nervous system'),
        t('msk', 'Musculoskeletal / skin'),
        t('other_exam', 'Other (ENT, eye, breast, PV/PR, obstetric)'),
      ] },
      { heading: 'Assessment & plan', fields: [
        t('impression', 'Impression / differentials', { rows: 2 }),
        t('plan', "Doctor's plan (investigations, treatment, monitoring)", { rows: 5 }),
      ] },
    ],
  },
  progress: {
    label: "Doctor's progress note / plan (SOAP)",
    perm: 'clin.write',
    sections: [{ heading: null, fields: [
      t('subjective', 'S – Subjective', { rows: 3 }),
      t('objective', 'O – Objective (exam, results)', { rows: 3 }),
      t('assessment', 'A – Assessment', { rows: 2 }),
      t('plan', "P – Plan", { rows: 4, required: true }),
    ] }],
  },
  nursing: {
    label: "Nurses' note",
    perm: 'nursing.write',
    sections: [{ heading: null, fields: [
      { key: 'shift', label: 'Shift', type: 'select', options: ['Morning', 'Afternoon', 'Night'] },
      t('note', 'Nursing note / observations', { rows: 5, required: true }),
      t('care_given', 'Care / interventions given', { rows: 2 }),
      { key: 'intake_ml', label: 'Fluid intake (ml)', type: 'number' },
      { key: 'output_ml', label: 'Fluid output (ml)', type: 'number' },
      t('handover', 'Handover / pending', { rows: 2 }),
    ] }],
  },
  theatre: {
    label: 'Theatre / operation note',
    perm: 'theatre.write',
    sections: [
      { heading: 'Procedure', fields: [
        { key: 'procedure', label: 'Procedure performed', type: 'text', required: true },
        t('indication', 'Indication / pre-op diagnosis', { rows: 2 }),
        { key: 'urgency', label: 'Urgency', type: 'select', options: ['Elective', 'Urgent', 'Emergency'] },
        { key: 'who_checklist', label: 'WHO Surgical Safety Checklist', type: 'select', options: ['Completed (sign in, time out, sign out)', 'Partially completed', 'Not done'] },
      ] },
      { heading: 'Team & anaesthesia', fields: [
        { key: 'surgeon', label: 'Surgeon', type: 'text' },
        { key: 'assistant', label: 'Assistant(s)', type: 'text' },
        { key: 'anaesthetist', label: 'Anaesthetist', type: 'text' },
        { key: 'scrub_nurse', label: 'Scrub nurse', type: 'text' },
        { key: 'anaesthesia', label: 'Anaesthesia', type: 'select', options: ['General', 'Spinal', 'Epidural', 'Regional block', 'Local', 'Sedation'] },
        { key: 'asa', label: 'ASA class', type: 'select', options: ['I', 'II', 'III', 'IV', 'V', 'IE', 'IIE', 'IIIE', 'IVE', 'VE'] },
        { key: 'start_time', label: 'Start time', type: 'time' },
        { key: 'end_time', label: 'End time', type: 'time' },
      ] },
      { heading: 'Operation', fields: [
        t('incision', 'Position / incision', { rows: 1 }),
        t('findings', 'Findings', { rows: 3 }),
        t('procedure_details', 'Procedure details', { rows: 5 }),
        t('closure', 'Closure', { rows: 1 }),
        { key: 'ebl_ml', label: 'Estimated blood loss (ml)', type: 'number' },
        t('specimens', 'Specimens sent', { rows: 1 }),
        t('drains_implants', 'Drains / implants', { rows: 1 }),
        { key: 'counts', label: 'Swab & instrument counts', type: 'select', options: ['Correct', 'Incorrect – see notes'] },
        t('complications', 'Complications', { rows: 1 }),
        t('post_op_orders', 'Post-operative orders', { rows: 4 }),
      ] },
    ],
  },
  procedure: {
    label: 'Bedside procedure note',
    perm: 'clin.write',
    sections: [{ heading: null, fields: [
      { key: 'procedure', label: 'Procedure', type: 'text', required: true },
      t('consent', 'Consent', { rows: 1 }),
      t('details', 'Details', { rows: 4 }),
      t('complications', 'Complications', { rows: 1 }),
      t('plan', 'Plan after procedure', { rows: 2 }),
    ] }],
  },
};

export function noteFields(kind) {
  const def = NOTE_DEFS[kind];
  return def ? def.sections.flatMap((s) => s.fields) : null;
}

// NEWS2 (Royal College of Physicians, 2017), SpO2 scale 1. Adults (>= 16 years) only.
export function news2(v) {
  const has = (x) => x !== null && x !== undefined && x !== '' && !Number.isNaN(Number(x));
  const required = [v.resp_rate, v.spo2, v.bp_sys, v.pulse, v.temp];
  if (!required.every(has) || !v.avpu) return null;
  const rr = +v.resp_rate, sp = +v.spo2, sbp = +v.bp_sys, hr = +v.pulse, tp = +v.temp;
  let s = 0;
  s += rr <= 8 ? 3 : rr <= 11 ? 1 : rr <= 20 ? 0 : rr <= 24 ? 2 : 3;
  s += sp <= 91 ? 3 : sp <= 93 ? 2 : sp <= 95 ? 1 : 0;
  s += v.on_oxygen ? 2 : 0;
  s += sbp <= 90 ? 3 : sbp <= 100 ? 2 : sbp <= 110 ? 1 : sbp <= 219 ? 0 : 3;
  s += hr <= 40 ? 3 : hr <= 50 ? 1 : hr <= 90 ? 0 : hr <= 110 ? 1 : hr <= 130 ? 2 : 3;
  s += v.avpu === 'A' ? 0 : 3;
  s += tp <= 35 ? 3 : tp <= 36 ? 1 : tp <= 38 ? 0 : tp <= 39 ? 1 : 2;
  return s;
}

// Flag a numeric lab value against its reference interval.
export function flagResult(param, value) {
  if (value === null || value === undefined || value === '') return '';
  if (param.options && param.options.length) {
    return param.abnormal && param.abnormal.includes(value) ? 'A' : '';
  }
  const n = Number(value);
  if (Number.isNaN(n)) return '';
  if (param.low !== null && param.low !== undefined && param.low !== '' && n < Number(param.low)) return 'L';
  if (param.high !== null && param.high !== undefined && param.high !== '' && n > Number(param.high)) return 'H';
  return '';
}

export function refText(p) {
  const has = (x) => x !== null && x !== undefined && x !== '';
  if (has(p.low) && has(p.high)) return `${p.low} – ${p.high}`;
  if (has(p.low)) return `> ${p.low}`;
  if (has(p.high)) return `< ${p.high}`;
  return p.ref || '';
}
