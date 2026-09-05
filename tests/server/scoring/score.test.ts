import { describe, it, expect } from 'vitest';
import { computeScore, decideState, AUTO_CLEAR_ABOVE } from '$lib/server/scoring/score';

const v = (source: any, verdict: any, confidence: number) => ({ source, verdict, confidence });

describe('computeScore', () => {
  it('returns null when only unsure/error votes exist', () => {
    expect(computeScore([v('curated_list', 'unsure', 0), v('ai', 'error', 0)])).toBeNull();
  });
  it('a single curated block@1 gives -1', () => {
    expect(computeScore([v('curated_list', 'block', 1)])).toBe(-1);
  });
  it('averages weighted contributions over the voting sources', () => {
    // curated block@1 (w1) => -1 ; ai allow@0.5 (w0.6) => +0.3 ; denom = 1.6
    // (-1 + 0.3) / 1.6 = -0.4375
    expect(computeScore([v('curated_list', 'block', 1), v('ai', 'allow', 0.5)])).toBeCloseTo(-0.4375, 4);
  });
  it('clamps into [-1, 1]', () => {
    expect(computeScore([v('curated_list', 'block', 1), v('metadefender', 'block', 1), v('virustotal', 'block', 1)])).toBe(-1);
  });
});

describe('decideState', () => {
  const eligible = ['curated_list', 'ai'] as const;
  it('auto-clears when all eligible reported and score >= 0.6', () => {
    const s = decideState({
      domain: { state: 'assessing', firstSeen: 0, score: null },
      verdicts: [{ source: 'curated_list' }, { source: 'ai' }],
      score: 0.8, eligibleSourceNames: [...eligible], maxReviewWaitMs: 10_000, nowMs: 1_000
    });
    expect(s).toBe('auto_cleared');
    expect(AUTO_CLEAR_ABOVE).toBe(0.6);
  });
  it('goes to pending_review when a slow source is still out but max wait passed', () => {
    const s = decideState({
      domain: { state: 'assessing', firstSeen: 0, score: -0.2 },
      verdicts: [{ source: 'curated_list' }],
      score: -0.2, eligibleSourceNames: [...eligible], maxReviewWaitMs: 10_000, nowMs: 20_000
    });
    expect(s).toBe('pending_review');
  });
  it('stays assessing when score present, not all in, and within wait window', () => {
    const s = decideState({
      domain: { state: 'assessing', firstSeen: 0, score: -0.2 },
      verdicts: [{ source: 'curated_list' }],
      score: -0.2, eligibleSourceNames: [...eligible], maxReviewWaitMs: 10_000, nowMs: 5_000
    });
    expect(s).toBe('assessing');
  });
  it('escapes to pending_review when every source errored (score null) and max wait passed', () => {
    const s = decideState({
      domain: { state: 'assessing', firstSeen: 0, score: null },
      verdicts: [{ source: 'curated_list' }, { source: 'ai' }], // both error rows
      score: null, eligibleSourceNames: [...eligible], maxReviewWaitMs: 10_000, nowMs: 20_000
    });
    expect(s).toBe('pending_review');
  });
  it('promotes to pending_review when all eligible sources errored (score null) even within the wait window', () => {
    const s = decideState({
      domain: { state: 'assessing', firstSeen: 0, score: null },
      verdicts: [{ source: 'curated_list' }, { source: 'ai' }], // all eligible sources errored
      score: null, eligibleSourceNames: [...eligible], maxReviewWaitMs: 10_000, nowMs: 5_000
    });
    expect(s).toBe('pending_review');
  });
  it('stays assessing when only partial sources errored (score null) and within wait window', () => {
    const s = decideState({
      domain: { state: 'assessing', firstSeen: 0, score: null },
      verdicts: [{ source: 'curated_list' }], // 1 of 2 eligible sources errored
      score: null, eligibleSourceNames: [...eligible], maxReviewWaitMs: 10_000, nowMs: 5_000
    });
    expect(s).toBe('assessing');
  });
  it('stays assessing when score null and no source has reported yet', () => {
    const s = decideState({
      domain: { state: 'assessing', firstSeen: 0, score: null },
      verdicts: [],
      score: null, eligibleSourceNames: [...eligible], maxReviewWaitMs: 10_000, nowMs: 20_000
    });
    expect(s).toBe('assessing');
  });
  it('never downgrades a decided domain', () => {
    const s = decideState({
      domain: { state: 'approved', firstSeen: 0, score: -0.9 },
      verdicts: [{ source: 'curated_list' }, { source: 'ai' }],
      score: 0.9, eligibleSourceNames: [...eligible], maxReviewWaitMs: 1, nowMs: 999
    });
    expect(s).toBe('approved');
  });
});
