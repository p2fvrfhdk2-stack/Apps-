// Consistent online backup of the database + copy of uploaded documents.
// Usage: npm run backup   (writes to ./backups/<timestamp>/)
import { DatabaseSync } from 'node:sqlite';
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DATA_DIR = resolve(process.env.HMIS_DATA_DIR || 'data');
const OUT = resolve(process.env.HMIS_BACKUP_DIR || 'backups', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
mkdirSync(OUT, { recursive: true });
const db = new DatabaseSync(join(DATA_DIR, 'hmis.db'));
db.exec(`VACUUM INTO '${join(OUT, 'hmis.db').replace(/'/g, "''")}'`);
db.close();
if (existsSync(join(DATA_DIR, 'uploads'))) cpSync(join(DATA_DIR, 'uploads'), join(OUT, 'uploads'), { recursive: true });
console.log(`Backup written to ${OUT}`);
