<script lang="ts">
  let {
    value = $bindable(''),
    options,
    name,
    label,
    onchange
  }: {
    value?: string;
    options: { value: string; label: string }[];
    name: string;
    label: string;
    onchange?: (v: string) => void;
  } = $props();
</script>

<label class="sel">
  <span>{label}</span>
  <select
    {name}
    bind:value
    onchange={(e) => onchange?.((e.currentTarget as HTMLSelectElement).value)}
  >
    {#each options as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
  </select>
</label>

<style>
  .sel {
    display: inline-flex;
    flex-direction: column;
    gap: 4px;
  }
  .sel span {
    font: var(--vb-fs-micro) / 1 var(--vb-font-mono);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--vb-ink-soft);
  }
  select {
    font: var(--vb-fs-small) / 1 var(--vb-font-mono);
    color: var(--vb-ink);
    background: var(--vb-ground-raised);
    border: 1px solid var(--vb-rule-strong);
    border-radius: var(--vb-radius);
    padding: 6px 8px;
  }
</style>
