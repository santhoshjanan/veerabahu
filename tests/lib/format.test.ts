import { describe, expect, it } from 'vitest';
import {
  relativeTime,
  formatDuration,
  scoreLabel,
  stateLabel,
  stateStampText,
  verdictLabel,
  formatCount,
  formatUsd
} from '../../src/lib/format';

const T0 = 1_700_000_000_000;

describe('relativeTime', () => {
  it('handles the recent past and missing values', () => {
    expect(relativeTime(T0, T0 + 10_000)).toBe('just now');
    expect(relativeTime(T0, T0 + 3 * 60_000)).toBe('3m ago');
    expect(relativeTime(T0, T0 + 5 * 3_600_000)).toBe('5h ago');
    expect(relativeTime(T0, T0 + 2 * 86_400_000)).toBe('2d ago');
    expect(relativeTime(0, T0)).toBe('never');
    expect(relativeTime(null, T0)).toBe('never');
  });
});

describe('formatDuration', () => {
  it('formats or reports drained', () => {
    expect(formatDuration(null)).toBe('drained');
    expect(formatDuration(0)).toBe('drained');
    expect(formatDuration(4 * 60_000)).toBe('~4m');
    expect(formatDuration(3 * 3_600_000)).toBe('~3h');
    expect(formatDuration(28 * 3_600_000)).toBe('~1d 4h');
  });
});

describe('scoreLabel', () => {
  it('buckets the score', () => {
    expect(scoreLabel(null)).toEqual({ text: '—', tone: 'none' });
    expect(scoreLabel(-0.8).tone).toBe('block');
    expect(scoreLabel(-0.2).text).toBe('leans block');
    expect(scoreLabel(0).tone).toBe('mixed');
    expect(scoreLabel(0.3).text).toBe('leans allow');
    expect(scoreLabel(0.9).text).toBe('strong allow');
  });
});

describe('label helpers', () => {
  it('maps states and verdicts', () => {
    expect(stateLabel('pending_review')).toBe('Awaiting decision');
    expect(stateStampText('approved')).toBe('BLOCKED');
    expect(stateStampText('rejected')).toBe('KEPT');
    expect(verdictLabel('unsure')).toBe('Unsure');
  });
});

describe('number helpers', () => {
  it('formats counts and money', () => {
    expect(formatCount(1234)).toBe('1,234');
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(1.2)).toBe('$1.20');
    expect(formatUsd(0.0034)).toBe('$0.0034');
  });
});
