<script lang="ts">
  import type { Snippet } from 'svelte';
  let { columns, children }: { columns: string[]; children: Snippet } = $props();
</script>

<div class="scroll">
  <table>
    <thead>
      <tr>
        {#each columns as c (c)}<th scope="col">{c}</th>{/each}
      </tr>
    </thead>
    <tbody>{@render children()}</tbody>
  </table>
</div>

<style>
  .scroll {
    overflow-x: auto;
    border: var(--vb-line);
    border-radius: var(--vb-radius);
    background: var(--vb-ground-raised);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--vb-fs-small);
  }
  th {
    text-align: left;
    font: 700 var(--vb-fs-micro) / 1 var(--vb-font-head);
    font-stretch: var(--vb-head-stretch);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--vb-ink-soft);
    padding: var(--vb-s2) var(--vb-s3);
    border-bottom: 1px solid var(--vb-rule-strong);
    white-space: nowrap;
  }
  :global(tbody td) {
    padding: var(--vb-s2) var(--vb-s3);
    border-bottom: var(--vb-line);
    vertical-align: top;
  }
  :global(tbody tr:last-child td) {
    border-bottom: 0;
  }
</style>
