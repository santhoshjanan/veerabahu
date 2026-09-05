import 'dotenv/config';

const url = process.env.VB_DATABASE_URL || 'file:./data/veerabahu.db';
export const dialect: 'sqlite' | 'pg' = url.startsWith('postgres') ? 'pg' : 'sqlite';

let db: any;
let schema: any;

if (dialect === 'pg') {
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const postgres = (await import('postgres')).default;
  schema = await import('./schema.pg');
  db = drizzle(postgres(url), { schema });
} else {
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const Database = (await import('better-sqlite3')).default;
  schema = await import('./schema.sqlite');
  const { mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  const file = url.replace(/^file:/, '');
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  db = drizzle(sqlite, { schema });
}

export { db, schema };
