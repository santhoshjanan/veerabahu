import { Resolver } from 'node:dns/promises';
import { now } from '../time';

export interface DnsInfo { a: string[]; cname: string[]; ns: string[] }

export function makeDnsLookup(deps?: {
  resolver?: { resolve4(d: string): Promise<string[]>; resolveCname(d: string): Promise<string[]>; resolveNs(d: string): Promise<string[]> };
  ttlMs?: number;
}): (domain: string) => Promise<DnsInfo | null> {
  const resolver = deps?.resolver ?? new Resolver();
  const ttl = deps?.ttlMs ?? 3_600_000;
  const cache = new Map<string, { at: number; value: DnsInfo }>();

  const safe = async (p: Promise<string[]>): Promise<string[]> => {
    try { return await p; } catch { return []; }
  };

  return async (domain: string): Promise<DnsInfo | null> => {
    const hit = cache.get(domain);
    if (hit && now() - hit.at < ttl) return hit.value;
    try {
      const [a, cname, ns] = await Promise.all([
        safe(resolver.resolve4(domain)),
        safe(resolver.resolveCname(domain)),
        safe(resolver.resolveNs(domain))
      ]);
      const value = { a, cname, ns };
      cache.set(domain, { at: now(), value });
      return value;
    } catch {
      return null;
    }
  };
}
