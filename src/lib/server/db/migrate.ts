import { db, dialect } from './index';

export async function runMigrations(): Promise<void> {
  if (dialect === 'pg') {
    const { migrate } = await import('drizzle-orm/postgres-js/migrator');
    await migrate(db, { migrationsFolder: './drizzle/pg' });
  } else {
    const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
    migrate(db, { migrationsFolder: './drizzle/sqlite' });
  }
}

// Allow `node --import tsx src/lib/server/db/migrate.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations().then(() => {
    console.log('migrations applied');
    process.exit(0);
  });
}
