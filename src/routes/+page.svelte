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
  let recorded = $state<string | null>(null);
  const protection = $derived({
    protected: 'Blocklist recently pulled',
    awaiting_first_pull: 'Awaiting first gatekeeper pull',
    stale: 'Gatekeeper pull is stale',
    failed: 'Last gatekeeper pull failed'
  }[v.blocklistHealth]);
  const unavailableSources = $derived(v.sources.filter((s) => s.remainingDay === null).length);
  const pausedSources = $derived(v.sources.filter((s) => (s.pausedUntil ?? 0) > Date.now()).length);
  const curatedErrors = $derived(v.curatedLists.filter((list) => list.lastError).length);
  const sourceHealth = $derived(
    curatedErrors ? `${curatedErrors} curated list error${curatedErrors === 1 ? '' : 's'}` :
      pausedSources ? `${pausedSources} source${pausedSources === 1 ? '' : 's'} paused` :
        unavailableSources ? `${unavailableSources} source${unavailableSources === 1 ? '' : 's'} not configured` :
          'All sources healthy'
  );
  onMount(() => startAutoRefresh());
</script>

<Masthead
  title="Veerabahu · Level 2 Disposition Log"
  counts={[
    { label: 'Needs review', value: formatCount(v.counts.pending_review) }
  ]}
/>

<div class="grid">
  <section class="col-main">
    <div class="decision-deck">
      <h2>Open entries</h2>
      <p class="section-note">Most observed first. Review the evidence before choosing.</p>
      <p class="summary">{formatCount(v.publishedCount)} published · {formatCount(v.autoCleared24h)} auto-cleared · {formatCount(v.observed24h)} observed today</p>
      {#if recorded}<p class="recorded" role="status">{recorded} <a href="/audit">View audit</a></p>{/if}
      {#if data.queueTop.length === 0}
        <EmptyState title="Nothing awaiting a decision" hint="The log is clear." />
      {:else}
        {#each data.queueTop as item (item.domain)}
          <ReviewEntry {item} lastPullAt={data.lastPullAt} ondecided={(decision) => (recorded = decision === 'approve' ? `${item.domain} approved for the published blocklist.` : `${item.domain} added to the allowlist.`)} />
        {/each}
        <a class="more" href="/review">→ full review queue</a>
      {/if}
    </div>

    <h2>Recent log lines</h2>
    <ul class="audit">
      {#each v.recentAudit as a (a.id)}
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
    <h2>Blocklist health</h2>
    <p class="protection" class:warn={v.blocklistHealth !== 'protected'}><strong>{protection}</strong></p>
    {#if v.lastPull}
      <p class="pull">
        <strong>Last gatekeeper pull:</strong> <RelativeTime at={v.lastPull.at} /> · {v.lastPull.ip} · {v.lastPull.status}
      </p>
    {:else}
      <p class="pull warn"><strong>Awaiting first gatekeeper pull.</strong></p>
    {/if}
    <p class="guidance">
      Blocks you approve are published immediately. Protection begins after the next gatekeeper pull.
    </p>

    <details class="health-details">
      <summary>Source and list health</summary>
      <p class="source-summary" class:warn={curatedErrors || pausedSources}>{sourceHealth}</p>
      <p class="cost">
        AI spend today: {formatUsd(v.aiCostTodayUsd)} · {formatCount(v.verdictsToday)} verdicts
      </p>

      <h3>Sources</h3>
      <ul class="sources">
        {#each v.sources as s (s.source)}
          <li>
            <span class="sname">{s.source}</span>
            <span class="squota">
              {s.remainingDay === null ? 'not configured' : `${formatCount(s.remainingDay)} left today`}
            </span>
          </li>
        {/each}
      </ul>
      <a class="more" href="/queue">pipeline & queue status →</a>

      <h3>Curated lists</h3>
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
    </details>
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
  .decision-deck {
    border-top: 3px solid var(--vb-accent);
    padding-top: var(--vb-s4);
  }
  .decision-deck h2 {
    color: var(--vb-ink);
    font-size: var(--vb-fs-h2);
    letter-spacing: 0.04em;
  }
  .section-note { margin: calc(-1 * var(--vb-s2)) 0 var(--vb-s4); color: var(--vb-ink-soft); font: var(--vb-fs-small) / 1.4 var(--vb-font-mono); }
  .summary, .recorded, .source-summary { font: var(--vb-fs-small) / 1.4 var(--vb-font-mono); color: var(--vb-ink-soft); }
  .summary { margin: 0 0 var(--vb-s4); }
  .recorded { color: var(--vb-ink); }
  .recorded a { color: var(--vb-accent); }
  .col-side {
    border-top: 2px solid var(--vb-rule-strong);
    padding-top: var(--vb-s4);
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
  .cost,
  .guidance {
    font: var(--vb-fs-small) / 1.5 var(--vb-font-mono);
    color: var(--vb-ink-soft);
  }
  .guidance { margin-bottom: var(--vb-s4); }
  .protection { margin: 0 0 var(--vb-s2); font: 700 var(--vb-fs-small) / 1.4 var(--vb-font-head); font-stretch: var(--vb-head-stretch); letter-spacing: 0.04em; text-transform: uppercase; }
  .health-details { border-top: var(--vb-line); padding-top: var(--vb-s3); }
  .health-details summary { cursor: pointer; color: var(--vb-ink); font: 700 var(--vb-fs-small) / 1 var(--vb-font-head); font-stretch: var(--vb-head-stretch); letter-spacing: 0.06em; text-transform: uppercase; }
  h3 { font: 700 var(--vb-fs-micro) / 1 var(--vb-font-head); font-stretch: var(--vb-head-stretch); text-transform: uppercase; letter-spacing: 0.1em; color: var(--vb-ink-soft); border-bottom: 1px solid var(--vb-rule); padding-bottom: var(--vb-s2); margin: var(--vb-s4) 0 var(--vb-s3); }
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
  @media (max-width: 640px) {
    .audit li { flex-wrap: wrap; gap: var(--vb-s1) var(--vb-s3); }
    .audit .dom { flex-basis: 100%; }
  }
</style>
