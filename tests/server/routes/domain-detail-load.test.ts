import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestDb, type TestDb } from '../../helpers/test-db';

let tdb: TestDb;
beforeEach(async () => {
  tdb = await makeTestDb();
  vi.doMock('$lib/server/db/index', () => ({
    db: tdb.db,
    schema: tdb.schema,
    dialect: tdb.dialect
  }));
});
afterEach(() => {
  vi.doUnmock('$lib/server/db/index');
  vi.resetModules();
  tdb.close();
});

describe('/domains/[domain]', () => {
  it('loads a detail and 404s for the unknown', async () => {
    const { db, schema } = tdb;
    await db.insert(schema.domains).values({
      domain: 'seen.com',
      firstSeen: 1,
      lastSeen: 2,
      hitCount: 4,
      state: 'observed'
    });
    const mod =
      await import('../../../src/routes/domains/[domain]/+page.server');
    const ok = await (mod.load as any)({
      params: { domain: 'seen.com' },
      depends: vi.fn()
    });
    expect(ok.detail.domain).toBe('seen.com');
    await expect(
      (mod.load as any)({ params: { domain: 'nope.com' }, depends: vi.fn() })
    ).rejects.toMatchObject({ status: 404 });
  });

  it('toggleAllowlist audits the domain record when it adds and removes', async () => {
    const { db, schema } = tdb;
    await db.insert(schema.domains).values({
      domain: 'x.com',
      firstSeen: 1,
      lastSeen: 2,
      hitCount: 1,
      state: 'observed'
    });
    const mod =
      await import('../../../src/routes/domains/[domain]/+page.server');
    const call = () =>
      (mod.actions.toggleAllowlist as any)({ params: { domain: 'x.com' } });
    await expect(call()).resolves.toMatchObject({
      allowlist: {
        reason: 'added from domain record',
        addedAt: expect.any(Number)
      }
    });
    const { getAllowlistRow } = await import('../../../src/lib/server/db/repo');
    expect(await getAllowlistRow(db, schema, 'x.com')).toBeTruthy();
    expect(
      await db
        .select({
          event: schema.auditLog.event,
          domainId: schema.auditLog.domainId
        })
        .from(schema.auditLog)
    ).toEqual([{ event: 'allowlist.add', domainId: 1 }]);
    await call();
    expect(await getAllowlistRow(db, schema, 'x.com')).toBeUndefined();
    expect(
      await db
        .select({
          event: schema.auditLog.event,
          domainId: schema.auditLog.domainId
        })
        .from(schema.auditLog)
        .orderBy(schema.auditLog.id)
    ).toEqual([
      { event: 'allowlist.add', domainId: 1 },
      { event: 'allowlist.remove', domainId: 1 }
    ]);
  });

  it('rejects an allowlist toggle for an unknown domain', async () => {
    const mod =
      await import('../../../src/routes/domains/[domain]/+page.server');
    await expect(
      (mod.actions.toggleAllowlist as any)({ params: { domain: 'nope.com' } })
    ).rejects.toMatchObject({ status: 404 });
  });
});
