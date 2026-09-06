import { db, schema } from '$lib/server/db/index';
import { listDomains } from '$lib/server/pipeline/domains';
import { DOMAIN_STATES } from '$lib/server/db/types';
import type { DomainState } from '$lib/server/db/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, depends }) => {
  depends('vb:data');
  const search = url.searchParams.get('search')?.trim() ?? '';
  const stateParam = url.searchParams.get('state') ?? '';
  const state = (DOMAIN_STATES as string[]).includes(stateParam)
    ? (stateParam as DomainState)
    : undefined;
  const page = Number(url.searchParams.get('page') ?? '1') || 1;
  const result = await listDomains(db, schema, {
    search: search || undefined,
    state,
    page
  });
  return { result, search, state: stateParam };
};
