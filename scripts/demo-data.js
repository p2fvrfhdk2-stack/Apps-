// Loads demonstration users and patients for training/evaluation. Do NOT run on a live system.
// Usage: npm run demo
import { resolve } from 'node:path';
import { openDb } from '../lib/db.js';
import { seedReference, ensureAdmin } from '../lib/seed.js';
import { hashPassword } from '../lib/auth.js';
import { news2 } from '../lib/clinical.js';

const db = openDb(resolve(process.env.HMIS_DATA_DIR || 'data'));
seedReference(db);
const generated = ensureAdmin(db, process.env.HMIS_ADMIN_PASSWORD);
if (generated) console.log(`Admin account created – username: admin  password: ${generated}`);

if (db.get("SELECT 1 AS x FROM users WHERE username = 'doctor'")) {
  console.log('Demo data already loaded.');
  process.exit(0);
}

const PASSWORD = 'Demo1234';
const user = (username, full_name, title, role) =>
  db.insert('users', { username, full_name, title, role, password_hash: hashPassword(PASSWORD), must_change_password: 0 });

db.tx(() => {
  const doc = user('doctor', 'Ama Mensah', 'Dr', 'doctor');
  const surg = user('surgeon', 'Kofi Agyeman', 'Dr', 'doctor');
  const nurse = user('nurse', 'Akosua Boateng', 'Nurse', 'nurse');
  const lab = user('lab', 'Kwame Asante', 'MLS', 'lab');
  user('records', 'Yaw Owusu', null, 'records');

  const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString().replace('T', ' ').slice(0, 19);
  const year = new Date().getFullYear();
  const patient = (o) => db.insert('patients', { created_by: 1, region: 'Greater Accra', ...o });
  const ward = (name) => db.get('SELECT id FROM wards WHERE name = ?', name).id;
  const test = (code) => db.get('SELECT * FROM lab_tests WHERE code = ?', code);

  // 1. OPD patient with malaria
  const p1 = patient({ folder_no: `00001/${String(year % 100).padStart(2, '0')}`, title: 'Mr', first_name: 'Kwabena', last_name: 'Osei', sex: 'M', dob: `${year - 34}-03-14`,
    phone: '0244123456', nhis_no: '12345678', nhis_expiry: `${year + 1}-01-31`, ghana_card: 'GHA-712345678-1', occupation: 'Trader', address: 'Madina, near Zongo junction',
    nok_name: 'Abena Osei', nok_relation: 'Wife', nok_phone: '0209876543' });
  const e1 = db.insert('encounters', { patient_id: p1, type: 'OPD', status: 'open', department: 'General OPD', payer: 'NHIS', reason: 'Fever and headache x 3 days', attending_id: doc, created_by: 1, start_at: ago(2) });
  const v1 = { temp: 38.9, pulse: 104, resp_rate: 20, bp_sys: 118, bp_dia: 76, spo2: 97, avpu: 'A', weight: 72 };
  db.insert('vitals', { encounter_id: e1, patient_id: p1, ...v1, news2: news2(v1), recorded_by: nurse, recorded_at: ago(1.8) });
  db.insert('notes', { encounter_id: e1, patient_id: p1, kind: 'clerking', author_id: doc, created_at: ago(1.5), data: JSON.stringify({
    presenting_complaint: 'Fever, headache and body pains for 3 days', hpc: 'Intermittent high-grade fever with chills, frontal headache, generalised body pains. Anorexia. No vomiting, no diarrhoea, no convulsions. Took paracetamol from a chemical shop with partial relief.',
    pmh: 'Nil known chronic illness', drug_history: 'Paracetamol PRN', allergies: 'None known', social_history: 'Trader, married, occasional alcohol, non-smoker',
    general_exam: 'Febrile (38.9°C), not pale, anicteric, well hydrated', cvs: 'PR 104 regular, BP 118/76, HS I & II normal', resp: 'Clear chest', abdomen: 'Soft, non-tender, no hepatosplenomegaly', cns: 'Conscious, no neck stiffness',
    impression: 'Uncomplicated malaria ?typhoid', plan: '1. Malaria RDT, FBC\n2. Start AL if RDT positive\n3. Paracetamol 1 g TDS\n4. Review with results' }) });
  db.insert('diagnoses', { encounter_id: e1, patient_id: p1, icd10_code: 'B50.9', description: 'Plasmodium falciparum malaria, unspecified', rank: 'primary', certainty: 'provisional', author_id: doc, created_at: ago(1.4) });
  const rdt = test('MRDT'), fbc = test('FBC');
  db.insert('lab_orders', { encounter_id: e1, patient_id: p1, test_id: rdt.id, test_name: rdt.name, priority: 'urgent', clinical_info: 'Fever 3/7', ordered_by: doc, ordered_at: ago(1.4),
    status: 'resulted', collected_by: lab, collected_at: ago(1.2), sample_id: 'S1', resulted_by: lab, resulted_at: ago(1),
    results: JSON.stringify([{ name: 'Malaria RDT', value: 'Positive', unit: '', ref: '', flag: 'A', loinc: null }]) });
  db.insert('lab_orders', { encounter_id: e1, patient_id: p1, test_id: fbc.id, test_name: fbc.name, priority: 'routine', clinical_info: 'Fever 3/7', ordered_by: doc, ordered_at: ago(1.4) });
  db.insert('prescriptions', { encounter_id: e1, patient_id: p1, drug: 'Artemether-lumefantrine 20/120 mg tablet', dose: '4 tablets', route: 'PO (oral)', frequency: 'BD (12-hourly)', duration: '3 days', instructions: 'Take with food/milk', prescriber_id: doc, created_at: ago(0.9) });

  // 2. Inpatient – severe pre-eclampsia, post caesarean section
  const p2 = patient({ folder_no: `00002/${String(year % 100).padStart(2, '0')}`, title: 'Mrs', first_name: 'Efua', middle_name: 'Adwoa', last_name: 'Appiah', sex: 'F', dob: `${year - 29}-08-02`,
    phone: '0551234567', nhis_no: '87654321', nhis_expiry: `${year}-01-15`, allergies: 'Penicillin (rash)', blood_group: 'O+', region: 'Central', occupation: 'Teacher',
    nok_name: 'Kojo Appiah', nok_relation: 'Husband', nok_phone: '0261112223' });
  const e2 = db.insert('encounters', { patient_id: p2, type: 'IPD', status: 'admitted', department: 'Obstetrics & Gynaecology', payer: 'NHIS', reason: 'Severe pre-eclampsia at 36 weeks',
    ward_id: ward('Maternity'), bed: 'M4', attending_id: surg, created_by: 1, start_at: ago(30), admitted_at: ago(30) });
  db.insert('diagnoses', { encounter_id: e2, patient_id: p2, icd10_code: 'O14.1', description: 'Severe pre-eclampsia', rank: 'primary', certainty: 'confirmed', author_id: surg, created_at: ago(29) });
  db.insert('diagnoses', { encounter_id: e2, patient_id: p2, icd10_code: 'O82.9', description: 'Delivery by caesarean section, unspecified', rank: 'secondary', certainty: 'confirmed', author_id: surg, created_at: ago(20) });
  db.insert('notes', { encounter_id: e2, patient_id: p2, kind: 'theatre', author_id: surg, created_at: ago(20), data: JSON.stringify({
    procedure: 'Emergency lower segment caesarean section', indication: 'Severe pre-eclampsia, unfavourable cervix', urgency: 'Emergency', who_checklist: 'Completed (sign in, time out, sign out)',
    surgeon: 'Dr Kofi Agyeman', assistant: 'Dr Ama Mensah', anaesthetist: 'Mr Daniel Tetteh (CRA)', scrub_nurse: 'Nurse Esi Quaye', anaesthesia: 'Spinal', asa: 'IIIE',
    start_time: '14:10', end_time: '15:05', incision: 'Supine with left lateral tilt; Pfannenstiel incision', findings: 'Live female infant, 2.6 kg, APGAR 7 and 9. Clear liquor. Normal tubes and ovaries.',
    procedure_details: 'Uterus opened via lower segment transverse incision. Baby delivered cephalic. Placenta delivered by controlled cord traction, complete. Uterus closed in 2 layers with Vicryl 1.',
    closure: 'Rectus sheath Vicryl 1, skin subcuticular', ebl_ml: 600, counts: 'Correct', complications: 'None',
    post_op_orders: 'Vitals every 30 min x 2 h then hourly\nMagnesium sulphate maintenance to continue 24 h post-delivery\nIV fluids 3 L/24 h\nFluid balance chart, catheter in situ\nAnalgesia as prescribed' }) });
  db.insert('notes', { encounter_id: e2, patient_id: p2, kind: 'nursing', author_id: nurse, created_at: ago(6), data: JSON.stringify({
    shift: 'Morning', note: 'Patient conscious and alert. Wound dressing dry and intact. Urine output adequate via catheter. Breastfeeding initiated.', care_given: 'MgSO4 maintenance continued, vitals monitored hourly', intake_ml: 1800, output_ml: 1450, handover: 'Repeat UEC due this afternoon' }) });
  for (const [h, v] of [[24, { temp: 37.2, pulse: 96, resp_rate: 18, bp_sys: 168, bp_dia: 112, spo2: 97, avpu: 'A' }], [4, { temp: 37.0, pulse: 88, resp_rate: 16, bp_sys: 148, bp_dia: 96, spo2: 98, avpu: 'A' }]]) {
    db.insert('vitals', { encounter_id: e2, patient_id: p2, ...v, news2: news2(v), recorded_by: nurse, recorded_at: ago(h) });
  }
  db.insert('prescriptions', { encounter_id: e2, patient_id: p2, drug: 'Nifedipine 20 mg SR tablet', dose: '20 mg', route: 'PO (oral)', frequency: 'BD (12-hourly)', prescriber_id: surg, created_at: ago(28) });
  db.insert('prescriptions', { encounter_id: e2, patient_id: p2, drug: 'Metronidazole 500 mg/100 ml infusion', dose: '500 mg', route: 'IV', frequency: 'TDS (8-hourly)', duration: '24 hours', prescriber_id: surg, created_at: ago(20) });
  const uec = test('UEC');
  db.insert('lab_orders', { encounter_id: e2, patient_id: p2, test_id: uec.id, test_name: uec.name, priority: 'urgent', clinical_info: 'Severe PET', ordered_by: surg, ordered_at: ago(29),
    status: 'resulted', resulted_by: lab, resulted_at: ago(27), collected_by: lab, collected_at: ago(28.5), sample_id: 'S2', results: JSON.stringify([
      { name: 'Sodium', value: '138', unit: 'mmol/L', ref: '135 – 145', flag: '' }, { name: 'Potassium', value: '4.1', unit: 'mmol/L', ref: '3.5 – 5.1', flag: '' },
      { name: 'Urea', value: '8.9', unit: 'mmol/L', ref: '2.5 – 7.8', flag: 'H' }, { name: 'Creatinine', value: '128', unit: 'µmol/L', ref: '53 – 115', flag: 'H', loinc: '2160-0' }]) });

  // 3. Inpatient – sickle cell crisis (paediatric)
  const p3 = patient({ folder_no: `00003/${String(year % 100).padStart(2, '0')}`, first_name: 'Nana', middle_name: 'Yaa', last_name: 'Darko', sex: 'F', dob: `${year - 9}-05-20`, phone: '0277000111',
    nhis_no: '55551111', nhis_expiry: `${year + 1}-06-30`, region: 'Ashanti', nok_name: 'Comfort Darko', nok_relation: 'Mother', nok_phone: '0277000111' });
  const e3 = db.insert('encounters', { patient_id: p3, type: 'IPD', status: 'admitted', department: 'Paediatrics', payer: 'NHIS', reason: 'Vaso-occlusive crisis',
    ward_id: ward('Paediatric'), bed: 'P2', attending_id: doc, created_by: 1, start_at: ago(50), admitted_at: ago(50) });
  db.insert('diagnoses', { encounter_id: e3, patient_id: p3, icd10_code: 'D57.0', description: 'Sickle-cell anaemia with crisis', rank: 'primary', certainty: 'confirmed', author_id: doc, created_at: ago(49) });
  db.insert('notes', { encounter_id: e3, patient_id: p3, kind: 'progress', author_id: doc, created_at: ago(3), data: JSON.stringify({
    subjective: 'Pain improving, now 4/10. Eating well.', objective: 'Afebrile, not in distress, mild pallor. Chest clear.', assessment: 'Resolving VOC', plan: 'Continue oral analgesia, step down IV fluids, encourage oral intake. Possible discharge tomorrow.' }) });

  // 4. Registered patient without a visit
  patient({ folder_no: `00004/${String(year % 100).padStart(2, '0')}`, title: 'Mr', first_name: 'Ibrahim', last_name: 'Mahama', sex: 'M', dob: `${year - 61}-01-01`, dob_estimated: 1,
    phone: '0501234987', region: 'Northern', hometown: 'Tamale', religion: 'Muslim', allergies: null });

  db.setSetting(`folder_seq_${year % 100}`, 4);
});

console.log(`Demo data loaded. Users (password "${PASSWORD}"): doctor, surgeon, nurse, lab, records.`);
