import type { Handle } from '@sveltejs/kit';
import { db, schema } from '$lib/server/db/index';
import { runMigrations } from '$lib/server/db/migrate';
import {
  getSession,
  requireConfiguredAdmin,
  SESSION_COOKIE
} from '$lib/server/auth';
import { parseMasterKey } from '$lib/server/settings/crypto';
import {
  getStoredSettings,
  importEnvironmentOnce
} from '$lib/server/settings/store';
import { runtime } from '$lib/server/settings/runtime';

let initialization: Promise<void> | null = null;

async function initializeOnce() {
  await runMigrations();
  const key = parseMasterKey(process.env.VB_MASTER_KEY ?? '');
  await importEnvironmentOnce(db, schema, key, process.env);
  try {
    await runtime.startIfActive();
  } catch (error) {
    console.error('background startup failed', error);
  }
}

function initialize() {
  if (!initialization) {
    initialization = initializeOnce().catch((error) => {
      initialization = null;
      throw error;
    });
  }
  return initialization;
}

const isPublic = (pathname: string, onboardingComplete: boolean) =>
  (!onboardingComplete &&
    (pathname === '/setup' || pathname.startsWith('/setup/'))) ||
  pathname === '/login' ||
  pathname.startsWith('/login/') ||
  pathname === '/blocklist.txt' ||
  pathname.startsWith('/_app/');

export const handle: Handle = async ({ event, resolve }) => {
  await initialize();
  const token = event.cookies.get(SESSION_COOKIE);
  const session = token ? await getSession(db, schema, token) : null;
  event.locals.adminSession = session;
  if (token && !session) event.cookies.delete(SESSION_COOKIE, { path: '/' });

  const settings = await getStoredSettings(db, schema);
  if (!isPublic(event.url.pathname, !!settings?.onboardingComplete)) {
    requireConfiguredAdmin(settings, session);
  }
  return resolve(event);
};
