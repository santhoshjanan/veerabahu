import { db, schema } from '$lib/server/db/index';
import { getDashboard } from '$lib/server/pipeline/dashboard';
import { listReview } from '$lib/server/pipeline/review';
import { listRecentBlocklistFetches } from '$lib/server/db/repo';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ depends }) => {
  depends('vb:data');
  const [view, queueTop, fetches] = await Promise.all([
    getDashboard(db, schema),
    listReview(db, schema, 5, 0),
    listRecentBlocklistFetches(db, schema, 1)
  ]);
  return { view, queueTop, lastPullAt: fetches[0]?.at ?? null };
};
