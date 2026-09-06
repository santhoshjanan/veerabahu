<script lang="ts">
  let { state }: { state: 'connecting' | 'live' | 'down' } = $props();
  const label = $derived({ connecting: 'connecting', live: 'live', down: 'reconnecting' }[state]);
</script>

<span class="sse" data-state={state} title="live updates: {label}">
  <span class="dot" aria-hidden="true"></span>{label}
</span>

<style>
  .sse { display: inline-flex; align-items: center; gap: 6px; font: var(--vb-fs-micro) / 1 var(--vb-font-mono); text-transform: uppercase; letter-spacing: 0.06em; color: var(--vb-ink-soft); }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--vb-ink-faint); }
  .sse[data-state='live'] .dot { background: var(--vb-st-approved); }
  .sse[data-state='down'] .dot { background: var(--vb-accent); }
  .sse[data-state='connecting'] .dot { background: var(--vb-st-assessing); }
</style>
