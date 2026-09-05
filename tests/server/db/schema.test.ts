import { describe, it, expect, afterEach } from 'vitest';
import { eq, getTableColumns, getTableName } from 'drizzle-orm';
import { makeTestDb } from '../../helpers/test-db';
import * as sqliteSchema from '../../../src/lib/server/db/schema.sqlite';
import * as pgSchema from '../../../src/lib/server/db/schema.pg';

let closer: (() => void) | null = null;
afterEach(() => {
  closer?.();
  closer = null;
});

describe('schema', () => {
  it('migrates and round-trips a row in every table', async () => {
    const t = await makeTestDb();
    closer = t.close;
    const { db, schema } = t;

    const [d] = await db
      .insert(schema.domains)
      .values({ domain: 'ads.example.com', firstSeen: 1, lastSeen: 1 })
      .returning();
    expect(d.id).toBeGreaterThan(0);
    expect(d.state).toBe('observed');
    expect(d.hitCount).toBe(0);

    await db.insert(schema.verdicts).values({
      domainId: d.id,
      source: 'curated_list',
      verdict: 'block',
      confidence: 1,
      raw: { list: 'oisd' },
      assessedAt: 2
    });
    const [v] = await db
      .select()
      .from(schema.verdicts)
      .where(eq(schema.verdicts.domainId, d.id));
    expect(v.raw).toEqual({ list: 'oisd' });

    await db.insert(schema.ingestState).values({ id: 1, firstRunDone: false });
    const [s] = await db.select().from(schema.ingestState);
    expect(s.firstRunDone).toBe(false);
  });

  it('rejects an invalid domain state', async () => {
    const t = await makeTestDb();
    closer = t.close;
    await expect(
      t.db.insert(t.schema.domains).values({
        domain: 'x.com',
        firstSeen: 1,
        lastSeen: 1,
        state: 'bogus' as never
      })
    ).rejects.toThrow();
  });

  it('enforces the (domain_id, source) uniqueness on verdicts', async () => {
    const t = await makeTestDb();
    closer = t.close;
    const [d] = await t.db
      .insert(t.schema.domains)
      .values({ domain: 'x.com', firstSeen: 1, lastSeen: 1 })
      .returning();
    const row = {
      domainId: d.id,
      source: 'ai' as const,
      verdict: 'allow' as const,
      confidence: 0.5,
      raw: {},
      assessedAt: 1
    };
    await t.db.insert(t.schema.verdicts).values(row);
    await expect(t.db.insert(t.schema.verdicts).values(row)).rejects.toThrow();
  });
});

describe('schema parity (sqlite vs pg)', () => {
  const tablesOf = (mod: Record<string, unknown>) => {
    const out = new Map<string, Set<string>>();
    for (const value of Object.values(mod)) {
      try {
        const name = getTableName(value as never);
        const cols = new Set(
          Object.values(getTableColumns(value as never)).map((c) => (c as { name: string }).name)
        );
        out.set(name, cols);
      } catch {
        // not a drizzle table
      }
    }
    return out;
  };

  it('has the same tables and columns in both dialects', () => {
    const sq = tablesOf(sqliteSchema);
    const pg = tablesOf(pgSchema);

    expect([...sq.keys()].sort()).toEqual([...pg.keys()].sort());

    for (const [table, sqCols] of sq) {
      const pgCols = pg.get(table)!;
      expect({ table, cols: [...sqCols].sort() }).toEqual({
        table,
        cols: [...pgCols].sort()
      });
    }
  });
});
