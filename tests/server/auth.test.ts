import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '../helpers/test-db';
import { hashPassword, hashToken } from '../../src/lib/server/settings/crypto';

let t: TestDb;

beforeEach(async () => {
  t = await makeTestDb();
});

afterEach(() => t.close());

async function seedPassword(password: string) {
  const record = hashPassword(password);
  await t.db.insert(t.schema.localAdmin).values({
    id: 1,
    salt: record.salt,
    passwordHash: record.hash,
    createdAt: 1,
    updatedAt: 1
  });
}

describe('local admin sessions', () => {
  it('stores only a hash of an opaque token and expires it after 12 hours', async () => {
    const { createSession, getSession, SESSION_TTL_MS } =
      await import('../../src/lib/server/auth');
    const now = 1_000;
    const token = await createSession(t.db, t.schema, now);
    const [stored] = await t.db.select().from(t.schema.sessions);

    expect(stored).toMatchObject({
      tokenHash: hashToken(token),
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
      invalidatedAt: null
    });
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(await getSession(t.db, t.schema, token, now)).toEqual(stored);
    expect(
      await getSession(t.db, t.schema, token, now + SESSION_TTL_MS)
    ).toBeNull();
  });

  it('destroys only the selected session', async () => {
    const { createSession, destroySession, getSession } =
      await import('../../src/lib/server/auth');
    const first = await createSession(t.db, t.schema, 10);
    const second = await createSession(t.db, t.schema, 10);

    await destroySession(t.db, t.schema, first, 20);

    expect(await getSession(t.db, t.schema, first, 20)).toBeNull();
    expect(await getSession(t.db, t.schema, second, 20)).not.toBeNull();
  });

  it('changes the matching password and invalidates every session', async () => {
    const { changePassword, createSession, getSession, verifyAdminPassword } =
      await import('../../src/lib/server/auth');
    await seedPassword('old password');
    const token = await createSession(t.db, t.schema, 10);

    expect(
      await changePassword(t.db, t.schema, 'wrong password', 'new password')
    ).toBe(false);
    expect(await getSession(t.db, t.schema, token, 20)).not.toBeNull();
    expect(
      await changePassword(
        t.db,
        t.schema,
        Buffer.alloc(32),
        'old password',
        'new password'
      )
    ).toBe(true);
    expect(await getSession(t.db, t.schema, token, 20)).toBeNull();
    expect(await verifyAdminPassword(t.db, t.schema, 'old password')).toBe(
      false
    );
    expect(await verifyAdminPassword(t.db, t.schema, 'new password')).toBe(
      true
    );
  });
});
