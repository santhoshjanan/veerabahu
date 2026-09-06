<script lang="ts">
  import type { Snippet } from 'svelte';
  let {
    title,
    hint,
    children
  }: { title: string; hint?: string; children?: Snippet } = $props();
</script>

<div class="empty">
  <p class="title">{title}</p>
  {#if hint}<p class="hint">{hint}</p>{/if}
  {#if children}<div class="action">{@render children()}</div>{/if}
</div>

<style>
  .empty { text-align: center; padding: var(--vb-s6) var(--vb-s4); color: var(--vb-ink-soft); }
  .title { font: 700 var(--vb-fs-h3) / 1.2 var(--vb-font-head); font-stretch: var(--vb-head-stretch); letter-spacing: 0.04em; text-transform: uppercase; color: var(--vb-ink); margin: 0 0 var(--vb-s2); }
  .hint { margin: 0; font-size: var(--vb-fs-small); }
  .action { margin-top: var(--vb-s4); }
</style>
