// End-to-end API tests: start the real server on a random port with a throwaway database.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../lib/db.js';
import { createApp } from '../lib/app.js';
import { seedReference, ensureAdmin } from '../lib/seed.js';
import { hashPassword } from '../lib/auth.js';
import { news2 } from '../lib/clinical.js';

let server, base, dir, db;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'hmis-test-'));
  db = openDb(dir);
  seedReference(db);
  ensureAdmin(db, 'Admin1234');
  for (const [u, role] of [['doc', 'doctor'], ['nurse', 'nurse'], ['lab', 'lab'], ['rec', 'records']]) {
    db.insert('users', { username: u, full_name: u, role, password_hash: hashPassword('Passw0rd1'), must_change_password: 0 });
  }
  server = http.createServer(createApp({ db, dataDir: dir }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => { server.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });

async function login(username, password = 'Passw0rd1') {
  const res = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HMIS': '1' }, body: JSON.stringify({ username, password }) });
  assert.equal(res.status, 200, `login ${username}`);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  return async (path, { method = 'GET', body, raw, type } = {}) => {
    const headers = { Cookie: cookie, 'X-HMIS': '1' };
    if (raw) headers['Content-Type'] = type;
    else if (body) headers['Content-Type'] = 'application/json';
    const r = await fetch(base + path, { method, headers, body: raw || (body ? JSON.stringify(body) : undefined) });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  };
}

test('unauthenticated requests are rejected', async () => {
  const r = await fetch(`${base}/api/patients`);
  assert.equal(r.status, 401);
});

test('state-changing requests require the CSRF header', async () => {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 403);
});

test('wrong password is rejected', async () => {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HMIS': '1' }, body: JSON.stringify({ username: 'doc', password: 'nope' }) });
  assert.equal(r.status, 401);
});

test('admin must change initial password before using the system', async () => {
  const admin = await login('admin', 'Admin1234');
  assert.equal((await admin('/api/admin/users')).status, 403);
  assert.equal((await admin('/api/me/password', { method: 'POST', body: { current: 'Admin1234', password: 'short' } })).status, 400);
  assert.equal((await admin('/api/me/password', { method: 'POST', body: { current: 'Admin1234', password: 'NewAdmin99' } })).status, 200);
  const admin2 = await login('admin', 'NewAdmin99');
  assert.equal((await admin2('/api/admin/users')).status, 200);
});

