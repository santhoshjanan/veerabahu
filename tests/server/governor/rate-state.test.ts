import { describe, it, expect } from 'vitest';
import {
  amortizedInterval,
  nextCallAt,
  canCall,
  afterCall,
  refill,
  rolloverCounters,
  initialRow
} from '$lib/server/governor/rate-state';

const VT = { perMinute: 4, perDay: 500 };
const AI = { perMinute: null, perDay: null };

describe('amortizedInterval', () => {
  it('uses the strictest configured quota interval', () => {
    expect(
      amortizedInterval({ perMinute: 4, perDay: 500, perMonth: 15_500 })
    ).toBe(172_800);
    expect(
      amortizedInterval({ perMinute: null, perDay: null, perMonth: 31 })
    ).toBe(86_400_000);
  });

  it('spaces calls across the day', () => {
    expect(amortizedInterval(VT)).toBe(86_400_000 / 500); // 172_800 ms
    expect(amortizedInterval({ perMinute: null, perDay: null })).toBe(0);
  });
});

describe('nextCallAt', () => {
  it('is gated by the amortized interval after a recent call', () => {
    const s = { ...initialRow('virustotal', 0), tokens: 4, lastCallAt: 1_000 };
    expect(nextCallAt(s, VT, 2_000)).toBe(1_000 + 172_800);
  });
});

describe('canCall', () => {
  it('blocks when the daily count is exhausted', () => {
    const s = { ...initialRow('virustotal', 0), tokens: 4, dayCount: 500 };
    expect(canCall(s, VT, 10_000)).toEqual({ ok: false, reason: 'day' });
  });
  it('blocks while paused', () => {
    const s = { ...initialRow('ai', 0), pausedUntil: 10_000 };
    expect(canCall(s, AI, 5_000)).toEqual({ ok: false, reason: 'paused' });
  });
  it('blocks when the monthly count is exhausted', () => {
    const s = { ...initialRow('virustotal', 0), monthCount: 15_500 };
    expect(canCall(s, { ...VT, perMonth: 15_500 }, 10_000)).toEqual({
      ok: false,
      reason: 'month'
    });
  });
  it('blocks when the daily cost ceiling is exhausted', () => {
    const s = initialRow('ai', 0);
    expect(canCall(s, { ...AI, dailyCostCeiling: 1 }, 10_000, 1)).toEqual({
      ok: false,
      reason: 'cost'
    });
  });
  it('allows when a token is available and enough time has passed', () => {
    const s = { ...initialRow('virustotal', 0), tokens: 4, lastCallAt: null };
    expect(canCall(s, VT, 1_000_000)).toEqual({ ok: true });
  });
});

describe('afterCall', () => {
  it('decrements tokens, bumps counters, sets lastCallAt', () => {
    const s = { ...initialRow('virustotal', 0), tokens: 4 };
    const n = afterCall(s, VT, 5_000);
    expect(n).toMatchObject({
      tokens: 3,
      dayCount: 1,
      monthCount: 1,
      lastCallAt: 5_000
    });
  });
});

describe('refill', () => {
  it('adds perMinute tokens per minute, capped at capacity', () => {
    const s = { ...initialRow('virustotal', 0), tokens: 0, lastRefill: 0 };
    expect(refill(s, VT, 30_000).tokens).toBeCloseTo(2); // half a minute => 2 of 4
    expect(refill(s, VT, 600_000).tokens).toBe(4); // capped
  });
});

describe('rolloverCounters', () => {
  it('resets dayCount and clears pausedUntil when day boundary is crossed', () => {
    const day1 = Date.UTC(2026, 8, 5, 12, 0, 0);
    const day2 = Date.UTC(2026, 8, 6, 1, 0, 0);
    const s = {
      ...initialRow('virustotal', day1),
      dayCount: 500,
      pausedUntil: day1 + 1000
    };
    const rolled = rolloverCounters(s, day2);
    expect(rolled.dayCount).toBe(0);
    expect(rolled.pausedUntil).toBeNull();
  });
});
