import { db, schema } from '$lib/server/db/index';
import { countDomainsByState, countPublished } from '$lib/server/db/repo';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ depends }) => {
  depends('vb:data');
  const [counts, published] = await Promise.all([
    countDomainsByState(db, schema),
    countPublished(db, schema)
  ]);
  return { badge: { inQueue: counts.pending_review, published } };
};
