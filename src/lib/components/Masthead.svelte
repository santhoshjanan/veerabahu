<script lang="ts">
  let {
    title,
    counts
  }: { title: string; counts: { label: string; value: string | number }[] } = $props();
</script>

<header class="mast">
  <h1>{title}</h1>
  <dl class="counts">
    {#each counts as c (c.label)}
      <div><dt>{c.label}</dt><dd>{c.value}</dd></div>
    {/each}
  </dl>
</header>

<style>
  .mast { border-bottom: 2px solid var(--vb-rule-strong); padding-bottom: var(--vb-s3); margin-bottom: var(--vb-s5); }
  h1 { font: 700 var(--vb-fs-h1) / 1.1 var(--vb-font-head); font-stretch: var(--vb-head-stretch); letter-spacing: 0.06em; text-transform: uppercase; margin: 0 0 var(--vb-s3); }
  .counts { display: flex; flex-wrap: wrap; gap: var(--vb-s5); margin: 0; }
  .counts dt { font: var(--vb-fs-micro) / 1 var(--vb-font-mono); text-transform: uppercase; letter-spacing: 0.08em; color: var(--vb-ink-soft); margin-bottom: 4px; }
  .counts dd { font: 700 var(--vb-fs-h2) / 1 var(--vb-font-mono); margin: 0; }
</style>
