import { afterEach, describe, expect, it } from 'vitest';
import { GET } from '../../../src/routes/events/+server';
import { publish, _resetForTest } from '../../../src/lib/server/events';

afterEach(() => _resetForTest());

describe('GET /events', () => {
  it('streams published events as SSE frames', async () => {
    const res = (GET as any)({});
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const reader = res.body!.getReader();
    const dec = new TextDecoder();

    const first = await reader.read();
    expect(dec.decode(first.value)).toContain(': connected');

    publish({ type: 'decision', domain: 'a.com', decision: 'approve' });
    const next = await reader.read();
    const frame = dec.decode(next.value);
    expect(frame.startsWith('data: ')).toBe(true);
    expect(JSON.parse(frame.slice(6).trim())).toEqual({
      type: 'decision',
      domain: 'a.com',
      decision: 'approve'
    });

    await reader.cancel();
  });
});