test('full outpatient → inpatient → discharge workflow', async () => {
  const rec = await login('rec');
  const doc = await login('doc');
  const nurse = await login('nurse');
  const lab = await login('lab');

  // Registration with Ghana Card validation and auto folder number
  assert.equal((await rec('/api/patients', { method: 'POST', body: { first_name: 'Kofi', last_name: 'Mensah', sex: 'M', ghana_card: 'GHA-12' } })).status, 400);
  const reg = await rec('/api/patients', { method: 'POST', body: { first_name: 'Kofi', last_name: 'Mensah', sex: 'M', dob: '1980-01-01', ghana_card: 'gha-123456789-0', nhis_no: '999' } });
  assert.equal(reg.status, 200);
  assert.match(reg.data.folder_no, /^\d{5}\/\d{2}$/);
  const pid = reg.data.id;
  assert.equal((await rec(`/api/patients?q=mens`)).data[0].id, pid);

  // Records can open a visit but cannot read clinical notes or admit
  const enc = await rec(`/api/patients/${pid}/encounters`, { method: 'POST', body: { type: 'OPD', department: 'General OPD', payer: 'NHIS' } });
  assert.equal(enc.status, 200);
  const eid = enc.data.id;
  assert.equal((await rec(`/api/patients/${pid}/encounters`, { method: 'POST', body: { type: 'OPD' } })).status, 409, 'only one active visit');
  assert.equal((await rec(`/api/encounters/${eid}`)).data.notes, undefined);

  // Nurse: vitals with NEWS2, nursing note OK, clerking forbidden
  const v = await nurse(`/api/encounters/${eid}/vitals`, { method: 'POST', body: { temp: 39.5, pulse: 120, resp_rate: 24, bp_sys: 100, bp_dia: 60, spo2: 94, avpu: 'A' } });
  assert.equal(v.status, 200);
  assert.equal(v.data.news2, 2 + 1 + 2 + 2 + 2); // RR24=2, SpO2 94=1, SBP100=2, HR120=2, T39.5=2
  assert.equal((await nurse(`/api/encounters/${eid}/notes`, { method: 'POST', body: { kind: 'nursing', data: { note: 'Tepid sponging done' } } })).status, 200);
  assert.equal((await nurse(`/api/encounters/${eid}/notes`, { method: 'POST', body: { kind: 'clerking', data: { presenting_complaint: 'x' } } })).status, 403);
  assert.equal((await nurse(`/api/encounters/${eid}/diagnoses`, { method: 'POST', body: { icd10_code: 'B50.9' } })).status, 403);

  // Doctor: clerking, required fields, unknown fields dropped
  assert.equal((await doc(`/api/encounters/${eid}/notes`, { method: 'POST', body: { kind: 'clerking', data: { hpc: 'x' } } })).status, 400);
  const note = await doc(`/api/encounters/${eid}/notes`, { method: 'POST', body: { kind: 'clerking', data: { presenting_complaint: 'Fever', plan: 'RDT', evil: 'x' } } });
  assert.equal(note.status, 200);

  // Amendment keeps the original and supersedes it; nurse cannot amend doctor's note
  assert.equal((await nurse(`/api/encounters/${eid}/notes`, { method: 'POST', body: { kind: 'nursing', data: { note: 'y' }, amends_id: note.data.id } })).status, 403);
  const am = await doc(`/api/encounters/${eid}/notes`, { method: 'POST', body: { kind: 'clerking', data: { presenting_complaint: 'Fever x3 days' }, amends_id: note.data.id } });
  assert.equal(am.status, 200);
  assert.equal((await doc(`/api/encounters/${eid}/notes`, { method: 'POST', body: { kind: 'clerking', data: { presenting_complaint: 'z' }, amends_id: note.data.id } })).status, 409);
  const full = (await doc(`/api/encounters/${eid}`)).data;
  const orig = full.notes.find((n) => n.id === note.data.id);
  assert.equal(orig.superseded_by, am.data.id);
  assert.equal(orig.data.evil, undefined);

  // Diagnoses: ICD-10 validation, single primary
  assert.equal((await doc(`/api/encounters/${eid}/diagnoses`, { method: 'POST', body: { icd10_code: 'ZZZ' } })).status, 400);
  const d1 = await doc(`/api/encounters/${eid}/diagnoses`, { method: 'POST', body: { icd10_code: 'B50.9', rank: 'primary' } });
  await doc(`/api/encounters/${eid}/diagnoses`, { method: 'POST', body: { icd10_code: 'A01.0', rank: 'primary' } });
  const dxs = (await doc(`/api/encounters/${eid}`)).data.diagnoses;
  assert.equal(dxs.filter((d) => d.rank === 'primary').length, 1);
  assert.equal(dxs.find((d) => d.id === d1.data.id).rank, 'secondary');

  // Labs: order → collect → result with flags; lab cannot write notes
  const order = await doc(`/api/encounters/${eid}/labs`, { method: 'POST', body: { test_ids: [db.get("SELECT id FROM lab_tests WHERE code='FBC'").id], priority: 'urgent' } });
  const lid = order.data.ids[0];
  assert.equal((await lab('/api/labs')).data.some((l) => l.id === lid), true);
  assert.equal((await lab(`/api/labs/${lid}/collect`, { method: 'POST', body: {} })).status, 200);
  assert.equal((await doc(`/api/labs/${lid}/result`, { method: 'POST', body: { values: { Haemoglobin: '9' } } })).status, 403);
  assert.equal((await lab(`/api/labs/${lid}/result`, { method: 'POST', body: { values: { Haemoglobin: '8.2', WBC: '6', Platelets: '600' } } })).status, 200);
  const res = (await doc(`/api/labs/${lid}`)).data.order.results;
  assert.deepEqual(res.map((r) => r.flag), ['L', '', 'H']);
  assert.equal((await lab(`/api/encounters/${eid}/notes`, { method: 'POST', body: { kind: 'nursing', data: { note: 'x' } } })).status, 403);

  // Prescription
  const rx = await doc(`/api/encounters/${eid}/prescriptions`, { method: 'POST', body: { drug: 'Artemether-lumefantrine', dose: '4 tabs', frequency: 'BD' } });
  assert.equal(rx.status, 200);

  // Document upload: type checking and retrieval
  assert.equal((await rec(`/api/patients/${pid}/documents?title=Bad`, { method: 'POST', raw: Buffer.from('MZ...'), type: 'application/pdf' })).status, 415);
  assert.equal((await rec(`/api/patients/${pid}/documents?title=Bad`, { method: 'POST', raw: Buffer.from('x'), type: 'text/html' })).status, 415);
  const pdf = Buffer.from('%PDF-1.4\n%%EOF');
  const up = await rec(`/api/patients/${pid}/documents?title=Old%20folder&category=Scanned%20old%20folder&encounter_id=${eid}`, { method: 'POST', raw: pdf, type: 'application/pdf' });
  assert.equal(up.status, 200);
  const file = await rec(`/api/documents/${up.data.id}/file`);
  assert.equal(file.data, pdf.toString());

  // Admit, then discharge (nurse cannot discharge)
  const ward = db.get('SELECT id FROM wards LIMIT 1').id;
  assert.equal((await nurse(`/api/encounters/${eid}/admit`, { method: 'POST', body: { ward_id: ward, bed: '3' } })).status, 200);
  assert.equal((await doc(`/api/wards`)).data.find((w) => w.id === ward).patients.length, 1);
  assert.equal((await nurse(`/api/encounters/${eid}/close`, { method: 'POST', body: { outcome: 'Discharged' } })).status, 403);
  assert.equal((await doc(`/api/encounters/${eid}/close`, { method: 'POST', body: { outcome: 'Discharged', discharge_summary: 'Well' } })).status, 200);
  const closed = (await doc(`/api/encounters/${eid}`)).data.encounter;
  assert.equal(closed.status, 'discharged');
  assert.equal((await doc(`/api/encounters/${eid}/notes`, { method: 'POST', body: { kind: 'progress', data: { plan: 'x' } } })).status, 409, 'closed encounters are read-only');

  // FHIR export
  const fhir = (await doc(`/api/patients/${pid}/fhir`)).data;
  assert.equal(fhir.resourceType, 'Bundle');
  const types = fhir.entry.map((e) => e.resource.resourceType);
  assert.ok(types.includes('Patient') && types.includes('Condition') && types.includes('Observation') && types.includes('Encounter'));
  assert.equal(fhir.entry.find((e) => e.resource.resourceType === 'Condition').resource.code.coding[0].system, 'http://hl7.org/fhir/sid/icd-10');

  // Audit trail recorded the chart views
  const admin = await login('admin', 'NewAdmin99');
  const audit = (await admin(`/api/admin/audit?patient_id=${pid}`)).data;
  assert.ok(audit.some((a) => a.action === 'view') && audit.some((a) => a.action === 'amend'));
});

