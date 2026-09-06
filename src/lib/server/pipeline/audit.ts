import * as repo from '../db/repo';

export const AUDIT_PAGE_SIZE = 50;

export interface AuditEntry {
  id: number;
  at: number;
  actor: string;
  event: string;
  domain: string | null;
  data: unknown;
}

export interface AuditListResult {
  items: AuditEntry[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
}

export async function listAudit(
  db: any,
  schema: any,
  opts: {
    event?: string;
    actor?: string;
    since?: number;
    until?: number;
    page?: number;
  }
): Promise<AuditListResult> {
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const filter = {
    event: opts.event || undefined,
    actor: opts.actor || undefined,
    since: opts.since,
    until: opts.until
  };
  const [rows, total] = await Promise.all([
    repo.listAuditRows(db, schema, {
      ...filter,
      limit: AUDIT_PAGE_SIZE,
      offset: (page - 1) * AUDIT_PAGE_SIZE
    }),
    repo.countAuditRows(db, schema, filter)
  ]);
  return {
    items: rows.map((r) => ({
      id: r.id,
      at: r.at,
      actor: r.actor,
      event: r.event,
      domain: r.domain,
      data: r.data
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)),
    pageSize: AUDIT_PAGE_SIZE
  };
}
