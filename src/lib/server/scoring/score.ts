import type { Config } from '../config';
import type { DomainState, SourceName } from '../db/types';
import type { DomainRow, VerdictRow } from '../db/repo';
import { setDomainScoreAndState, getDomainById, listVerdictsForDomain } from '../db/repo';
import { appendAudit } from '../audit/log';
import { now } from '../time';

export const SOURCE_WEIGHTS: Record<SourceName, number> = {
  curated_list: 1.0,
  metadefender: 1.0,
  ai: 0.6,
  virustotal: 1.0
};
export const AUTO_CLEAR_ABOVE = 0.6;
export const HIGH_CONFIDENCE_BLOCK_BELOW = -0.5;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function computeScore(
  verdicts: Pick<VerdictRow, 'source' | 'verdict' | 'confidence'>[]
): number | null {
  let num = 0;
  let denom = 0;
  for (const v of verdicts) {
    if (v.verdict !== 'block' && v.verdict !== 'allow') continue;
    const w = SOURCE_WEIGHTS[v.source as SourceName] ?? 0;
    const value = v.verdict === 'block' ? -1 : 1;
    num += value * v.confidence * w;
    denom += w;
  }
  if (denom === 0) return null;
  return clamp(num / denom, -1, 1);
}

const TERMINAL: DomainState[] = ['approved', 'rejected', 'auto_cleared', 'pending_review'];

export function decideState(args: {
  domain: Pick<DomainRow, 'state' | 'firstSeen' | 'score'>;
  verdicts: Pick<VerdictRow, 'source'>[];
  score: number | null;
  eligibleSourceNames: SourceName[];
  maxReviewWaitMs: number;
  nowMs: number;
}): DomainState {
  if ((TERMINAL as string[]).includes(args.domain.state)) return args.domain.state as DomainState;

  const reported = new Set(args.verdicts.map((v) => v.source));
  const allIn = args.eligibleSourceNames.every((s) => reported.has(s));

  const pastWait = args.nowMs - args.domain.firstSeen > args.maxReviewWaitMs;

  if (args.score === null) {
    // All reports so far are errors (they don't score). Promote to pending_review
    // if all eligible sources have reported or if any source reported and max wait passed,
    // otherwise the domain wedges in 'assessing' forever.
    if (allIn || (args.verdicts.length > 0 && pastWait)) return 'pending_review';
    return 'assessing';
  }
  if (allIn && args.score >= AUTO_CLEAR_ABOVE) return 'auto_cleared';
  if (allIn || pastWait) return 'pending_review';
  return 'assessing';
}

export async function evaluateDomain(
  db: any,
  schema: any,
  domainId: number,
  eligibleSourceNames: SourceName[],
  cfg: Config
): Promise<{ score: number | null; state: DomainState }> {
  const domain = await getDomainById(db, schema, domainId);
  if (!domain) throw new Error(`evaluateDomain: no domain ${domainId}`);
  const verdicts = await listVerdictsForDomain(db, schema, domainId);
  const score = computeScore(verdicts);
  const state = decideState({
    domain,
    verdicts,
    score,
    eligibleSourceNames,
    maxReviewWaitMs: cfg.maxReviewWaitMs,
    nowMs: now()
  });
  if (score !== domain.score || state !== domain.state) {
    await setDomainScoreAndState(db, schema, domainId, score, state);
    await appendAudit(db, schema, {
      actor: 'system',
      event: 'domain.transition',
      domainId,
      data: { from: domain.state, to: state, score }
    });
  }
  return { score, state };
}
