import { eq } from 'drizzle-orm';
import { now } from '../time';
import { NO_LIMITS, type AssessmentInput, type ReputationSource, type SourceVerdict } from './types';

export function parseListText(text: string): string[] {
  const out = new Set<string>();
  for (const lineRaw of text.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    let domain: string | null = null;
    if (line.startsWith('||')) {
      const m = line.match(/^\|\|([a-z0-9._-]+)\^/i);
      domain = m?.[1] ?? null;
    } else if (/\s/.test(line)) {
      const parts = line.split(/\s+/);
      domain = parts[1] ?? null; // "0.0.0.0 domain"
    } else {
      domain = line;
    }
    if (!domain) continue;
    domain = domain.toLowerCase().replace(/\.$/, '');
    if (domain === 'localhost' || domain === 'local' || !domain.includes('.')) continue;
    out.add(domain);
  }
  return [...out];
}

function listName(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname + u.pathname;
  } catch {
    return url;
  }
}

export function makeCuratedListSource(
  db: any,
  schema: any,
  opts: { urls: string[]; fetchImpl?: typeof fetch }
): ReputationSource & {
  refresh(): Promise<void>;
  loadFromDb(): Promise<void>;
  has(domain: string): boolean;
} {
  const doFetch = opts.fetchImpl ?? fetch;
  let set = new Set<string>();

  const has = (domain: string): boolean => {
    const d = domain.toLowerCase().replace(/\.$/, '');
    const labels = d.split('.');
    for (let i = 0; i < labels.length - 1; i++) {
      if (set.has(labels.slice(i).join('.'))) return true;
    }
    return false;
  };

  async function refresh(): Promise<void> {
    const next = new Set<string>();
    const perList: Array<{
      name: string;
      url: string;
      domains: string[];
      error: string | null;
    }> = [];

    for (const url of opts.urls) {
      const name = listName(url);
      try {
        const res = await doFetch(url);
        if (!res.ok) {
          perList.push({ name, url, domains: [], error: `HTTP ${res.status}` });
          continue;
        }
        const domains = parseListText(await res.text());
        domains.forEach((d) => next.add(d));
        perList.push({ name, url, domains, error: null });
      } catch (e) {
        perList.push({ name, url, domains: [], error: (e as Error).message });
      }
    }

    // keep previous set entries for any list that failed
    for (const l of perList) if (l.error) for (const d of set) next.add(d);
    set = next;

    for (const l of perList) {
      if (!l.error) {
        await db.delete(schema.curatedDomains).where(eq(schema.curatedDomains.sourceList, l.name));
        if (l.domains.length) {
          const rows = l.domains.map((domain) => ({ domain, sourceList: l.name }));
          for (let i = 0; i < rows.length; i += 500) {
            await db
              .insert(schema.curatedDomains)
              .values(rows.slice(i, i + 500))
              .onConflictDoNothing();
          }
        }
      }
      await db
        .insert(schema.curatedLists)
        .values({
          name: l.name,
          url: l.url,
          lastFetched: now(),
          entryCount: l.domains.length,
          lastError: l.error
        })
        .onConflictDoUpdate({
          target: [schema.curatedLists.name],
          set: {
            url: l.url,
            lastFetched: now(),
            entryCount: l.domains.length,
            lastError: l.error
          }
        });
    }
  }

  async function loadFromDb(): Promise<void> {
    const rows = await db.select({ domain: schema.curatedDomains.domain }).from(schema.curatedDomains);
    set = new Set(rows.map((r: { domain: string }) => r.domain));
  }

  const source: ReputationSource = {
    name: 'curated_list',
    weight: 1.0,
    limits: NO_LIMITS,
    async assess(input: AssessmentInput): Promise<SourceVerdict> {
      if (has(input.domain)) {
        return {
          verdict: 'block',
          confidence: 1,
          category: 'listed',
          detail: 'on a curated blocklist',
          raw: { matched: true }
        };
      }
      return {
        verdict: 'unsure',
        confidence: 0,
        category: null,
        detail: null,
        raw: { matched: false }
      };
    }
  };

  return Object.assign(source, { refresh, loadFromDb, has });
}
