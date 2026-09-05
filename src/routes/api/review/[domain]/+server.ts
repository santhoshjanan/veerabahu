import { json, error } from "@sveltejs/kit";
import { z } from "zod";
import { db, schema } from "$lib/server/db/index";
import { getReviewDetail, decide } from "$lib/server/pipeline/review";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ params }) => {
  const domain = params.domain!.toLowerCase().trim();
  const detail = await getReviewDetail(db, schema, domain);
  if (!detail) throw error(404, "unknown domain");
  return json(detail);
};

const Body = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().max(2000).nullish(),
});

export const POST: RequestHandler = async ({ params, request }) => {
  const domain = params.domain!.toLowerCase().trim();
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    throw error(
      400,
      'body must be { decision: "approve"|"reject", note?: string }',
    );
  }
  const r = await decide(
    db,
    schema,
    domain,
    parsed.data.decision,
    parsed.data.note ?? null,
  );
  if (!r.ok) {
    throw error(r.code, r.message);
  }
  return json({ ok: true });
};
