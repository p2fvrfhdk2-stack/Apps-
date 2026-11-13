import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, createReadStream, existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HttpError } from './app.js';
import {
  hashPassword, verifyPassword, validatePassword, createSession, destroySession, destroyUserSessions,
  loginLocked, recordLoginFailure, clearLoginFailures, ROLE_PERMS, ROLES,
} from './auth.js';
import {
  NOTE_DEFS, noteFields, news2, flagResult, refText, REGIONS, DEPARTMENTS, PAYERS, OUTCOMES, DOC_CATEGORIES,
} from './clinical.js';

// ---------- small validation helpers ----------
const str = (v, max = 500) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s.length > max) throw new HttpError(400, `Value too long (max ${max} characters)`);
  return s === '' ? null : s;
};
const num = (v, min = -1e9, max = 1e9) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `Number out of range: ${v}`);
  return n;
};
const oneOf = (v, list, field) => {
  if (v === undefined || v === null || v === '') return null;
  if (!list.includes(v)) throw new HttpError(400, `Invalid ${field}`);
  return v;
};
const required = (obj, fields) => {
  for (const f of fields) if (obj[f] === null || obj[f] === undefined || obj[f] === '') throw new HttpError(400, `${f.replace(/_/g, ' ')} is required`);
};
const date = (v) => {
  const s = str(v, 30);
  if (s && !/^\d{4}-\d{2}-\d{2}/.test(s)) throw new HttpError(400, 'Dates must be YYYY-MM-DD');
  return s;
};
const id = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Invalid id');
  return n;
};

const USER_COLS = 'id, username, full_name, title, role, active, must_change_password, created_at';
const ALLOWED_UPLOADS = {
  'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/tiff': '.tif',
};

