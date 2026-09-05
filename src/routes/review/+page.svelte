<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';

  let { data } = $props();

  async function decide(domain: string, decision: 'approve' | 'reject') {
    await fetch(`/api/review/${encodeURIComponent(domain)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision })
    });
    await invalidateAll();
  }

  onMount(() => {
    const interval = setInterval(() => invalidateAll(), 15000);
    return () => clearInterval(interval);
  });
</script>

<h1>Review queue ({data.items.length})</h1>
<table border="1" cellpadding="4">
  <thead>
    <tr><th>domain</th><th>score</th><th>hits</th><th>clients</th><th>verdicts</th><th></th></tr>
  </thead>
  <tbody>
    {#each data.items as it (it.domain)}
      <tr>
        <td>{it.domain}</td>
        <td>{it.score ?? '—'}</td>
        <td>{it.hitCount}</td>
        <td>{it.distinctClientCount}</td>
        <td>
          {#each it.verdicts as v}
            <div>{v.source}: {v.verdict} ({v.confidence}) {v.category ?? ''}</div>
          {/each}
        </td>
        <td>
          <button onclick={() => decide(it.domain, 'approve')}>block it</button>
          <button onclick={() => decide(it.domain, 'reject')}>keep it</button>
        </td>
      </tr>
    {/each}
  </tbody>
</table>
