import { db, schema } from '$lib/server/db/index';
import { listReview } from '$lib/server/pipeline/review';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  return { items: await listReview(db, schema, 100, 0) };
};
