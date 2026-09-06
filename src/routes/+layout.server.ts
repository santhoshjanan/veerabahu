import { db, schema } from '$lib/server/db/index';
import { countDomainsByState, countPublished } from '$lib/server/db/repo';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ depends, locals }) => {
  depends('vb:data');
  if (!locals.adminSession) {
    return {
      authenticated: false,
      badge: { inQueue: 0, published: 0 }
    };
  }
  const [counts, published] = await Promise.all([
    countDomainsByState(db, schema),
    countPublished(db, schema)
  ]);
  return {
    authenticated: !!locals.adminSession,
    badge: { inQueue: counts.pending_review, published }
  };
};
