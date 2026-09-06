<script lang="ts">
  import { goto, preloadData, pushState } from '$app/navigation';
  import { page as pageStore } from '$app/stores';
  import { onMount } from 'svelte';
  import { startAutoRefresh } from '$lib/client/auto-refresh';
  import { DOMAIN_STATES } from '$lib/domain-constants';
  import Masthead from '$lib/components/Masthead.svelte';
  import LogTable from '$lib/components/LogTable.svelte';
  import Pagination from '$lib/components/Pagination.svelte';
  import Select from '$lib/components/Select.svelte';
  import StatusEdge from '$lib/components/StatusEdge.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import RelativeTime from '$lib/components/RelativeTime.svelte';
  import Sheet from '$lib/components/Sheet.svelte';
  import DomainRecord from '$lib/components/DomainRecord.svelte';
  import { stateLabel, formatCount } from '$lib/format';

  let { data } = $props();

  let sheetOpen = $state(false);
  let sheetDetail = $state<
    import('$lib/server/pipeline/review').ReviewDetail | null
  >(null);

  async function openSheet(e: MouseEvent, domain: string) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // let the browser handle it
    e.preventDefault();
    const href = `/domains/${encodeURIComponent(domain)}`;
    const result = await preloadData(href);
    if (result.type === 'loaded' && result.status === 200) {
      sheetDetail = result.data.detail;
      sheetOpen = true;
      pushState(href, { sheet: true });
    } else {
      void goto(href);
    }
  }

  // close the sheet when the pushState entry is popped (back button / Esc)
  $effect(() => {
    if (!$pageStore.state?.sheet) sheetOpen = false;
  });
  // svelte-ignore state_referenced_locally -- intentional: form-local editable copy, seeded once
  let search = $state(data.search);
  const result = $derived(data.result);
  const stateParam = $derived(data.state);

  onMount(() => startAutoRefresh());

  function apply(next: { search: string; state: string }) {
    const q = new URLSearchParams($pageStore.url.searchParams);
    for (const [k, val] of Object.entries(next)) {
      if (val) q.set(k, val);
      else q.delete(k);
    }
    q.delete('page'); // any filter change resets to page 1
    void goto(`/domains?${q.toString()}`, { keepFocus: true, noScroll: true });
  }

  const stateOptions = [
    { value: '', label: 'Any state' },
    ...DOMAIN_STATES.map((s) => ({ value: s, label: stateLabel(s) }))
  ];
</script>

<Masthead
  title="Domain log — index"
  counts={[{ label: 'Matches', value: formatCount(result.total) }]}
/>

<form
  class="filters"
  onsubmit={(e) => {
    e.preventDefault();
    apply({ search, state: stateParam });
  }}
>
  <label class="search">
    <span>Search</span>
    <input type="search" bind:value={search} placeholder="domain contains…" />
  </label>
  <Select
    name="state"
    label="State"
    value={stateParam}
    options={stateOptions}
    onchange={(v) => apply({ search, state: v })}
  />
  <button type="submit">Filter</button>
</form>

{#if result.items.length === 0}
  <EmptyState title="No domains match" hint="Clear the filters to see the whole log.">
    <a href="/domains">Clear filters</a>
  </EmptyState>
{:else}
  <LogTable columns={['Domain', 'State', 'Score', 'Hits', 'Last seen', 'Verdicts']}>
    {#each result.items as d (d.domain)}
      <tr>
        <td class="dom">
          <span class="edgewrap"><StatusEdge state={d.state} /></span>
          <a
            href={`/domains/${encodeURIComponent(d.domain)}`}
            onclick={(e) => openSheet(e, d.domain)}
            data-sveltekit-noscroll>{d.domain}</a
          >
        </td>
        <td>{stateLabel(d.state)}</td>
        <td class="mono">{d.score === null ? '—' : d.score.toFixed(2)}</td>
        <td class="mono">{formatCount(d.hitCount)}</td>
        <td><RelativeTime at={d.lastSeen} /></td>
        <td class="mono">{d.verdictCount}</td>
      </tr>
    {/each}
  </LogTable>
  <Pagination page={result.page} pageCount={result.pageCount} />
{/if}

{#if sheetOpen && sheetDetail}
  <Sheet bind:open={sheetOpen} title={sheetDetail.domain} onclose={() => history.back()}>
    <DomainRecord detail={sheetDetail} />
  </Sheet>
{/if}

<style>
  .filters {
    display: flex;
    gap: var(--vb-s4);
    align-items: flex-end;
    margin-bottom: var(--vb-s4);
    flex-wrap: wrap;
  }
  .search {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .search span {
    font: var(--vb-fs-micro) / 1 var(--vb-font-mono);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--vb-ink-soft);
  }
  input[type='search'] {
    font: var(--vb-fs-small) / 1 var(--vb-font-mono);
    background: var(--vb-ground-raised);
    color: var(--vb-ink);
    border: 1px solid var(--vb-rule-strong);
    border-radius: var(--vb-radius);
    padding: 6px 8px;
    min-width: 220px;
  }
  .filters button {
    font: 700 var(--vb-fs-small) / 1 var(--vb-font-head);
    font-stretch: var(--vb-head-stretch);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 8px 14px;
    border: 1px solid var(--vb-rule-strong);
    border-radius: var(--vb-radius);
    background: var(--vb-ground-raised);
    color: var(--vb-ink);
    cursor: pointer;
  }
  .dom {
    display: flex;
    align-items: stretch;
    gap: var(--vb-s2);
  }
  .dom a {
    color: var(--vb-ink);
    text-decoration: none;
    word-break: break-all;
  }
  .dom a:hover {
    color: var(--vb-accent);
    text-decoration: underline;
  }
  .edgewrap {
    display: inline-flex;
  }
  .mono {
    font-family: var(--vb-font-mono);
  }
</style>
