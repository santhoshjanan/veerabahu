import { invalidate } from '$app/navigation';

export function startAutoRefresh(ms = 20_000): () => void {
  if (typeof document === 'undefined') return () => {};
  const id = setInterval(() => {
    if (document.visibilityState === 'visible') void invalidate('vb:data');
  }, ms);
  return () => clearInterval(id);
}
