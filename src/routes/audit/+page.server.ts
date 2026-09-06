import { db, schema } from '$lib/server/db/index';
import { listAudit } from '$lib/server/pipeline/audit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, depends }) => {
  depends('vb:data');
  const event = url.searchParams.get('event') ?? '';
  const actor = url.searchParams.get('actor') ?? '';
  const page = Number(url.searchParams.get('page')) || 1;
  const result = await listAudit(db, schema, {
    event: event || undefined,
    actor: actor || undefined,
    page
  });
  return { result, event, actor };
};
