import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';

export async function startStubPihole(opts?: {
  appPassword?: string;
  queries?: unknown[];
  sessionTtlMs?: number;
}) {
  const appPassword = opts?.appPassword ?? 'test-pw';
  const ttl = opts?.sessionTtlMs ?? 1_800_000;
  // ponytail: a tiny ttl means "force re-auth" — make it single-use instead of a
  // sub-millisecond wall clock, so the transparent-retry test isn't a localhost
  // round-trip race. Realistic ttls keep normal time-based expiry.
  const singleUse = ttl <= 100;
  let queries: unknown[] = opts?.queries ?? [];
  const sessions = new Map<string, { expiresAt: number; usesLeft: number }>();
  let authCount = 0;

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.method === 'POST' && url.pathname === '/auth') {
      let raw = '';
      for await (const c of req) raw += c;
      const pw = JSON.parse(raw || '{}').password;
      if (pw !== appPassword) return send(401, { session: { valid: false, message: 'bad password' } });
      authCount++;
      const sid = randomUUID();
      sessions.set(sid, {
        expiresAt: singleUse ? Number.MAX_SAFE_INTEGER : Date.now() + ttl,
        usesLeft: singleUse ? 1 : Infinity
      });
      return send(200, { session: { valid: true, sid, csrf: 'csrf', validity: ttl / 1000 } });
    }

    const sid = req.headers['x-ftl-sid'] as string | undefined;
    const sess = sid ? sessions.get(sid) : undefined;
    if (!sess || sess.expiresAt < Date.now() || sess.usesLeft <= 0) {
      return send(401, { session: { valid: false } });
    }
    if (sess.usesLeft !== Infinity) sess.usesLeft -= 1;

    if (url.pathname === '/queries') {
      const length = Number(url.searchParams.get('length') ?? '100');
      const cursor = url.searchParams.get('cursor');
      // rows are assumed pre-sorted newest-first with a numeric `id`
      const all = queries as Array<{ id: number }>;
      const start = cursor ? all.findIndex((q) => q.id === Number(cursor)) + 1 : 0;
      const page = all.slice(start, start + length);
      const next = start + length < all.length ? (page[page.length - 1]?.id ?? null) : null;
      return send(200, {
        queries: page,
        cursor: next,
        recordsTotal: all.length,
        recordsFiltered: all.length,
        earliest_timestamp: all.length
          ? (all[all.length - 1] as { time?: number }).time
          : Date.now() / 1000
      });
    }
    return send(404, { error: 'not found' });
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    get authCount() {
      return authCount;
    },
    setQueries(q: unknown[]) {
      queries = q;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}
