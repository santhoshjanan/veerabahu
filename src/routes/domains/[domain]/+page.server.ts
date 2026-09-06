import { error } from '@sveltejs/kit';
import { db, schema } from '$lib/server/db/index';
import { getReviewDetail } from '$lib/server/pipeline/review';
import {
  addAllowlist,
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
    const existing = await getAllowlistRow(db, schema, domain);
    if (existing) {
      await removeAllowlist(db, schema, domain);
      await appendAudit(db, schema, {
        actor: 'user',
        event: 'allowlist.remove',
        domainId: null,
        data: { domain }
      });
    } else {
      await addAllowlist(db, schema, domain, 'added from domain record', now());
      await appendAudit(db, schema, {
        actor: 'user',
        event: 'allowlist.add',
        domainId: null,
        data: { domain }
      });
    }
    return { allowlisted: !existing };
  }
};
