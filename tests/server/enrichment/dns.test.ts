import { describe, it, expect } from 'vitest';
import { makeDnsLookup } from '$lib/server/enrichment/dns';

describe('makeDnsLookup', () => {
  it('collects A / CNAME / NS and caches within TTL', async () => {
    let calls = 0;
    const resolver = {
      resolve4: async () => { calls++; return ['1.2.3.4']; },
      resolveCname: async () => ['cdn.example.net'],
      resolveNs: async () => ['ns1.example.net']
    };
    const lookup = makeDnsLookup({ resolver, ttlMs: 10_000 });
    const a = await lookup('x.com');
    expect(a).toEqual({ a: ['1.2.3.4'], cname: ['cdn.example.net'], ns: ['ns1.example.net'] });
    await lookup('x.com');
    expect(calls).toBe(1);                      // cached
  });

  it('tolerates per-record failures (returns empty arrays, not null)', async () => {
    const resolver = {
      resolve4: async () => { throw new Error('ENOTFOUND'); },
      resolveCname: async () => { throw new Error('ENODATA'); },
      resolveNs: async () => ['ns1.example.net']
    };
    const lookup = makeDnsLookup({ resolver });
    expect(await lookup('x.com')).toEqual({ a: [], cname: [], ns: ['ns1.example.net'] });
  });
});