export function registerRoutes(r, { db, dataDir, secureCookies }) {
  const uploadDir = join(dataDir, 'uploads');
  mkdirSync(uploadDir, { recursive: true });

  const getPatient = (pid) => {
    const p = db.get('SELECT * FROM patients WHERE id = ?', id(pid));
    if (!p) throw new HttpError(404, 'Patient not found');
    return p;
  };
  const getEncounter = (eid) => {
    const e = db.get(`SELECT e.*, w.name AS ward_name, u.full_name AS attending_name
                        FROM encounters e LEFT JOIN wards w ON w.id = e.ward_id LEFT JOIN users u ON u.id = e.attending_id
                       WHERE e.id = ?`, id(eid));
    if (!e) throw new HttpError(404, 'Encounter not found');
    return e;
  };
  const activeEncounter = (eid) => {
    const e = getEncounter(eid);
    if (e.status === 'closed' || e.status === 'discharged') throw new HttpError(409, 'This encounter is closed. Start a new visit to add entries.');
    return e;
  };
  const cookie = (token, maxAge) =>
    `hmis_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secureCookies ? '; Secure' : ''}`;

  // ================= Auth =================
  r.add('POST', '/api/login', 'public', ({ body, res, ip, db: d }) => {
    const username = str(body.username, 64) || '';
    const key = `${username.toLowerCase()}|${ip}`;
    if (loginLocked(key)) throw new HttpError(429, 'Too many failed attempts. Try again in 5 minutes.');
    const u = d.get('SELECT * FROM users WHERE username = ? AND active = 1', username);
    if (!u || !verifyPassword(String(body.password || ''), u.password_hash)) {
      recordLoginFailure(key);
      d.run('INSERT INTO audit (action, entity, detail, ip) VALUES (?, ?, ?, ?)', 'login_failed', 'user', username, ip);
      throw new HttpError(401, 'Incorrect username or password');
    }
    clearLoginFailures(key);
    const token = createSession(d, u.id);
    d.run('INSERT INTO audit (user_id, action, entity, entity_id, ip) VALUES (?, ?, ?, ?, ?)', u.id, 'login', 'user', u.id, ip);
    res.setHeader('Set-Cookie', cookie(token, 12 * 3600));
    return { ok: true };
  });

  r.add('POST', '/api/logout', 'public', ({ res, token }) => {
    destroySession(db, token);
    res.setHeader('Set-Cookie', cookie('', 0));
    return { ok: true };
  }, { allowPasswordChange: true });

  r.add('GET', '/api/me', 'auth', ({ user }) => ({ ...user, perms: ROLE_PERMS[user.role] }), { allowPasswordChange: true });

  r.add('POST', '/api/me/password', 'auth', ({ user, body, res, audit }) => {
    const u = db.get('SELECT password_hash FROM users WHERE id = ?', user.id);
    if (!verifyPassword(String(body.current || ''), u.password_hash)) throw new HttpError(400, 'Current password is incorrect');
    const err = validatePassword(body.password);
    if (err) throw new HttpError(400, err);
    if (body.password === body.current) throw new HttpError(400, 'Choose a different password');
    db.update('users', user.id, { password_hash: hashPassword(body.password), must_change_password: 0 });
    destroyUserSessions(db, user.id);
    const token = createSession(db, user.id);
    res.setHeader('Set-Cookie', cookie(token, 12 * 3600));
    audit('password_change', 'user', user.id);
    return { ok: true };
  }, { allowPasswordChange: true });

  // ================= Reference data =================
  r.add('GET', '/api/meta', 'auth', () => ({
    hospital_name: db.setting('hospital_name'),
    regions: REGIONS, departments: DEPARTMENTS, payers: PAYERS, outcomes: OUTCOMES, doc_categories: DOC_CATEGORIES,
    note_defs: NOTE_DEFS, roles: ROLES,
    wards: db.all('SELECT id, name, kind, beds FROM wards WHERE active = 1 ORDER BY name'),
    lab_tests: db.all('SELECT id, code, name, section, specimen FROM lab_tests WHERE active = 1 ORDER BY section, name'),
    doctors: db.all("SELECT id, full_name, title FROM users WHERE role = 'doctor' AND active = 1 ORDER BY full_name"),
  }));

  r.add('GET', '/api/icd10', 'auth', ({ query }) => {
    const q = (str(query.q, 100) || '').replace(/[%_]/g, '');
    if (!q) return db.all('SELECT * FROM icd10 WHERE common = 1 ORDER BY code LIMIT 40');
    return db.all(
      `SELECT * FROM icd10 WHERE code LIKE ? OR title LIKE ?
        ORDER BY (code LIKE ?) DESC, common DESC, code LIMIT 40`, `${q}%`, `%${q}%`, `${q}%`);
  });

  // ================= Dashboard & worklists =================
  r.add('GET', '/api/dashboard', 'auth', ({ user, can: c }) => {
    const out = {
      opd_open: db.get("SELECT COUNT(*) AS n FROM encounters WHERE status = 'open'").n,
      inpatients: db.get("SELECT COUNT(*) AS n FROM encounters WHERE status = 'admitted'").n,
      registered_today: db.get("SELECT COUNT(*) AS n FROM patients WHERE date(created_at) = date('now')").n,
      labs_pending: db.get("SELECT COUNT(*) AS n FROM lab_orders WHERE status IN ('ordered','collected')").n,
    };
    if (c('lab.read')) {
      out.labs_unseen_abnormal = db.all(
        `SELECT l.id, l.test_name, l.resulted_at, l.encounter_id, p.first_name, p.last_name, p.folder_no
           FROM lab_orders l JOIN patients p ON p.id = l.patient_id
          WHERE l.status = 'resulted' AND l.results LIKE '%"flag":"_"%' AND l.ordered_by = ?
            AND l.resulted_at > datetime('now','-3 days') ORDER BY l.resulted_at DESC LIMIT 15`, user.id);
    }
    return out;
  });

  r.add('GET', '/api/encounters', 'patient.read', ({ query }) => {
    const where = [];
    const args = [];
    const status = oneOf(query.status, ['open', 'admitted', 'closed', 'discharged'], 'status');
    if (status) { where.push('e.status = ?'); args.push(status); }
    if (query.ward_id) { where.push('e.ward_id = ?'); args.push(id(query.ward_id)); }
    if (query.department) { where.push('e.department = ?'); args.push(str(query.department, 100)); }
    if (query.today) where.push("date(e.start_at) = date('now')");
    return db.all(
      `SELECT e.id, e.type, e.status, e.department, e.payer, e.reason, e.start_at, e.admitted_at, e.bed,
              w.name AS ward_name, p.id AS patient_id, p.folder_no, p.first_name, p.last_name, p.sex, p.dob,
              (SELECT news2 FROM vitals v WHERE v.encounter_id = e.id ORDER BY v.recorded_at DESC, v.id DESC LIMIT 1) AS news2,
              (SELECT description FROM diagnoses d WHERE d.encounter_id = e.id AND d.status <> 'error' ORDER BY d.rank = 'primary' DESC, d.id LIMIT 1) AS diagnosis
         FROM encounters e JOIN patients p ON p.id = e.patient_id LEFT JOIN wards w ON w.id = e.ward_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY e.start_at DESC LIMIT 300`, ...args);
  });

  r.add('GET', '/api/wards', 'patient.read', () => {
    const wards = db.all('SELECT * FROM wards WHERE active = 1 ORDER BY name');
    for (const w of wards) {
      w.patients = db.all(
        `SELECT e.id AS encounter_id, e.bed, e.admitted_at, p.id AS patient_id, p.first_name, p.last_name, p.sex, p.dob, p.folder_no,
                (SELECT news2 FROM vitals v WHERE v.encounter_id = e.id ORDER BY v.recorded_at DESC, v.id DESC LIMIT 1) AS news2,
                (SELECT description FROM diagnoses d WHERE d.encounter_id = e.id AND d.status <> 'error' ORDER BY d.rank = 'primary' DESC, d.id LIMIT 1) AS diagnosis
           FROM encounters e JOIN patients p ON p.id = e.patient_id
          WHERE e.status = 'admitted' AND e.ward_id = ? ORDER BY e.bed, e.admitted_at`, w.id);
    }
    return wards;
  });

  // ================= Patients =================
  const PATIENT_FIELDS = ['title', 'first_name', 'middle_name', 'last_name', 'phone', 'ghana_card', 'nhis_no', 'address', 'gps_address',
    'hometown', 'region', 'occupation', 'religion', 'marital_status', 'blood_group', 'allergies', 'nok_name', 'nok_relation', 'nok_phone'];
  const patientInput = (b) => {
    const p = {};
    for (const f of PATIENT_FIELDS) p[f] = str(b[f], f === 'allergies' || f === 'address' ? 1000 : 200);
    p.sex = oneOf(b.sex, ['M', 'F'], 'sex');
    p.dob = date(b.dob);
    p.dob_estimated = b.dob_estimated ? 1 : 0;
    p.nhis_expiry = date(b.nhis_expiry);
    if (p.ghana_card) {
      p.ghana_card = p.ghana_card.toUpperCase().replace(/\s/g, '');
      if (!/^GHA-\d{9}-\d$/.test(p.ghana_card)) throw new HttpError(400, 'Ghana Card number must look like GHA-123456789-0');
    }
    if (p.dob && p.dob > new Date().toISOString().slice(0, 10)) throw new HttpError(400, 'Date of birth cannot be in the future');
    required(p, ['first_name', 'last_name', 'sex']);
    return p;
  };
  const nextFolderNo = () => {
    const yy = new Date().getFullYear() % 100;
    const key = `folder_seq_${yy}`;
    const n = Number(db.setting(key, '0')) + 1;
    db.setSetting(key, n);
    return `${String(n).padStart(5, '0')}/${String(yy).padStart(2, '0')}`;
  };

  r.add('GET', '/api/patients', 'patient.read', ({ query }) => {
    const q = (str(query.q, 100) || '').replace(/[%_]/g, '');
    const cols = 'id, folder_no, title, first_name, middle_name, last_name, sex, dob, phone, nhis_no, nhis_expiry, ghana_card';
    if (!q) return db.all(`SELECT ${cols} FROM patients ORDER BY id DESC LIMIT 30`);
    const terms = q.split(/\s+/).slice(0, 4);
    const conds = terms.map(() => '(first_name LIKE ? OR last_name LIKE ? OR middle_name LIKE ? OR folder_no LIKE ? OR phone LIKE ? OR nhis_no LIKE ? OR ghana_card LIKE ?)');
    const args = terms.flatMap((t) => [`${t}%`, `${t}%`, `${t}%`, `%${t}%`, `%${t}%`, `${t}%`, `%${t}%`]);
    return db.all(`SELECT ${cols} FROM patients WHERE ${conds.join(' AND ')} ORDER BY last_name, first_name LIMIT 50`, ...args);
  });

  r.add('POST', '/api/patients', 'patient.write', ({ body, user, audit }) => db.tx(() => {
    const p = patientInput(body);
    p.folder_no = str(body.folder_no, 40) || nextFolderNo();
    p.created_by = user.id;
    const pid = db.insert('patients', p);
    audit('create', 'patient', pid, pid);
    return { id: pid, folder_no: p.folder_no };
  }));

  r.add('PUT', '/api/patients/:id', 'patient.write', ({ params, body, audit }) => {
    const existing = getPatient(params.id);
    const p = patientInput(body);
    if (body.folder_no) p.folder_no = str(body.folder_no, 40);
    p.updated_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
    db.update('patients', existing.id, p);
    audit('update', 'patient', existing.id, existing.id);
    return { ok: true };
  });

  r.add('GET', '/api/patients/:id', 'patient.read', ({ params, can: c, audit }) => {
    const p = getPatient(params.id);
    audit('view', 'patient', p.id, p.id);
    const out = { patient: p };
    out.encounters = db.all(
      `SELECT e.id, e.type, e.status, e.department, e.payer, e.reason, e.start_at, e.admitted_at, e.end_at, e.outcome, e.bed,
              w.name AS ward_name,
              (SELECT group_concat(description, '; ') FROM diagnoses d WHERE d.encounter_id = e.id AND d.status <> 'error') AS diagnoses
         FROM encounters e LEFT JOIN wards w ON w.id = e.ward_id WHERE e.patient_id = ? ORDER BY e.start_at DESC, e.id DESC`, p.id);
    if (c('clin.read')) {
      out.problems = db.all(
        `SELECT d.*, u.full_name AS author FROM diagnoses d JOIN users u ON u.id = d.author_id
          WHERE d.patient_id = ? AND d.status = 'active' ORDER BY d.created_at DESC`, p.id);
      out.medications = db.all(
        `SELECT r.*, u.full_name AS prescriber FROM prescriptions r JOIN users u ON u.id = r.prescriber_id
          WHERE r.patient_id = ? AND r.status = 'active' ORDER BY r.created_at DESC`, p.id);
      out.last_vitals = db.get('SELECT * FROM vitals WHERE patient_id = ? ORDER BY recorded_at DESC, id DESC LIMIT 1', p.id) || null;
    }
    if (c('lab.read')) out.labs = labRows('l.patient_id = ?', [p.id]);
    if (c('doc.read')) out.documents = docRows('d.patient_id = ?', p.id);
    return out;
  });

  // ================= Encounters =================
  r.add('POST', '/api/patients/:id/encounters', 'enc.write', ({ params, body, user, audit, can: c }) => db.tx(() => {
    const p = getPatient(params.id);
    const type = oneOf(body.type, ['OPD', 'IPD', 'EMERGENCY'], 'visit type') || 'OPD';
    if (type === 'IPD' && !c('enc.admit')) throw new HttpError(403, 'You cannot admit patients');
    const open = db.get("SELECT id FROM encounters WHERE patient_id = ? AND status IN ('open','admitted')", p.id);
    if (open) throw new HttpError(409, `Patient already has an active visit (#${open.id}). Close it first.`);
    const e = {
      patient_id: p.id, type, status: type === 'IPD' ? 'admitted' : 'open',
      department: str(body.department, 100), payer: oneOf(body.payer, PAYERS, 'payer'), reason: str(body.reason, 500),
      attending_id: body.attending_id ? id(body.attending_id) : null, created_by: user.id,
    };
    if (type === 'IPD') {
      e.ward_id = id(body.ward_id);
      e.bed = str(body.bed, 20);
      e.admitted_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
    }
    const eid = db.insert('encounters', e);
    audit('create', 'encounter', eid, p.id, type);
    return { id: eid };
  }));

  r.add('GET', '/api/encounters/:id', 'patient.read', ({ params, can: c, audit }) => {
    const e = getEncounter(params.id);
    const p = db.get('SELECT * FROM patients WHERE id = ?', e.patient_id);
    audit('view', 'encounter', e.id, p.id);
    const out = { encounter: e, patient: p };
    if (c('clin.read')) {
      out.notes = db.all(
        `SELECT n.*, u.full_name AS author, u.title AS author_title, u.role AS author_role
           FROM notes n JOIN users u ON u.id = n.author_id WHERE n.encounter_id = ? ORDER BY n.created_at DESC, n.id DESC`, e.id)
        .map((n) => ({ ...n, data: JSON.parse(n.data) }));
      out.vitals = db.all(
        `SELECT v.*, u.full_name AS recorder FROM vitals v JOIN users u ON u.id = v.recorded_by
          WHERE v.encounter_id = ? ORDER BY v.recorded_at DESC, v.id DESC`, e.id);
      out.diagnoses = db.all(
        `SELECT d.*, u.full_name AS author FROM diagnoses d JOIN users u ON u.id = d.author_id
          WHERE d.encounter_id = ? ORDER BY d.rank = 'primary' DESC, d.created_at`, e.id);
      out.prescriptions = db.all(
        `SELECT r.*, u.full_name AS prescriber FROM prescriptions r JOIN users u ON u.id = r.prescriber_id
          WHERE r.encounter_id = ? ORDER BY r.status = 'active' DESC, r.created_at DESC`, e.id);
    }
    if (c('lab.read')) out.labs = labRows('l.encounter_id = ?', [e.id]);
    if (c('doc.read')) out.documents = docRows('d.encounter_id = ?', e.id);
    return out;
  });

  r.add('POST', '/api/encounters/:id/admit', 'enc.admit', ({ params, body, audit }) => {
    const e = activeEncounter(params.id);
    const ward = db.get('SELECT id FROM wards WHERE id = ? AND active = 1', id(body.ward_id));
    if (!ward) throw new HttpError(400, 'Choose a ward');
    const upd = { ward_id: ward.id, bed: str(body.bed, 20), attending_id: body.attending_id ? id(body.attending_id) : e.attending_id };
    if (e.status === 'open') Object.assign(upd, { type: 'IPD', status: 'admitted', admitted_at: new Date().toISOString().replace('T', ' ').slice(0, 19) });
    db.update('encounters', e.id, upd);
    audit(e.status === 'open' ? 'admit' : 'transfer', 'encounter', e.id, e.patient_id, `ward ${ward.id} bed ${upd.bed || '-'}`);
    return { ok: true };
  });

  r.add('POST', '/api/encounters/:id/close', 'enc.close', ({ params, body, audit }) => {
    const e = activeEncounter(params.id);
    const outcome = oneOf(body.outcome, OUTCOMES, 'outcome');
    required({ outcome }, ['outcome']);
    db.update('encounters', e.id, {
      status: e.status === 'admitted' ? 'discharged' : 'closed', outcome,
      discharge_summary: str(body.discharge_summary, 20000), follow_up: str(body.follow_up, 1000),
      end_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
    });
    audit(e.status === 'admitted' ? 'discharge' : 'close', 'encounter', e.id, e.patient_id, outcome);
    return { ok: true };
  });

  // ================= Clinical notes (append-only; amendments supersede) =================
  r.add('POST', '/api/encounters/:id/notes', 'clin.read', ({ params, body, user, can: c, audit }) => db.tx(() => {
    const kind = String(body.kind || '');
    const def = NOTE_DEFS[kind];
    if (!def) throw new HttpError(400, 'Unknown note type');
    if (!c(def.perm)) throw new HttpError(403, `You cannot write ${def.label.toLowerCase()}s`);
    const e = activeEncounter(params.id);
    const fields = noteFields(kind);
    const data = {};
    const input = body.data || {};
    for (const f of fields) {
      const v = f.type === 'number' ? num(input[f.key], 0, 1e6) : str(input[f.key], 20000);
      if (v !== null) data[f.key] = v;
      if (f.required && v === null) throw new HttpError(400, `${f.label} is required`);
    }
    let amends = null;
    if (body.amends_id) {
      amends = db.get('SELECT * FROM notes WHERE id = ? AND encounter_id = ?', id(body.amends_id), e.id);
      if (!amends) throw new HttpError(404, 'Original note not found');
      if (amends.superseded_by) throw new HttpError(409, 'That note has already been amended');
      if (amends.author_id !== user.id && user.role !== 'admin') throw new HttpError(403, 'Only the author can amend a note');
      if (amends.kind !== kind) throw new HttpError(400, 'Amendment must be the same note type');
    }
    const nid = db.insert('notes', { encounter_id: e.id, patient_id: e.patient_id, kind, data: JSON.stringify(data), author_id: user.id, amends_id: amends ? amends.id : null });
    if (amends) db.update('notes', amends.id, { superseded_by: nid });
    audit(amends ? 'amend' : 'create', 'note', nid, e.patient_id, kind);
    return { id: nid };
  }));

  // ================= Vitals =================
  r.add('POST', '/api/encounters/:id/vitals', 'vitals.write', ({ params, body, user, audit }) => {
    const e = activeEncounter(params.id);
    const v = {
      encounter_id: e.id, patient_id: e.patient_id, recorded_by: user.id,
      temp: num(body.temp, 25, 45), pulse: num(body.pulse, 0, 300), resp_rate: num(body.resp_rate, 0, 120),
      bp_sys: num(body.bp_sys, 0, 350), bp_dia: num(body.bp_dia, 0, 250), spo2: num(body.spo2, 0, 100),
      on_oxygen: body.on_oxygen ? 1 : 0, avpu: oneOf(body.avpu, ['A', 'C', 'V', 'P', 'U'], 'AVPU'),
      weight: num(body.weight, 0, 500), height: num(body.height, 0, 260), muac: num(body.muac, 0, 60),
      pain: num(body.pain, 0, 10), glucose: num(body.glucose, 0, 100), comment: str(body.comment, 500),
    };
    const anyValue = ['temp', 'pulse', 'resp_rate', 'bp_sys', 'spo2', 'weight', 'height', 'muac', 'pain', 'glucose'].some((k) => v[k] !== null);
    if (!anyValue) throw new HttpError(400, 'Enter at least one measurement');
    const p = db.get('SELECT dob FROM patients WHERE id = ?', e.patient_id);
    const adult = !p.dob || (Date.now() - Date.parse(p.dob)) / 31557600000 >= 16;
    v.news2 = adult ? news2(v) : null;
    const vid = db.insert('vitals', v);
    audit('create', 'vitals', vid, e.patient_id);
    return { id: vid, news2: v.news2 };
  });

  // ================= Diagnoses (ICD-10 + G-DRG) =================
  r.add('POST', '/api/encounters/:id/diagnoses', 'dx.write', ({ params, body, user, audit }) => db.tx(() => {
    const e = activeEncounter(params.id);
    const code = str(body.icd10_code, 10);
    const icd = code ? db.get('SELECT * FROM icd10 WHERE code = ?', code.toUpperCase()) : null;
    if (code && !icd) throw new HttpError(400, `Unknown ICD-10 code ${code}`);
    const d = {
      encounter_id: e.id, patient_id: e.patient_id, author_id: user.id,
      icd10_code: icd ? icd.code : null, description: str(body.description, 300) || (icd && icd.title),
      gdrg_code: str(body.gdrg_code, 20) || (icd && icd.gdrg_code),
      rank: oneOf(body.rank, ['primary', 'secondary'], 'rank') || 'secondary',
      certainty: oneOf(body.certainty, ['provisional', 'confirmed', 'differential'], 'certainty') || 'provisional',
      note: str(body.note, 1000),
    };
    required(d, ['description']);
    if (d.rank === 'primary') db.run("UPDATE diagnoses SET rank = 'secondary' WHERE encounter_id = ? AND rank = 'primary'", e.id);
    const did = db.insert('diagnoses', d);
    audit('create', 'diagnosis', did, e.patient_id, d.icd10_code);
    return { id: did };
  }));

  r.add('PATCH', '/api/diagnoses/:id', 'dx.write', ({ params, body, audit }) => db.tx(() => {
    const d = db.get('SELECT * FROM diagnoses WHERE id = ?', id(params.id));
    if (!d) throw new HttpError(404, 'Diagnosis not found');
    const upd = {
      status: oneOf(body.status, ['active', 'resolved', 'error'], 'status') ?? undefined,
      certainty: oneOf(body.certainty, ['provisional', 'confirmed', 'differential'], 'certainty') ?? undefined,
      rank: oneOf(body.rank, ['primary', 'secondary'], 'rank') ?? undefined,
      updated_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
    };
    if (upd.rank === 'primary') db.run("UPDATE diagnoses SET rank = 'secondary' WHERE encounter_id = ? AND rank = 'primary'", d.encounter_id);
    db.update('diagnoses', d.id, upd);
    audit('update', 'diagnosis', d.id, d.patient_id, JSON.stringify(body));
    return { ok: true };
  }));

  // ================= Prescriptions =================
  r.add('POST', '/api/encounters/:id/prescriptions', 'rx.write', ({ params, body, user, audit }) => {
    const e = activeEncounter(params.id);
    const rx = {
      encounter_id: e.id, patient_id: e.patient_id, prescriber_id: user.id,
      drug: str(body.drug, 200), dose: str(body.dose, 100), route: str(body.route, 50), frequency: str(body.frequency, 100),
      duration: str(body.duration, 100), instructions: str(body.instructions, 500),
    };
    required(rx, ['drug']);
    const rid = db.insert('prescriptions', rx);
    audit('create', 'prescription', rid, e.patient_id, rx.drug);
    return { id: rid };
  });

  r.add('PATCH', '/api/prescriptions/:id', 'rx.write', ({ params, body, user, audit }) => {
    const rx = db.get('SELECT * FROM prescriptions WHERE id = ?', id(params.id));
    if (!rx) throw new HttpError(404, 'Prescription not found');
    const status = oneOf(body.status, ['stopped', 'completed'], 'status');
    required({ status }, ['status']);
    db.update('prescriptions', rx.id, { status, stopped_by: user.id, stopped_at: new Date().toISOString().replace('T', ' ').slice(0, 19) });
    audit(status, 'prescription', rx.id, rx.patient_id);
    return { ok: true };
  });

  // ================= Laboratory =================
  function labRows(where, args = [], order = 'l.ordered_at DESC, l.id DESC') {
    return db.all(
      `SELECT l.*, t.section, t.specimen, o.full_name AS ordered_by_name, rs.full_name AS resulted_by_name,
              p.first_name, p.last_name, p.folder_no, p.sex, p.dob
         FROM lab_orders l JOIN lab_tests t ON t.id = l.test_id JOIN patients p ON p.id = l.patient_id
         JOIN users o ON o.id = l.ordered_by LEFT JOIN users rs ON rs.id = l.resulted_by
        WHERE ${where} ORDER BY ${order} LIMIT 500`, ...args)
      .map((l) => ({ ...l, results: l.results ? JSON.parse(l.results) : null }));
  }

  r.add('POST', '/api/encounters/:id/labs', 'lab.order', ({ params, body, user, audit }) => db.tx(() => {
    const e = activeEncounter(params.id);
    const ids = Array.isArray(body.test_ids) ? body.test_ids.map(id) : [];
    if (!ids.length) throw new HttpError(400, 'Select at least one test');
    const priority = oneOf(body.priority, ['routine', 'urgent', 'stat'], 'priority') || 'routine';
    const info = str(body.clinical_info, 1000);
    const created = [];
    for (const tid of ids) {
      const t = db.get('SELECT * FROM lab_tests WHERE id = ? AND active = 1', tid);
      if (!t) throw new HttpError(400, 'Unknown lab test');
      const lid = db.insert('lab_orders', { encounter_id: e.id, patient_id: e.patient_id, test_id: t.id, test_name: t.name, priority, clinical_info: info, ordered_by: user.id });
      created.push(lid);
      audit('order', 'lab', lid, e.patient_id, t.code);
    }
    return { ids: created };
  }));

  r.add('GET', '/api/labs', 'lab.read', ({ query }) => {
    const status = query.status || 'pending';
    if (status === 'pending') return labRows("l.status IN ('ordered','collected')", [], "CASE l.priority WHEN 'stat' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END, l.ordered_at");
    const s = oneOf(status, ['ordered', 'collected', 'resulted', 'cancelled'], 'status');
    return labRows("l.status = ? AND l.ordered_at > datetime('now', '-14 days')", [s]);
  });

  r.add('GET', '/api/labs/:id', 'lab.read', ({ params }) => {
    const [l] = labRows('l.id = ?', [id(params.id)]);
    if (!l) throw new HttpError(404, 'Lab order not found');
    const t = db.get('SELECT * FROM lab_tests WHERE id = ?', l.test_id);
    return { order: l, params: JSON.parse(t.params) };
  });

  r.add('POST', '/api/labs/:id/collect', 'lab.result', ({ params, body, user, audit }) => {
    const l = db.get('SELECT * FROM lab_orders WHERE id = ?', id(params.id));
    if (!l) throw new HttpError(404, 'Lab order not found');
    if (l.status !== 'ordered') throw new HttpError(409, 'Sample already collected or order closed');
    db.update('lab_orders', l.id, { status: 'collected', sample_id: str(body.sample_id, 50) || `S${l.id}`, collected_by: user.id, collected_at: new Date().toISOString().replace('T', ' ').slice(0, 19) });
    audit('collect', 'lab', l.id, l.patient_id);
    return { ok: true };
  });

  r.add('POST', '/api/labs/:id/result', 'lab.result', ({ params, body, user, audit }) => {
    const l = db.get('SELECT * FROM lab_orders WHERE id = ?', id(params.id));
    if (!l) throw new HttpError(404, 'Lab order not found');
    if (l.status === 'cancelled') throw new HttpError(409, 'Order was cancelled');
    const t = db.get('SELECT * FROM lab_tests WHERE id = ?', l.test_id);
    const defs = JSON.parse(t.params);
    const input = body.values || {};
    const results = defs.map((p) => {
      const value = str(input[p.name], 2000);
      if (value !== null && p.options && p.options.length && !p.options.includes(value)) throw new HttpError(400, `Invalid value for ${p.name}`);
      return { name: p.name, value, unit: p.unit || '', ref: refText(p), flag: flagResult(p, value), loinc: p.loinc || null };
    }).filter((x) => x.value !== null);
    if (!results.length) throw new HttpError(400, 'Enter at least one result');
    const amended = l.status === 'resulted';
    db.update('lab_orders', l.id, {
      status: 'resulted', results: JSON.stringify(results), comment: str(body.comment, 2000),
      resulted_by: user.id, resulted_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
      collected_at: l.collected_at || new Date().toISOString().replace('T', ' ').slice(0, 19), collected_by: l.collected_by || user.id,
    });
    audit(amended ? 'amend_result' : 'result', 'lab', l.id, l.patient_id, amended ? l.results : null);
    return { ok: true };
  });

  r.add('POST', '/api/labs/:id/cancel', 'lab.read', ({ params, body, user, can: c, audit }) => {
    const l = db.get('SELECT * FROM lab_orders WHERE id = ?', id(params.id));
    if (!l) throw new HttpError(404, 'Lab order not found');
    if (!c('lab.result') && !(c('lab.order') && l.ordered_by === user.id)) throw new HttpError(403, 'You cannot cancel this order');
    if (l.status === 'resulted' || l.status === 'cancelled') throw new HttpError(409, 'Order already completed');
    const reason = str(body.reason, 300);
    required({ reason }, ['reason']);
    db.update('lab_orders', l.id, { status: 'cancelled', cancel_reason: reason });
    audit('cancel', 'lab', l.id, l.patient_id, reason);
    return { ok: true };
  });

  // ================= Documents (scanned files) =================
  function docRows(where, ...args) {
    return db.all(
      `SELECT d.id, d.patient_id, d.encounter_id, d.category, d.title, d.doc_date, d.mime, d.size, d.uploaded_at, u.full_name AS uploaded_by_name
         FROM documents d JOIN users u ON u.id = d.uploaded_by WHERE ${where} ORDER BY COALESCE(d.doc_date, d.uploaded_at) DESC`, ...args);
  }

  r.add('POST', '/api/patients/:id/documents', 'doc.write', async ({ params, query, body, req, user, audit }) => {
    const p = getPatient(params.id);
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const ext = ALLOWED_UPLOADS[mime];
    if (!ext) throw new HttpError(415, 'Only PDF, JPEG, PNG, WEBP or TIFF files can be uploaded');
    if (!body.length) throw new HttpError(400, 'Empty file');
    const magic = body.subarray(0, 4).toString('hex');
    const okMagic = { '.pdf': magic.startsWith('25504446'), '.jpg': magic.startsWith('ffd8ff'), '.png': magic === '89504e47',
      '.webp': body.subarray(8, 12).toString() === 'WEBP', '.tif': magic === '49492a00' || magic === '4d4d002a' }[ext];
    if (!okMagic) throw new HttpError(415, 'File content does not match its type');
    const meta = {
      category: oneOf(query.category, DOC_CATEGORIES, 'category') || 'Other',
      title: str(query.title, 200), doc_date: date(query.doc_date),
      encounter_id: query.encounter_id ? id(query.encounter_id) : null,
    };
    required(meta, ['title']);
    if (meta.encounter_id && !db.get('SELECT 1 AS x FROM encounters WHERE id = ? AND patient_id = ?', meta.encounter_id, p.id)) throw new HttpError(400, 'Encounter does not belong to patient');
    const stored = randomBytes(16).toString('hex') + ext;
    await writeFile(join(uploadDir, stored), body, { flag: 'wx' });
    const did = db.insert('documents', {
      patient_id: p.id, ...meta, mime, size: body.length, stored_name: stored,
      sha256: createHash('sha256').update(body).digest('hex'), uploaded_by: user.id,
    });
    audit('upload', 'document', did, p.id, meta.title);
    return { id: did };
  }, { raw: true });

  r.add('GET', '/api/documents/:id/file', 'doc.read', ({ params, res, audit }) => {
    const d = db.get('SELECT * FROM documents WHERE id = ?', id(params.id));
    if (!d) throw new HttpError(404, 'Document not found');
    const path = join(uploadDir, d.stored_name);
    if (!existsSync(path)) throw new HttpError(410, 'File missing from storage');
    audit('view', 'document', d.id, d.patient_id);
    const safeName = d.title.replace(/[^\w.\- ]+/g, '_') + (ALLOWED_UPLOADS[d.mime] || '');
    res.writeHead(200, {
      'Content-Type': d.mime, 'Content-Length': d.size, 'Cache-Control': 'private, no-store',
      'Content-Disposition': `inline; filename="${safeName}"`,
    });
    createReadStream(path).pipe(res);
  });

  // ================= FHIR R4 export =================
  r.add('GET', '/api/patients/:id/fhir', 'clin.read', ({ params, audit }) => {
    const p = getPatient(params.id);
    audit('export', 'patient', p.id, p.id, 'fhir');
    const base = `urn:hmis`;
    const patient = {
      resourceType: 'Patient', id: String(p.id),
      identifier: [
        { system: `${base}:folder-no`, value: p.folder_no },
        p.ghana_card && { system: 'urn:gh:nia:ghana-card', value: p.ghana_card },
        p.nhis_no && { system: 'urn:gh:nhia:membership', value: p.nhis_no, period: p.nhis_expiry ? { end: p.nhis_expiry } : undefined },
      ].filter(Boolean),
      name: [{ use: 'official', family: p.last_name, given: [p.first_name, p.middle_name].filter(Boolean), prefix: p.title ? [p.title] : undefined }],
      gender: p.sex === 'M' ? 'male' : 'female',
      birthDate: p.dob || undefined,
      telecom: p.phone ? [{ system: 'phone', value: p.phone }] : undefined,
      address: [{ text: p.address || undefined, state: p.region || undefined, country: 'GH' }],
      contact: p.nok_name ? [{ name: { text: p.nok_name }, telecom: p.nok_phone ? [{ system: 'phone', value: p.nok_phone }] : undefined, relationship: p.nok_relation ? [{ text: p.nok_relation }] : undefined }] : undefined,
    };
    const conditions = db.all("SELECT * FROM diagnoses WHERE patient_id = ? AND status <> 'error'", p.id).map((d) => ({
      resourceType: 'Condition', id: `dx-${d.id}`,
      clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: d.status === 'resolved' ? 'resolved' : 'active' }] },
      verificationStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status', code: d.certainty === 'confirmed' ? 'confirmed' : d.certainty === 'differential' ? 'differential' : 'provisional' }] },
      code: { coding: d.icd10_code ? [{ system: 'http://hl7.org/fhir/sid/icd-10', code: d.icd10_code, display: d.description }] : undefined, text: d.description },
      subject: { reference: `Patient/${p.id}` }, encounter: { reference: `Encounter/${d.encounter_id}` }, recordedDate: d.created_at.replace(' ', 'T') + 'Z',
    }));
    const encounters = db.all('SELECT * FROM encounters WHERE patient_id = ?', p.id).map((e) => ({
      resourceType: 'Encounter', id: String(e.id),
      status: e.status === 'closed' || e.status === 'discharged' ? 'finished' : 'in-progress',
      class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: e.type === 'IPD' ? 'IMP' : e.type === 'EMERGENCY' ? 'EMER' : 'AMB' },
      subject: { reference: `Patient/${p.id}` },
      period: { start: e.start_at.replace(' ', 'T') + 'Z', end: e.end_at ? e.end_at.replace(' ', 'T') + 'Z' : undefined },
    }));
    const observations = db.all("SELECT * FROM lab_orders WHERE patient_id = ? AND status = 'resulted'", p.id).flatMap((l) =>
      JSON.parse(l.results).map((x, i) => ({
        resourceType: 'Observation', id: `lab-${l.id}-${i}`, status: 'final',
        category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
        code: { coding: x.loinc ? [{ system: 'http://loinc.org', code: x.loinc, display: x.name }] : undefined, text: x.name },
        subject: { reference: `Patient/${p.id}` }, encounter: { reference: `Encounter/${l.encounter_id}` },
        effectiveDateTime: l.resulted_at.replace(' ', 'T') + 'Z',
        ...(x.unit && !Number.isNaN(Number(x.value)) ? { valueQuantity: { value: Number(x.value), unit: x.unit } } : { valueString: x.value }),
        interpretation: x.flag ? [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation', code: x.flag }] }] : undefined,
      })));
    return {
      resourceType: 'Bundle', type: 'collection', timestamp: new Date().toISOString(),
      entry: [patient, ...encounters, ...conditions, ...observations].map((resource) => ({ fullUrl: `${base}:${resource.resourceType}/${resource.id}`, resource })),
    };
  });

  // ================= Administration =================
  r.add('GET', '/api/admin/users', 'admin', () => db.all(`SELECT ${USER_COLS} FROM users ORDER BY active DESC, role, full_name`));

  r.add('POST', '/api/admin/users', 'admin', ({ body, audit }) => {
    const u = {
      username: str(body.username, 64), full_name: str(body.full_name, 200), title: str(body.title, 30),
      role: oneOf(body.role, ROLES, 'role'),
    };
    required(u, ['username', 'full_name', 'role']);
    if (!/^[a-zA-Z0-9._-]{3,64}$/.test(u.username)) throw new HttpError(400, 'Username: 3+ letters, numbers, dot, dash or underscore');
    const err = validatePassword(body.password);
    if (err) throw new HttpError(400, err);
    u.password_hash = hashPassword(body.password);
    u.must_change_password = 1;
    const uid = db.insert('users', u);
    audit('create', 'user', uid, null, `${u.username} (${u.role})`);
    return { id: uid };
  });

  r.add('PUT', '/api/admin/users/:id', 'admin', ({ params, body, user, audit }) => {
    const uid = id(params.id);
    const target = db.get('SELECT * FROM users WHERE id = ?', uid);
    if (!target) throw new HttpError(404, 'User not found');
    const upd = {
      full_name: str(body.full_name, 200) ?? undefined, title: body.title !== undefined ? str(body.title, 30) : undefined,
      role: oneOf(body.role, ROLES, 'role') ?? undefined,
      active: body.active === undefined ? undefined : (body.active ? 1 : 0),
    };
    if (uid === user.id && (upd.active === 0 || (upd.role && upd.role !== 'admin'))) throw new HttpError(400, 'You cannot deactivate or demote yourself');
    if (body.password) {
      const err = validatePassword(body.password);
      if (err) throw new HttpError(400, err);
      upd.password_hash = hashPassword(body.password);
      upd.must_change_password = 1;
    }
    db.update('users', uid, upd);
    if (upd.active === 0 || upd.password_hash || upd.role) destroyUserSessions(db, uid);
    audit('update', 'user', uid, null, Object.keys(upd).filter((k) => upd[k] !== undefined && k !== 'password_hash').join(',') + (upd.password_hash ? ',password_reset' : ''));
    return { ok: true };
  });

  r.add('GET', '/api/admin/wards', 'admin', () => db.all('SELECT * FROM wards ORDER BY active DESC, name'));
  r.add('POST', '/api/admin/wards', 'admin', ({ body, audit }) => {
    const w = { name: str(body.name, 100), kind: str(body.kind, 50), beds: num(body.beds, 0, 1000) ?? 0 };
    required(w, ['name']);
    const wid = db.insert('wards', w);
    audit('create', 'ward', wid);
    return { id: wid };
  });
  r.add('PUT', '/api/admin/wards/:id', 'admin', ({ params, body, audit }) => {
    const wid = id(params.id);
    db.update('wards', wid, {
      name: str(body.name, 100) ?? undefined, kind: body.kind !== undefined ? str(body.kind, 50) : undefined,
      beds: num(body.beds, 0, 1000) ?? undefined, active: body.active === undefined ? undefined : (body.active ? 1 : 0),
    });
    audit('update', 'ward', wid);
    return { ok: true };
  });

  const labTestInput = (b) => {
    const t = { code: str(b.code, 30), name: str(b.name, 200), section: str(b.section, 50), specimen: str(b.specimen, 100) };
    required(t, ['code', 'name']);
    t.code = t.code.toUpperCase();
    if (!Array.isArray(b.params) || !b.params.length) throw new HttpError(400, 'A test needs at least one parameter');
    t.params = JSON.stringify(b.params.map((p) => {
      const out = { name: str(p.name, 100), unit: str(p.unit, 30) || '', loinc: str(p.loinc, 20) };
      if (!out.name) throw new HttpError(400, 'Each parameter needs a name');
      const options = Array.isArray(p.options) ? p.options.map((o) => str(o, 100)).filter(Boolean) : [];
      if (options.length) {
        out.options = options;
        out.abnormal = Array.isArray(p.abnormal) ? p.abnormal.filter((a) => options.includes(a)) : [];
      } else {
        out.low = num(p.low); out.high = num(p.high);
      }
      return out;
    }));
    t.active = b.active === undefined ? 1 : (b.active ? 1 : 0);
    return t;
  };
  r.add('GET', '/api/admin/lab-tests', 'admin', () => db.all('SELECT * FROM lab_tests ORDER BY section, name').map((t) => ({ ...t, params: JSON.parse(t.params) })));
  r.add('POST', '/api/admin/lab-tests', 'admin', ({ body, audit }) => {
    const tid = db.insert('lab_tests', labTestInput(body));
    audit('create', 'lab_test', tid);
    return { id: tid };
  });
  r.add('PUT', '/api/admin/lab-tests/:id', 'admin', ({ params, body, audit }) => {
    const tid = id(params.id);
    db.update('lab_tests', tid, labTestInput(body));
    audit('update', 'lab_test', tid);
    return { ok: true };
  });

  // CSV: code,title[,gdrg_code]  (header row optional). Upserts; existing titles are kept if blank.
  r.add('POST', '/api/admin/icd10/import', 'admin', ({ body, audit }) => db.tx(() => {
    const text = body.toString('utf8').replace(/^﻿/, '');
    let added = 0, updated = 0, skipped = 0;
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const cols = parseCsvLine(line);
      const code = (cols[0] || '').trim().toUpperCase();
      if (!/^[A-Z]\d{2}(\.\d{1,2})?[A-Z]?$/.test(code)) { skipped++; continue; }
      const title = (cols[1] || '').trim().slice(0, 300);
      const gdrg = (cols[2] || '').trim().slice(0, 20) || null;
      const ex = db.get('SELECT * FROM icd10 WHERE code = ?', code);
      if (ex) {
        db.run('UPDATE icd10 SET title = COALESCE(NULLIF(?, \'\'), title), gdrg_code = COALESCE(?, gdrg_code) WHERE code = ?', title, gdrg, code);
        updated++;
      } else if (title) {
        db.run('INSERT INTO icd10 (code, title, gdrg_code) VALUES (?, ?, ?)', code, title, gdrg);
        added++;
      } else skipped++;
    }
    audit('import', 'icd10', null, null, `added ${added}, updated ${updated}, skipped ${skipped}`);
    return { added, updated, skipped };
  }), { raw: true });

  r.add('PUT', '/api/admin/settings', 'admin', ({ body, audit }) => {
    const name = str(body.hospital_name, 200);
    if (name) db.setSetting('hospital_name', name);
    audit('update', 'settings');
    return { ok: true };
  });

  r.add('GET', '/api/admin/audit', 'admin', ({ query }) => {
    const where = [];
    const args = [];
    if (query.patient_id) { where.push('a.patient_id = ?'); args.push(id(query.patient_id)); }
    if (query.user_id) { where.push('a.user_id = ?'); args.push(id(query.user_id)); }
    return db.all(
      `SELECT a.*, u.username, p.folder_no FROM audit a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN patients p ON p.id = a.patient_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.id DESC LIMIT 300`, ...args);
  });
}

function parseCsvLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
