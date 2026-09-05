import { json } from '@sveltejs/kit';
import { db, schema } from '$lib/server/db/index';
import { listReview } from '$lib/server/pipeline/review';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
  const limit = Math.min(200, Number(url.searchParams.get('limit') ?? '50'));
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? '0'));
  return json(await listReview(db, schema, limit, offset));
};
