import { subscribe } from '$lib/server/events';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
  const enc = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const push = (chunk: string) => {
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          // stream already closed; cancel() will clean up
        }
      };
      push(': connected\n\n');
      unsubscribe = subscribe((evt) =>
        push(`data: ${JSON.stringify(evt)}\n\n`)
      );
      heartbeat = setInterval(() => push(': hb\n\n'), 25_000);
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    }
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive'
    }
  });
};
