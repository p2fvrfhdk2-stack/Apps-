import http from 'node:http';
import { resolve } from 'node:path';
import { openDb } from './lib/db.js';
import { createApp } from './lib/app.js';
import { seedReference, ensureAdmin } from './lib/seed.js';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = resolve(process.env.HMIS_DATA_DIR || 'data');

const db = openDb(DATA_DIR);
seedReference(db);
const generated = ensureAdmin(db, process.env.HMIS_ADMIN_PASSWORD);
if (generated) {
  console.log('\n  First run: administrator account created');
  console.log('    username: admin');
  console.log(`    password: ${generated}`);
  console.log('  You will be asked to change it at first sign-in.\n');
}

const app = createApp({ db, dataDir: DATA_DIR, secureCookies: process.env.HMIS_SECURE_COOKIES === '1' });
const server = http.createServer(app);
server.requestTimeout = 120_000;
server.listen(PORT, HOST, () => console.log(`HMIS running on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  (data: ${DATA_DIR})`));

const shutdown = () => { server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 3000).unref(); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
