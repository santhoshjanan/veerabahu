import { db, schema } from '$lib/server/db/index';
import { buildBlocklistResponse } from '$lib/server/publisher/blocklist';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request, getClientAddress }) => {
  const r = await buildBlocklistResponse(db, schema, {
    ifNoneMatch: request.headers.get('if-none-match'),
    ip: getClientAddress(),
    userAgent: request.headers.get('user-agent')
  });
  return new Response(r.status === 304 ? null : r.body, {
    status: r.status,
    headers: r.headers
  });
};
