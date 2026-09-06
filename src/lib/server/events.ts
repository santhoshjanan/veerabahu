import type { DomainState, SourceName, VerdictValue } from './db/types';

export type VbEvent =
  | { type: 'assess.start'; source: SourceName; domain: string }
  | { type: 'assess.done'; source: SourceName; domain: string }
  | {
      type: 'verdict';
      domain: string;
      source: SourceName;
      verdict: VerdictValue;
      confidence: number;
      category: string | null;
    }
  | {
      type: 'domain.state';
      domain: string;
      state: DomainState;
      score: number | null;
    }
  | { type: 'decision'; domain: string; decision: 'approve' | 'reject' };

type Listener = (evt: VbEvent) => void;

const listeners = new Set<Listener>();
const inFocus = new Map<string, string>();

export function publish(evt: VbEvent): void {
  if (evt.type === 'assess.start') inFocus.set(evt.source, evt.domain);
  else if (evt.type === 'assess.done') inFocus.delete(evt.source);
  for (const l of listeners) {
    try {
      l(evt);
    } catch (e) {
      console.error('[events] listener threw:', e);
    }
  }
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getInFocus(): Record<string, string> {
  return Object.fromEntries(inFocus);
}

export function _resetForTest(): void {
  listeners.clear();
  inFocus.clear();
}
