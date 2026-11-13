// SQLite storage using Node's built-in driver (no native dependencies).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA_V1 = `
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name TEXT NOT NULL,
  title TEXT,                       -- e.g. Dr, Nurse, MLS
  role TEXT NOT NULL CHECK (role IN ('admin','doctor','nurse','lab','records')),
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE patients (
  id INTEGER PRIMARY KEY,
  folder_no TEXT NOT NULL UNIQUE,
  title TEXT,
  first_name TEXT NOT NULL,
  middle_name TEXT,
  last_name TEXT NOT NULL,
  sex TEXT NOT NULL CHECK (sex IN ('M','F')),
  dob TEXT,
  dob_estimated INTEGER NOT NULL DEFAULT 0,
  phone TEXT,
  ghana_card TEXT,
  nhis_no TEXT,
  nhis_expiry TEXT,
  address TEXT,
  gps_address TEXT,
  hometown TEXT,
  region TEXT,
  occupation TEXT,
  religion TEXT,
  marital_status TEXT,
  blood_group TEXT,
  allergies TEXT,
  nok_name TEXT,
  nok_relation TEXT,
  nok_phone TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE INDEX idx_patients_name ON patients(last_name, first_name);
CREATE INDEX idx_patients_nhis ON patients(nhis_no);
CREATE INDEX idx_patients_phone ON patients(phone);
CREATE INDEX idx_patients_card ON patients(ghana_card);

CREATE TABLE wards (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  kind TEXT,                        -- Medical, Surgical, Maternity, Paediatric, ...
  beds INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE encounters (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  type TEXT NOT NULL CHECK (type IN ('OPD','IPD','EMERGENCY')),
  status TEXT NOT NULL CHECK (status IN ('open','admitted','closed','discharged')),
  department TEXT,
  payer TEXT,                       -- NHIS, Cash, Private insurance, Corporate
  reason TEXT,
  ward_id INTEGER REFERENCES wards(id),
  bed TEXT,
  attending_id INTEGER REFERENCES users(id),
  start_at TEXT NOT NULL DEFAULT (datetime('now')),
  admitted_at TEXT,
  end_at TEXT,
  outcome TEXT,
  discharge_summary TEXT,
  follow_up TEXT,
  created_by INTEGER REFERENCES users(id)
);
CREATE INDEX idx_enc_patient ON encounters(patient_id);
CREATE INDEX idx_enc_status ON encounters(status, type);

CREATE TABLE notes (
  id INTEGER PRIMARY KEY,
  encounter_id INTEGER NOT NULL REFERENCES encounters(id),
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  kind TEXT NOT NULL,               -- clerking | progress | nursing | theatre | procedure
  data TEXT NOT NULL,               -- JSON object of section -> text
  author_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  amends_id INTEGER REFERENCES notes(id),
  superseded_by INTEGER REFERENCES notes(id)
);
CREATE INDEX idx_notes_enc ON notes(encounter_id);

CREATE TABLE vitals (
  id INTEGER PRIMARY KEY,
  encounter_id INTEGER NOT NULL REFERENCES encounters(id),
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  temp REAL, pulse INTEGER, resp_rate INTEGER, bp_sys INTEGER, bp_dia INTEGER,
  spo2 INTEGER, on_oxygen INTEGER NOT NULL DEFAULT 0, avpu TEXT,
  weight REAL, height REAL, muac REAL, pain INTEGER, glucose REAL,
  news2 INTEGER,
  comment TEXT,
  recorded_by INTEGER NOT NULL REFERENCES users(id),
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_vitals_enc ON vitals(encounter_id);

CREATE TABLE icd10 (
  code TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  gdrg_code TEXT,                   -- NHIA G-DRG mapping (import from the current tariff)
  common INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE diagnoses (
  id INTEGER PRIMARY KEY,
  encounter_id INTEGER NOT NULL REFERENCES encounters(id),
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  icd10_code TEXT,
  description TEXT NOT NULL,
  gdrg_code TEXT,
  rank TEXT NOT NULL DEFAULT 'secondary' CHECK (rank IN ('primary','secondary')),
  certainty TEXT NOT NULL DEFAULT 'provisional' CHECK (certainty IN ('provisional','confirmed','differential')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','resolved','error')),
  note TEXT,
  author_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE INDEX idx_dx_patient ON diagnoses(patient_id);

CREATE TABLE prescriptions (
  id INTEGER PRIMARY KEY,
  encounter_id INTEGER NOT NULL REFERENCES encounters(id),
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  drug TEXT NOT NULL,
  dose TEXT, route TEXT, frequency TEXT, duration TEXT, instructions TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','stopped','completed')),
  prescriber_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  stopped_by INTEGER REFERENCES users(id),
  stopped_at TEXT
);
CREATE INDEX idx_rx_enc ON prescriptions(encounter_id);

CREATE TABLE lab_tests (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  section TEXT,                     -- Haematology, Chemistry, Microbiology, Serology, Parasitology
  specimen TEXT,
  params TEXT NOT NULL,             -- JSON [{name, unit, low, high, loinc, options}]
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE lab_orders (
  id INTEGER PRIMARY KEY,
  encounter_id INTEGER NOT NULL REFERENCES encounters(id),
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  test_id INTEGER NOT NULL REFERENCES lab_tests(id),
  test_name TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'routine' CHECK (priority IN ('routine','urgent','stat')),
  clinical_info TEXT,
  status TEXT NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered','collected','resulted','cancelled')),
  ordered_by INTEGER NOT NULL REFERENCES users(id),
  ordered_at TEXT NOT NULL DEFAULT (datetime('now')),
  sample_id TEXT,
  collected_by INTEGER REFERENCES users(id),
  collected_at TEXT,
  results TEXT,                     -- JSON [{name, value, unit, ref, flag, loinc}]
  comment TEXT,
  resulted_by INTEGER REFERENCES users(id),
  resulted_at TEXT,
  cancel_reason TEXT
);
CREATE INDEX idx_lab_status ON lab_orders(status);
CREATE INDEX idx_lab_patient ON lab_orders(patient_id);

CREATE TABLE documents (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  encounter_id INTEGER REFERENCES encounters(id),
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  doc_date TEXT,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  stored_name TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_docs_patient ON documents(patient_id);

CREATE TABLE audit (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  patient_id INTEGER,
  detail TEXT,
  ip TEXT
);
CREATE INDEX idx_audit_patient ON audit(patient_id);
`;

const MIGRATIONS = [SCHEMA_V1];

export function openDb(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const file = dataDir === ':memory:' ? ':memory:' : join(dataDir, 'hmis.db');
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(raw);
  return wrap(raw);
}

function migrate(raw) {
  const current = raw.prepare('PRAGMA user_version').get().user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    raw.exec('BEGIN');
    try {
      raw.exec(MIGRATIONS[v]);
      raw.exec(`PRAGMA user_version = ${v + 1}`);
      raw.exec('COMMIT');
    } catch (e) {
      raw.exec('ROLLBACK');
      throw e;
    }
  }
}

// node:sqlite only binds null/number/bigint/string/Uint8Array.
function clean(v) {
  if (v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v !== null && typeof v === 'object' && !(v instanceof Uint8Array)) return JSON.stringify(v);
  return v;
}

function wrap(raw) {
  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) { s = raw.prepare(sql); cache.set(sql, s); }
    return s;
  };
  const columns = {};
  for (const { name } of raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()) {
    columns[name] = new Set(raw.prepare(`PRAGMA table_info(${name})`).all().map((c) => c.name));
  }
  const pickCols = (table, obj) => {
    const cols = columns[table];
    if (!cols) throw new Error(`Unknown table ${table}`);
    return Object.keys(obj).filter((k) => cols.has(k) && k !== 'id' && obj[k] !== undefined);
  };
  let depth = 0;
  const db = {
    raw,
    all: (sql, ...p) => stmt(sql).all(...p.map(clean)),
    get: (sql, ...p) => stmt(sql).get(...p.map(clean)),
    run: (sql, ...p) => stmt(sql).run(...p.map(clean)),
    insert(table, obj) {
      const keys = pickCols(table, obj);
      const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
      return Number(stmt(sql).run(...keys.map((k) => clean(obj[k]))).lastInsertRowid);
    },
    update(table, id, obj) {
      const keys = pickCols(table, obj);
      if (!keys.length) return 0;
      const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
      return Number(stmt(sql).run(...keys.map((k) => clean(obj[k])), id).changes);
    },
    tx(fn) {
      if (depth > 0) return fn();
      depth++;
      raw.exec('BEGIN IMMEDIATE');
      try {
        const r = fn();
        raw.exec('COMMIT');
        return r;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      } finally {
        depth--;
      }
    },
    setting(key, fallback = null) {
      const r = stmt('SELECT value FROM settings WHERE key = ?').get(key);
      return r ? r.value : fallback;
    },
    setSetting(key, value) {
      stmt('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
    },
    close: () => raw.close(),
  };
  return db;
}
