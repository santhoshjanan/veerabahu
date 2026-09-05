import { createHash } from 'node:crypto';
import { now } from '../time';
import { listApprovedDomains, logBlocklistFetch } from '../db/repo';

export function renderBlocklist(domains: string[], generatedAt: number): string {
  const sorted = [...domains].sort();
  const header = `# Veerabahu blocklist — generated ${new Date(generatedAt).toISOString()}, ${sorted.length} domains`;
  return [header, ...sorted].join('\n') + '\n';
}

export function computeEtag(domains: string[]): string {
  const sorted = [...domains].sort();
  const sha = createHash('sha1').update(sorted.join('\n')).digest('hex');
  return `W/"${sha}-${sorted.length}"`;
}

export async function buildBlocklistResponse(
  db: any,
  schema: any,
  req: { ifNoneMatch: string | null; ip: string; userAgent: string | null }
): Promise<{ status: 200 | 304; body: string; headers: Record<string, string> }> {
  const domains = await listApprovedDomains(db, schema);
  const etag = computeEtag(domains);
  const at = now();

  if (req.ifNoneMatch && req.ifNoneMatch === etag) {
    await logBlocklistFetch(db, schema, { at, ip: req.ip, userAgent: req.userAgent, status: 304 });
    return { status: 304, body: '', headers: { ETag: etag, 'Cache-Control': 'no-cache' } };
  }

  const body = renderBlocklist(domains, at);
  await logBlocklistFetch(db, schema, { at, ip: req.ip, userAgent: req.userAgent, status: 200 });
  return {
    status: 200,
    body,
    headers: {
      ETag: etag,
      'Content-Type': 'text/plain; charset=utf-8',
      'Last-Modified': new Date(at).toUTCString(),
      'Cache-Control': 'no-cache'
    }
  };
}
