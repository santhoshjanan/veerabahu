import { describe, it, expect, afterEach } from 'vitest';
import { makeTestDb } from '../../helpers/test-db';
import { appendAudit } from '$lib/server/audit/log';

let closer: (() => void) | null = null;
afterEach(() => {
  closer?.();
  closer = null;
});

describe('appendAudit', () => {
  it('writes a row with actor, event, json data and a timestamp', async () => {
    const t = await makeTestDb();
    closer = t.close;
    await appendAudit(t.db, t.schema, { actor: 'system', event: 'ingest.gap', data: { missing: 42 } });
    const rows = await t.db.select().from(t.schema.auditLog);
    expect(rows).toHaveLength(1);
    expect(rows[0].actor).toBe('system');
    expect(rows[0].event).toBe('ingest.gap');
    expect(rows[0].data).toEqual({ missing: 42 });
    expect(rows[0].at).toBeGreaterThan(0);
  });

  it('defaults domainId to null and data to {}', async () => {
    const t = await makeTestDb();
    closer = t.close;
    await appendAudit(t.db, t.schema, { actor: 'user', event: 'domain.decided' });
    const [row] = await t.db.select().from(t.schema.auditLog);
    expect(row.domainId).toBeNull();
    expect(row.data).toEqual({});
  });
});
