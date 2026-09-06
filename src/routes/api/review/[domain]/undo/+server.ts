import { json, error } from '@sveltejs/kit';
import { db, schema } from '$lib/server/db/index';
import { undoDecision } from '$lib/server/pipeline/review';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params }) => {
  const result = await undoDecision(db, schema, params.domain!.toLowerCase().trim());
  if (!result.ok) throw error(result.code, result.message);
  return json(result);
};
