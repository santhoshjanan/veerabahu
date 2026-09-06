import type { SourceLimits } from '../reputation/types';

export interface RateRow {
  source: string;
  tokens: number;
  lastRefill: number;
  dayCount: number;
  dayStart: number;
  monthCount: number;
  monthStart: number;
  lastCallAt: number | null;
  pausedUntil: number | null;
}

export const startOfUtcDay = (ms: number) => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};
const startOfUtcMonth = (ms: number) => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
};

export function initialRow(source: string, nowMs: number): RateRow {
  return {
    source,
    tokens: Infinity,
    lastRefill: nowMs,
    dayCount: 0,
    dayStart: startOfUtcDay(nowMs),
    monthCount: 0,
    monthStart: startOfUtcMonth(nowMs),
    lastCallAt: null,
    pausedUntil: null
  };
}

export function amortizedInterval(l: SourceLimits): number {
  return Math.max(
    l.perMinute ? 60_000 / l.perMinute : 0,
    l.perDay ? 86_400_000 / l.perDay : 0,
    l.perMonth ? (31 * 86_400_000) / l.perMonth : 0
  );
}

export function refill(s: RateRow, l: SourceLimits, nowMs: number): RateRow {
  if (l.perMinute == null) return { ...s, tokens: Infinity, lastRefill: nowMs };
  const elapsed = Math.max(0, nowMs - s.lastRefill);
  const gained = (elapsed / 60_000) * l.perMinute;
  return {
    ...s,
    tokens: Math.min(l.perMinute, s.tokens + gained),
    lastRefill: nowMs
  };
}

export function rolloverCounters(s: RateRow, nowMs: number): RateRow {
  let n = s;
  if (startOfUtcDay(nowMs) !== s.dayStart) {
    n = {
      ...n,
      dayCount: 0,
      dayStart: startOfUtcDay(nowMs),
      pausedUntil: null
    };
  }
  if (startOfUtcMonth(nowMs) !== s.monthStart) {
    n = { ...n, monthCount: 0, monthStart: startOfUtcMonth(nowMs) };
  }
  return n;
}

export function nextCallAt(s: RateRow, l: SourceLimits, nowMs: number): number {
  const bucketReadyAt =
    s.tokens >= 1 ? nowMs : s.lastRefill + 60_000 / (l.perMinute ?? 1);
  // No prior call => no spacing constraint. (Brief's `(lastCallAt ?? 0) + interval`
  // would make the first call for a low-perDay source unreachable when nowMs, as an
  // absolute epoch value, is smaller than the amortized interval — see drainer tests.)
  const amortReadyAt =
    s.lastCallAt == null ? 0 : s.lastCallAt + amortizedInterval(l);
  return Math.max(bucketReadyAt, amortReadyAt);
}

export function canCall(
  s: RateRow,
  l: SourceLimits,
  nowMs: number,
  dailyCost = 0
):
  | { ok: true }
  | {
      ok: false;
      reason: 'minute' | 'day' | 'month' | 'cost' | 'paused' | 'wait';
    } {
  if (s.pausedUntil != null && nowMs < s.pausedUntil)
    return { ok: false, reason: 'paused' };
  if (l.perDay != null && s.dayCount >= l.perDay)
    return { ok: false, reason: 'day' };
  if (l.perMonth != null && s.monthCount >= l.perMonth)
    return { ok: false, reason: 'month' };
  if (l.dailyCostCeiling != null && dailyCost >= l.dailyCostCeiling)
    return { ok: false, reason: 'cost' };
  if (l.perMinute != null && s.tokens < 1)
    return { ok: false, reason: 'minute' };
  if (nowMs < nextCallAt(s, l, nowMs)) return { ok: false, reason: 'wait' };
  return { ok: true };
}

export function afterCall(s: RateRow, l: SourceLimits, nowMs: number): RateRow {
  const tokens = l.perMinute == null ? Infinity : Math.max(0, s.tokens - 1);
  return {
    ...s,
    tokens,
    lastCallAt: nowMs,
    dayCount: s.dayCount + 1,
    monthCount: s.monthCount + 1
  };
}
