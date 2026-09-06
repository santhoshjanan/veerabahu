<script lang="ts">
  import { page } from '$app/stores';
  let {
    page: current,
    pageCount,
    param = 'page'
  }: { page: number; pageCount: number; param?: string } = $props();

  function href(n: number): string {
    const q = new URLSearchParams($page.url.searchParams);
    q.set(param, String(n));
    return `?${q.toString()}`;
  }
</script>

{#if pageCount > 1}
  <nav class="pg" aria-label="pagination">
    {#if current > 1}
      <a href={href(current - 1)} rel="prev" data-sveltekit-noscroll>‹ prev</a>
    {:else}
      <span class="disabled">‹ prev</span>
    {/if}
    <span class="count">{current} of {pageCount}</span>
    {#if current < pageCount}
      <a href={href(current + 1)} rel="next" data-sveltekit-noscroll>next ›</a>
    {:else}
      <span class="disabled">next ›</span>
    {/if}
  </nav>
{/if}

<style>
  .pg {
    display: flex;
    align-items: center;
    gap: var(--vb-s4);
    justify-content: flex-end;
    margin-top: var(--vb-s4);
    font: var(--vb-fs-small) / 1 var(--vb-font-mono);
  }
  .pg a {
    color: var(--vb-accent);
    text-decoration: none;
  }
  .pg a:hover {
    text-decoration: underline;
  }
  .disabled {
    color: var(--vb-ink-faint);
  }
  .count {
    color: var(--vb-ink-soft);
  }
</style>
