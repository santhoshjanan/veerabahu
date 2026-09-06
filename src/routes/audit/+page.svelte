<script lang="ts">
  import { goto } from '$app/navigation';
  import { page as pageStore } from '$app/stores';
  import { onMount } from 'svelte';
  import { startAutoRefresh } from '$lib/client/auto-refresh';
  import Masthead from '$lib/components/Masthead.svelte';
  import LogTable from '$lib/components/LogTable.svelte';
  import Pagination from '$lib/components/Pagination.svelte';
  import Select from '$lib/components/Select.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import RelativeTime from '$lib/components/RelativeTime.svelte';
  import { formatCount } from '$lib/format';

  let { data } = $props();

  const result = $derived(data.result);
  const event = $derived(data.event);
  const actor = $derived(data.actor);

  onMount(() => startAutoRefresh());

  const EVENT_OPTIONS = [
    { value: '', label: 'All events' },
    { value: 'domain.transition', label: 'domain.transition' },
    { value: 'decision.approve', label: 'decision.approve' },
    { value: 'decision.reject', label: 'decision.reject' },
    { value: 'assess.error', label: 'assess.error' },
    { value: 'allowlist.add', label: 'allowlist.add' },
    { value: 'allowlist.remove', label: 'allowlist.remove' }
  ];
  const ACTOR_OPTIONS = [
    { value: '', label: 'Any actor' },
    { value: 'user', label: 'user' },
    { value: 'system', label: 'system' },
    { value: 'metadefender', label: 'metadefender' },
    { value: 'ai', label: 'ai' },
    { value: 'virustotal', label: 'virustotal' },
    { value: 'curated_list', label: 'curated_list' }
  ];

  function apply(next: { event: string; actor: string }) {
    const q = new URLSearchParams($pageStore.url.searchParams);
    for (const [k, v] of Object.entries(next)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    q.delete('page'); // any filter change resets to page 1
    void goto(`/audit?${q.toString()}`, { keepFocus: true, noScroll: true });
  }
</script>

<Masthead
  title="Accession register — audit log"
  counts={[{ label: 'Entries', value: formatCount(result.total) }]}
/>

<div class="filters">
  <Select
    name="event"
    label="Event"
    value={event}
    options={EVENT_OPTIONS}
    onchange={(v) => apply({ event: v, actor })}
  />
  <Select
    name="actor"
    label="Actor"
    value={actor}
    options={ACTOR_OPTIONS}
    onchange={(v) => apply({ event, actor: v })}
  />
</div>

{#if result.items.length === 0}
  <EmptyState title="No audit entries match" hint="Clear the filters to see the whole register.">
    <a href="/audit">Clear filters</a>
  </EmptyState>
{:else}
  <LogTable columns={['Time', 'Event', 'Actor', 'Domain', 'Detail']}>
    {#each result.items as e (e.id)}
      <tr>
        <td><RelativeTime at={e.at} /></td>
        <td class="mono">{e.event}</td>
        <td class="mono">{e.actor}</td>
        <td class="mono dom">{e.domain ?? '—'}</td>
        <td><pre class="data">{JSON.stringify(e.data)}</pre></td>
      </tr>
    {/each}
  </LogTable>
  <Pagination page={result.page} pageCount={result.pageCount} />
{/if}

<style>
  .filters {
    display: flex;
    gap: var(--vb-s4);
    align-items: flex-end;
    margin-bottom: var(--vb-s4);
    flex-wrap: wrap;
  }
  .mono {
    font-family: var(--vb-font-mono);
  }
  .dom {
    color: var(--vb-accent);
    word-break: break-all;
  }
  .data {
    margin: 0;
    font-size: var(--vb-fs-micro);
    color: var(--vb-ink-soft);
    white-space: pre-wrap;
    word-break: break-all;
    max-width: 320px;
  }
</style>