test('ICD-10 / G-DRG CSV import', async () => {
  const admin = await login('admin', 'NewAdmin99');
  const csv = 'code,title,gdrg_code\nB50.9,,TEST01\nA02.0,"Salmonella enteritis",TEST02\nnot-a-code,x,y\n';
  const r = await admin('/api/admin/icd10/import', { method: 'POST', raw: Buffer.from(csv), type: 'text/csv' });
  assert.deepEqual(r.data, { added: 1, updated: 1, skipped: 2 });
  const found = (await admin('/api/icd10?q=B50.9')).data[0];
  assert.equal(found.gdrg_code, 'TEST01');
  assert.equal(found.title, 'Plasmodium falciparum malaria, unspecified');
});

test('NEWS2 scoring', () => {
  assert.equal(news2({ resp_rate: 16, spo2: 98, bp_sys: 120, pulse: 70, temp: 37, avpu: 'A' }), 0);
  assert.equal(news2({ resp_rate: 30, spo2: 88, on_oxygen: 1, bp_sys: 85, pulse: 140, temp: 34.5, avpu: 'U' }), 20);
  assert.equal(news2({ resp_rate: 16, spo2: 98 }), null);
});

test('static files are served and path traversal is blocked', async () => {
  const r = await fetch(`${base}/`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  const t = await fetch(`${base}/..%2f..%2fpackage.json`);
  assert.ok(!(await t.text()).includes('"name"'));
});
