import { readable, type Readable } from 'svelte/store';
import { invalidate } from '$app/navigation';
import type { VbEvent } from '$lib/server/events';

export type SseState = 'connecting' | 'live' | 'down';

export interface EventStream {
  status: Readable<SseState>;
  last: Readable<VbEvent | null>;
  close: () => void;
}

export function createEventStream(): EventStream {
  if (typeof EventSource === 'undefined') {
    return {
      status: readable<SseState>('connecting'),
      last: readable<VbEvent | null>(null),
      close: () => {}
    };
  }

  let es: EventSource | null = null;
  let wasDown = false;

  const status = readable<SseState>('connecting', (set) => {
    es = new EventSource('/events');
    es.onopen = () => {
      set('live');
      if (wasDown) {
        wasDown = false;
        void invalidate('vb:data');
      }
    };
    es.onerror = () => {
      wasDown = true;
      set('down'); // the browser reconnects on its own
    };
    return () => es?.close();
  });

  const last = readable<VbEvent | null>(null, (set) => {
    const handler = (e: MessageEvent) => {
      try {
        set(JSON.parse(e.data) as VbEvent);
      } catch {
        /* heartbeat / comment line */
      }
    };
    // es is created by the status store's subscriber; guard for order
    const attach = () => es && es.addEventListener('message', handler);
    const id = setInterval(() => {
      if (es) {
        clearInterval(id);
        attach();
      }
    }, 20);
    return () => {
      clearInterval(id);
      es?.removeEventListener('message', handler);
    };
  });

  return { status, last, close: () => es?.close() };
}
