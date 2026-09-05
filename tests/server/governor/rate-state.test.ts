import { describe, it, expect } from 'vitest';
import {
  amortizedInterval,
  nextCallAt,
  canCall,
  afterCall,
  refill,
  initialRow
} from '$lib/server/governor/rate-state';

const VT = { perMinute: 4, perDay: 500 };
const AI = { perMinute: null, perDay: null };

describe('amortizedInterval', () => {
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
  it('allows when a token is available and enough time has passed', () => {
    const s = { ...initialRow('virustotal', 0), tokens: 4, lastCallAt: null };
    expect(canCall(s, VT, 1_000_000)).toEqual({ ok: true });
  });
});

describe('afterCall', () => {
  it('decrements tokens, bumps counters, sets lastCallAt', () => {
    const s = { ...initialRow('virustotal', 0), tokens: 4 };
    const n = afterCall(s, VT, 5_000);
    expect(n).toMatchObject({ tokens: 3, dayCount: 1, monthCount: 1, lastCallAt: 5_000 });
  });
});

describe('refill', () => {
  it('adds perMinute tokens per minute, capped at capacity', () => {
    const s = { ...initialRow('virustotal', 0), tokens: 0, lastRefill: 0 };
    expect(refill(s, VT, 30_000).tokens).toBeCloseTo(2); // half a minute => 2 of 4
    expect(refill(s, VT, 600_000).tokens).toBe(4); // capped
  });
});
