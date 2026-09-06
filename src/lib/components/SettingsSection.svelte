<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    title,
    description,
    children
  }: {
    title: string;
    description?: string;
    children: Snippet;
  } = $props();
</script>

<section>
  <header>
    <h2>{title}</h2>
    {#if description}<p>{description}</p>{/if}
  </header>
  <div class="body">{@render children()}</div>
</section>

<style>
  section {
    border-top: 2px solid var(--vb-rule-strong);
    background: var(--vb-ground-raised);
  }
  header,
  .body {
    padding: var(--vb-s5);
  }
  header {
    border-bottom: var(--vb-line);
  }
  h2 {
    margin: 0;
    font: 700 var(--vb-fs-h1) / 1.15 var(--vb-font-head);
    font-stretch: var(--vb-head-stretch);
  }
  p {
    margin: var(--vb-s2) 0 0;
    color: var(--vb-ink-soft);
  }
</style>
