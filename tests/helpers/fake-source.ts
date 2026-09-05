import type {
  ReputationSource,
  SourceLimits,
  SourceVerdict
} from '../../src/lib/server/reputation/types';

export function fakeSource(opts: {
  name: ReputationSource['name'];
  limits: SourceLimits;
  weight?: number;
  reply?: Partial<SourceVerdict> | (() => Partial<SourceVerdict> | Promise<Partial<SourceVerdict>>);
  throwErr?: string;
}): ReputationSource & { calls: string[] } {
  const calls: string[] = [];
  const src: ReputationSource = {
    name: opts.name,
    weight: opts.weight ?? 1,
    limits: opts.limits,
    async assess(input) {
      calls.push(input.domain);
      if (opts.throwErr) throw new Error(opts.throwErr);
      const base: SourceVerdict = {
        verdict: 'allow',
        confidence: 0.5,
        category: null,
        detail: null,
        raw: {}
      };
      const extra = typeof opts.reply === 'function' ? await opts.reply() : opts.reply;
      return { ...base, ...extra };
    }
  };
  return Object.assign(src, { calls });
}
