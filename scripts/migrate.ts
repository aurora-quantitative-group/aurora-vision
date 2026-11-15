import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { tigerPoolConfig } from '../src/db.ts';

const dir = fileURLToPath(new URL('../migrations/', import.meta.url));
const url = process.env.TIGER_DATABASE_URL;
if (!url) throw new Error('TIGER_DATABASE_URL is empty: put your Tiger Cloud connection string in .env');
const pool = new pg.Pool(tigerPoolConfig(url, 1));

await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
const applied = new Set((await pool.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(r => r.name));

for (const file of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
  if (applied.has(file)) continue;
  // Continuous aggregates cannot be created inside a transaction, so statements run one at a time.
  const statements = readFileSync(dir + file, 'utf8')
    .split('\n').filter(line => !line.trim().startsWith('--')).join('\n')
    .split(/;\s*\n/).map(s => s.trim()).filter(Boolean);
  for (const statement of statements) await pool.query(statement);
  await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
  console.log(`applied ${file}`);
}
console.log('migrations up to date');
await pool.end();
