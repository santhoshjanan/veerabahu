import { eq, isNull } from 'drizzle-orm';
import { redirect } from '@sveltejs/kit';
import {
  hashPassword,
  hashToken,
  newToken,
  verifyPassword
} from './settings/crypto';
import type { SessionRow } from './db/types';

export const SESSION_COOKIE = 'vb_session';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

type MaybePromise<T> = T | PromiseLike<T>;

function then<T, U>(
  value: MaybePromise<T>,
  next: (value: T) => MaybePromise<U>
) {
  return value && typeof (value as PromiseLike<T>).then === 'function'
    ? Promise.resolve(value).then(next)
    : next(value as T);
}

function first(query: any): MaybePromise<any> {
  return typeof query.get === 'function'
    ? query.get()
    : then(query, (rows: any[]) => rows[0]);
}

function run(query: any): MaybePromise<unknown> {
  return typeof query.run === 'function' ? query.run() : query;
}

function adminQuery(db: any, schema: any) {
  return first(
    db
      .select()
      .from(schema.localAdmin)
      .where(eq(schema.localAdmin.id, 1))
      .limit(1)
  );
}

export async function hasAdmin(db: any, schema: any): Promise<boolean> {
  return !!(await adminQuery(db, schema));
}

export async function verifyAdminPassword(
  db: any,
  schema: any,
  password: string
): Promise<boolean> {
  const admin = await adminQuery(db, schema);
  return (
    !!admin &&
    verifyPassword(password, { salt: admin.salt, hash: admin.passwordHash })
  );
}

export async function changePassword(
  db: any,
  schema: any,
  currentPassword: string,
  newPassword: string
): Promise<boolean>;
export async function changePassword(
  db: any,
  schema: any,
  key: Buffer,
  currentPassword: string,
  newPassword: string
): Promise<boolean>;
export async function changePassword(
  db: any,
  schema: any,
  ...args: [string, string] | [Buffer, string, string]
): Promise<boolean> {
  const [currentPassword, newPassword] =
    args.length === 2 ? args : [args[1], args[2]];
  if (!newPassword) throw new Error('Password must not be empty');
  const record = hashPassword(newPassword);
  const at = Date.now();

  return await db.transaction((tx: any) =>
    then(adminQuery(tx, schema), (admin) => {
      if (
        !admin ||
        !verifyPassword(currentPassword, {
          salt: admin.salt,
          hash: admin.passwordHash
        })
      )
        return false;
      return then(
        run(
          tx
            .update(schema.localAdmin)
            .set({
              salt: record.salt,
              passwordHash: record.hash,
              updatedAt: at
            })
            .where(eq(schema.localAdmin.id, 1))
        ),
        () =>
          then(
            run(
              tx
                .update(schema.sessions)
                .set({ invalidatedAt: at })
                .where(isNull(schema.sessions.invalidatedAt))
            ),
            () => true
          )
      );
    })
  );
}

export async function createSession(
  db: any,
  schema: any,
  now = Date.now()
): Promise<string> {
  const token = newToken();
  await db.insert(schema.sessions).values({
    tokenHash: hashToken(token),
    expiresAt: now + SESSION_TTL_MS,
    createdAt: now,
    invalidatedAt: null
  });
  return token;
}

export async function getSession(
  db: any,
  schema: any,
  token: string,
  now = Date.now()
): Promise<SessionRow | null> {
  const session = await first(
    db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.tokenHash, hashToken(token)))
      .limit(1)
  );
  return session && session.invalidatedAt === null && session.expiresAt > now
    ? session
    : null;
}

export async function destroySession(
  db: any,
  schema: any,
  token: string,
  now = Date.now()
): Promise<void> {
  await db
    .update(schema.sessions)
    .set({ invalidatedAt: now })
    .where(eq(schema.sessions.tokenHash, hashToken(token)));
}

export function requireAdmin(session: SessionRow | null): SessionRow {
  if (!session) redirect(303, '/login');
  return session;
}

export function requireConfiguredAdmin(
  settings: { onboardingComplete: boolean } | null,
  session: SessionRow | null
): SessionRow {
  if (!settings?.onboardingComplete) redirect(303, '/setup');
  return requireAdmin(session);
}
