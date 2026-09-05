import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  publish,
  subscribe,
  getInFocus,
  _resetForTest,
  type VbEvent
} from '../../src/lib/server/events';

afterEach(() => _resetForTest());

describe('events bus', () => {
  it('delivers to every subscriber and unsubscribes cleanly', () => {
    const a: VbEvent[] = [];
    const b: VbEvent[] = [];
    const offA = subscribe((e) => a.push(e));
    subscribe((e) => b.push(e));
    publish({ type: 'decision', domain: 'x.com', decision: 'approve' });
    offA();
    publish({ type: 'decision', domain: 'y.com', decision: 'reject' });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(2);
  });

  it('isolates a throwing listener', () => {
    const seen: VbEvent[] = [];
    subscribe(() => {
      throw new Error('boom');
    });
    subscribe((e) => seen.push(e));
    expect(() =>
      publish({ type: 'decision', domain: 'z.com', decision: 'approve' })
    ).not.toThrow();
    expect(seen).toHaveLength(1);
  });

  it('tracks the in-focus domain per source', () => {
    publish({ type: 'assess.start', source: 'metadefender', domain: 'a.com' });
    publish({ type: 'assess.start', source: 'ai', domain: 'b.com' });
    expect(getInFocus()).toEqual({ metadefender: 'a.com', ai: 'b.com' });
    publish({ type: 'assess.done', source: 'metadefender', domain: 'a.com' });
    expect(getInFocus()).toEqual({ ai: 'b.com' });
  });
});
