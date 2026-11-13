// HTTP layer: tiny router, JSON helpers, static files, security headers. No frameworks.
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSessionUser, can } from './auth.js';
import { registerRoutes } from './routes.js';

const PUBLIC_DIR = resolve(fileURLToPath(new URL('../public', import.meta.url)));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
};
const JSON_LIMIT = 2 * 1024 * 1024;
export const UPLOAD_LIMIT = 25 * 1024 * 1024;

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

class Router {
  constructor() { this.routes = []; }
  add(method, path, perm, handler, opts = {}) {
    const keys = [];
    const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    this.routes.push({ method, re, keys, perm, handler, opts });
  }
  match(method, pathname) {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params };
    }
    return pathMatched ? 'method' : null;
  }
}

function readBody(req, limit) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Request body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolvePromise(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; frame-src 'self' blob:; object-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'");
}

export function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

async function serveStatic(req, res, pathname) {
  let rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  if (rel === '' || rel === '.') rel = 'index.html';
  let file = join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403).end(); return; }
  try {
    const st = await stat(file);
    if (st.isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(PUBLIC_DIR, 'index.html'); // SPA fallback
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    res.writeHead(404).end('Not found');
  }
}

export function createApp({ db, dataDir, secureCookies = false }) {
  const router = new Router();
  registerRoutes(router, { db, dataDir, secureCookies });

  return async function handler(req, res) {
    securityHeaders(res);
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;
    if (!pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
      return serveStatic(req, res, pathname);
    }
    try {
      const found = router.match(req.method, pathname);
      if (!found) throw new HttpError(404, 'Not found');
      if (found === 'method') throw new HttpError(405, 'Method not allowed');
      const { route, params } = found;

      // CSRF defence: state-changing requests must carry a custom header (browsers block it cross-site).
      if (req.method !== 'GET' && req.headers['x-hmis'] !== '1') throw new HttpError(403, 'Missing request header');

      const cookies = parseCookies(req.headers.cookie);
      const user = getSessionUser(db, cookies.hmis_session);
      if (route.perm !== 'public') {
        if (!user) throw new HttpError(401, 'Please sign in');
        if (user.must_change_password && !route.opts.allowPasswordChange) throw new HttpError(403, 'You must change your password first');
        if (route.perm !== 'auth' && !can(user, route.perm)) throw new HttpError(403, 'You do not have permission for this action');
      }

      let body = {};
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        if (route.opts.raw) {
          body = await readBody(req, UPLOAD_LIMIT);
        } else {
          const buf = await readBody(req, JSON_LIMIT);
          if (buf.length) {
            try { body = JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON'); }
            if (body === null || typeof body !== 'object') throw new HttpError(400, 'Invalid JSON');
          }
        }
      }

      const ip = req.socket.remoteAddress;
      const ctx = {
        req, res, params, body, user, ip, db,
        query: Object.fromEntries(url.searchParams),
        token: cookies.hmis_session,
        can: (p) => can(user, p),
        audit: (action, entity, entityId, patientId, detail) => db.run(
          'INSERT INTO audit (user_id, action, entity, entity_id, patient_id, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?)',
          user ? user.id : null, action, entity, entityId ?? null, patientId ?? null, detail ?? null, ip),
      };
      const result = await route.handler(ctx);
      if (!res.writableEnded && !res.headersSent) sendJson(res, 200, result ?? { ok: true });
    } catch (err) {
      if (res.headersSent) { res.destroy(); return; }
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
      if (err && /constraint failed/i.test(err.message || '')) {
        return sendJson(res, 409, { error: /UNIQUE/i.test(err.message) ? 'A record with that value already exists' : 'Invalid data: ' + err.message });
      }
      console.error(err);
      sendJson(res, 500, { error: 'Internal server error' });
    }
  };
}
