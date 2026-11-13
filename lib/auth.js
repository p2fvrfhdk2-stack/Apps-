import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

// Role-based access control. Keep this list short and readable.
export const ROLE_PERMS = {
  admin: ['*'],
  doctor: ['patient.read', 'patient.write', 'enc.write', 'enc.admit', 'enc.close', 'clin.read', 'clin.write',
    'nursing.write', 'vitals.write', 'dx.write', 'rx.write', 'lab.order', 'lab.read', 'doc.read', 'doc.write', 'theatre.write'],
  nurse: ['patient.read', 'patient.write', 'enc.write', 'enc.admit', 'clin.read', 'nursing.write', 'vitals.write',
    'lab.order', 'lab.read', 'doc.read', 'doc.write'],
  lab: ['patient.read', 'lab.read', 'lab.result'],
  records: ['patient.read', 'patient.write', 'enc.write', 'doc.read', 'doc.write'],
};
export const ROLES = Object.keys(ROLE_PERMS);

export function can(user, perm) {
  if (!user) return false;
  const perms = ROLE_PERMS[user.role] || [];
  return perms.includes('*') || perms.includes(perm);
}

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [alg, saltB64, hashB64] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(expected, actual);
}

export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Password must contain letters and numbers.';
  return null;
}

const sha = (s) => createHash('sha256').update(s).digest('hex');
const SESSION_HOURS = 12;
const IDLE_MINUTES = 60;

export function createSession(db, userId) {
  const token = randomBytes(32).toString('base64url');
  db.run(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_HOURS} hours'))`, sha(token), userId);
  db.run("DELETE FROM sessions WHERE expires_at < datetime('now')");
  return token;
}

export function getSessionUser(db, token) {
  if (!token) return null;
  const row = db.get(
    `SELECT u.id, u.username, u.full_name, u.title, u.role, u.must_change_password, s.token_hash
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND u.active = 1 AND s.expires_at > datetime('now')
        AND s.last_seen > datetime('now', '-${IDLE_MINUTES} minutes')`, sha(token));
  if (!row) return null;
  db.run("UPDATE sessions SET last_seen = datetime('now') WHERE token_hash = ?", row.token_hash);
  delete row.token_hash;
  return row;
}

export function destroySession(db, token) {
  if (token) db.run('DELETE FROM sessions WHERE token_hash = ?', sha(token));
}

export function destroyUserSessions(db, userId) {
  db.run('DELETE FROM sessions WHERE user_id = ?', userId);
}

// Simple in-memory brute-force protection for the login endpoint.
const failures = new Map();
const MAX_FAILS = 8, LOCK_MS = 5 * 60 * 1000;
export function loginLocked(key) {
  const f = failures.get(key);
  return f && f.count >= MAX_FAILS && Date.now() - f.last < LOCK_MS;
}
export function recordLoginFailure(key) {
  const f = failures.get(key) || { count: 0, last: 0 };
  if (Date.now() - f.last > LOCK_MS) f.count = 0;
  f.count++; f.last = Date.now();
  failures.set(key, f);
}
export function clearLoginFailures(key) { failures.delete(key); }
