import { db, schema } from '$lib/server/db/index';
import { listReview } from '$lib/server/pipeline/review';
import { listRecentBlocklistFetches } from '$lib/server/db/repo';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ depends }) => {
  depends('vb:data');
  const [items, fetches] = await Promise.all([
    listReview(db, schema, 100, 0),
    listRecentBlocklistFetches(db, schema, 1)
  ]);
  return { items, lastPullAt: fetches[0]?.at ?? null };
};
