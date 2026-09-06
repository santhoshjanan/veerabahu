<script lang="ts">
  import { onMount } from 'svelte';
  import { startAutoRefresh } from '$lib/client/auto-refresh';
  import Masthead from '$lib/components/Masthead.svelte';
  import ReviewEntry from '$lib/components/ReviewEntry.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import RelativeTime from '$lib/components/RelativeTime.svelte';
  import { formatCount, formatUsd } from '$lib/format';

  let { data } = $props();
  const v = $derived(data.view);
  onMount(() => startAutoRefresh());
</script>

<Masthead
  title="Veerabahu · Level 2 Disposition Log"
  counts={[
    { label: 'In queue', value: formatCount(v.counts.pending_review) },
    { label: 'Published', value: formatCount(v.publishedCount) },
    { label: 'Auto-cleared 24h', value: formatCount(v.autoCleared24h) },
    { label: 'Observed 24h', value: formatCount(v.observed24h) }
  ]}
/>

<div class="grid">
  <section class="col-main">
    <h2>Open entries</h2>
    {#if data.queueTop.length === 0}
      <EmptyState title="Nothing awaiting a decision" hint="The log is clear." />
    {:else}
      {#each data.queueTop as item (item.domain)}
        <ReviewEntry {item} lastPullAt={data.lastPullAt} />
      {/each}
      <a class="more" href="/review">→ full review queue</a>
    {/if}

    <h2>Recent log lines</h2>
    <ul class="audit">
      {#each v.recentAudit as a (a.at + a.event + (a.domain ?? ''))}
        <li>
          <RelativeTime at={a.at} />
          <span class="ev">{a.event}</span>
          <span class="who">{a.actor}</span>
          {#if a.domain}<span class="dom">{a.domain}</span>{/if}
        </li>
      {/each}
    </ul>
  </section>

  <aside class="col-side">
    <h2>Consumption record</h2>
    {#if v.lastPull}
      <p class="pull">
        Last pull <RelativeTime at={v.lastPull.at} /> · {v.lastPull.ip} · {v.lastPull.status}
      </p>
    {:else}
      <p class="pull warn">Gatekeeper has never pulled the blocklist.</p>
    {/if}
    <p class="cost">
      AI spend today: {formatUsd(v.aiCostTodayUsd)} · {formatCount(v.verdictsToday)} verdicts
    </p>

    <h2>Sources</h2>
    <ul class="sources">
      {#each v.sources as s (s.source)}
        <li>
          <span class="sname">{s.source}</span>
          <span class="squota">
            {s.remainingDay === null ? 'no key' : `${formatCount(s.remainingDay)} left today`}
          </span>
        </li>
      {/each}
    </ul>
    <a class="more" href="/queue">pipeline & queue status →</a>

    <h2>Curated lists</h2>
    <ul class="curated">
      {#each v.curatedLists as c (c.name)}
        <li>
          <span>{c.name}</span>
          <span class="cmeta">
            {#if c.lastError}<span class="warn">error</span>
            {:else}<RelativeTime at={c.lastFetched} /> · {formatCount(c.entryCount)}{/if}
          </span>
        </li>
      {/each}
    </ul>
  </aside>
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: 1fr 320px;
    gap: var(--vb-s6);
  }
  h2 {
    font: 700 var(--vb-fs-micro) / 1 var(--vb-font-head);
    font-stretch: var(--vb-head-stretch);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--vb-ink-soft);
    border-bottom: 1px solid var(--vb-rule);
    padding-bottom: var(--vb-s2);
    margin: var(--vb-s5) 0 var(--vb-s3);
  }
  .col-main h2:first-child,
  .col-side h2:first-child {
    margin-top: 0;
  }
  .more {
    display: inline-block;
    margin-top: var(--vb-s3);
    font: var(--vb-fs-small) / 1 var(--vb-font-mono);
    color: var(--vb-accent);
    text-decoration: none;
  }
  .audit {
    list-style: none;
    margin: 0;
    padding: 0;
    font: var(--vb-fs-small) / 1.6 var(--vb-font-mono);
  }
  .audit li {
    display: flex;
    gap: var(--vb-s3);
    border-bottom: var(--vb-line);
    padding: 4px 0;
  }
  .audit .ev {
    color: var(--vb-ink);
  }
  .audit .who {
    color: var(--vb-ink-soft);
  }
  .audit .dom {
    color: var(--vb-accent);
    word-break: break-all;
  }
  .pull,
  .cost {
    font: var(--vb-fs-small) / 1.5 var(--vb-font-mono);
    color: var(--vb-ink-soft);
  }
  .warn {
    color: var(--vb-accent);
  }
  .sources,
  .curated {
    list-style: none;
    margin: 0;
    padding: 0;
    font: var(--vb-fs-small) / 1.6 var(--vb-font-mono);
  }
  .sources li,
  .curated li {
    display: flex;
    justify-content: space-between;
    gap: var(--vb-s3);
    border-bottom: var(--vb-line);
    padding: 4px 0;
  }
  .squota,
  .cmeta {
    color: var(--vb-ink-soft);
  }
  @media (max-width: 900px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
