import { randomUUID } from 'node:crypto';

export interface TestDb {
  db: any;
  schema: any;
  dialect: 'sqlite' | 'pg';
  close: () => void;
}

export async function makeTestDb(): Promise<TestDb> {
  const pgUrl = process.env.TEST_DATABASE_URL;
  if (pgUrl && pgUrl.startsWith('postgres')) {
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const postgres = (await import('postgres')).default;
    const schema = await import('../../src/lib/server/db/schema.pg');
    const schemaName = `t_${randomUUID().replace(/-/g, '')}`;
    const root = postgres(pgUrl);
    await root.unsafe(`CREATE SCHEMA ${schemaName}`);
    const sql = postgres(pgUrl, { connection: { search_path: schemaName } });
    const db = drizzle(sql, { schema });
    const { migrate } = await import('drizzle-orm/postgres-js/migrator');
    await migrate(db, { migrationsFolder: './drizzle/pg' });
    return {
      db,
      schema,
      dialect: 'pg',
      close: () => {
        root.unsafe(`DROP SCHEMA ${schemaName} CASCADE`).then(() => {
          root.end();
          sql.end();
        });
      }
    };
  }

  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const Database = (await import('better-sqlite3')).default;
  const schema = await import('../../src/lib/server/db/schema.sqlite');
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  migrate(db, { migrationsFolder: './drizzle/sqlite' });
  return { db, schema, dialect: 'sqlite', close: () => sqlite.close() };
}
