import { error } from '@sveltejs/kit';
import { db, schema } from '$lib/server/db/index';
import { getReviewDetail } from '$lib/server/pipeline/review';
import {
  addAllowlist,
  getDomainByName,
  getAllowlistRow,
  removeAllowlist
} from '$lib/server/db/repo';
import { appendAudit } from '$lib/server/audit/log';
import { now } from '$lib/server/time';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, depends }) => {
  depends('vb:data');
  const detail = await getReviewDetail(db, schema, params.domain);
  if (!detail) error(404, `No record for ${params.domain}`);
  return { detail };
};

export const actions: Actions = {
  toggleAllowlist: async ({ params }) => {
    const domain = params.domain;
    const record = await getDomainByName(db, schema, domain);
    if (!record) error(404, `No record for ${domain}`);
    const existing = await getAllowlistRow(db, schema, domain);
    let allowlist: { reason: string; addedAt: number } | null = null;
    if (existing) {
      await removeAllowlist(db, schema, domain);
      await appendAudit(db, schema, {
        actor: 'user',
        event: 'allowlist.remove',
        domainId: record.id,
        data: { domain }
      });
    } else {
      allowlist = { reason: 'added from domain record', addedAt: now() };
      await addAllowlist(
        db,
        schema,
        domain,
        allowlist.reason,
        allowlist.addedAt
      );
      await appendAudit(db, schema, {
        actor: 'user',
        event: 'allowlist.add',
        domainId: record.id,
        data: { domain }
      });
    }
    return { allowlist };
  }
};
