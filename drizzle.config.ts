import { defineConfig } from 'drizzle-kit';

const url = process.env.VB_DATABASE_URL || 'file:./data/veerabahu.db';
const isPg = url.startsWith('postgres');

export default defineConfig({
  dialect: isPg ? 'postgresql' : 'sqlite',
  schema: isPg ? './src/lib/server/db/schema.pg.ts' : './src/lib/server/db/schema.sqlite.ts',
  out: isPg ? './drizzle/pg' : './drizzle/sqlite',
  dbCredentials: { url }
});
