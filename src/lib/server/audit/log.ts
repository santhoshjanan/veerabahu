import { now } from '../time';
import type { SourceName } from '../db/types';

export async function appendAudit(
  db: any,
  schema: any,
  e: {
    actor: 'system' | 'user' | SourceName;
    event: string;
    domainId?: number | null;
    data?: unknown;
  }
): Promise<void> {
  await db.insert(schema.auditLog).values({
    at: now(),
    actor: e.actor,
    domainId: e.domainId ?? null,
    event: e.event,
    data: e.data ?? {}
  });
}
