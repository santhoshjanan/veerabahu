import { fail, redirect } from '@sveltejs/kit';
import { db, schema } from '$lib/server/db/index';
import {
  createSession,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  verifyAdminPassword
} from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
  if (locals.adminSession) redirect(303, '/');
};

export const actions: Actions = {
  default: async ({ request, cookies, url }) => {
    const password = String((await request.formData()).get('password') ?? '');
    if (!(await verifyAdminPassword(db, schema, password))) {
      return fail(400, { invalid: true });
    }

    cookies.set(SESSION_COOKIE, await createSession(db, schema), {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      secure: url.protocol === 'https:',
      maxAge: SESSION_TTL_MS / 1000
    });
    redirect(303, '/');
  }
};
