import { db, schema } from '$lib/server/db/index';
import { getQueue } from '$lib/server/pipeline/queue';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ depends }) => {
  depends('vb:data');
  return { view: await getQueue(db, schema) };
};
