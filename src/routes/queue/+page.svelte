<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import { invalidate } from '$app/navigation';
  import type { EventStream } from '$lib/client/sse';
  import Masthead from '$lib/components/Masthead.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import Stamp from '$lib/components/Stamp.svelte';
  import RelativeTime from '$lib/components/RelativeTime.svelte';
  import { formatDuration, formatCount } from '$lib/format';

  let { data } = $props();
  const v = $derived(data.view);

  const { last } = getContext<EventStream>('vb:sse');
  onMount(() =>
    last.subscribe((evt) => {
      if (
        evt &&
        (evt.type === 'assess.start' ||
          evt.type === 'assess.done' ||
          evt.type === 'verdict')
      ) {
        void invalidate('vb:data');
      }
    })
  );
</script>

<Masthead
  title="Pipeline — pending assessment"
  counts={[{ label: 'Total backlog', value: formatCount(v.totalBacklog) }]}
/>

{#if v.totalBacklog === 0}
  <EmptyState
    title="All domains assessed — nothing queued"
    hint="Every observed domain has a verdict from every enabled source."
  />
{/if}

<section class="sources">
  {#each v.sources as s (s.source)}
    <article class="src">
      <header>
        <span class="name">{s.source}</span>
        {#if s.inline}
          <Stamp text="INLINE" tone="muted" />
        {:else if s.pausedUntil}
          <Stamp text="PAUSED" tone="accent" />
        {:else if s.backlog === 0}
          <Stamp text="DRAINED" tone="ok" />
        {/if}
      </header>
      {#if !s.inline}
        <dl>
          <div><dt>Backlog</dt><dd>{formatCount(s.backlog)}</dd></div>
          <div><dt>ETA</dt><dd>{formatDuration(s.etaMs)}</dd></div>
          <div><dt>In focus</dt><dd class="focus">{s.inFocus ?? '—'}</dd></div>
          <div><dt>Next call</dt><dd><RelativeTime at={s.nextCallAt} /></dd></div>
          <div>
            <dt>Left today</dt>
            <dd>
              {s.remainingDay === null ? 'no key' : formatCount(s.remainingDay)}
            </dd>
          </div>
          {#if s.pausedUntil}
            <div>
              <dt>Paused until</dt>
              <dd><RelativeTime at={s.pausedUntil} /></dd>
            </div>
          {/if}
        </dl>
      {:else}
        <p class="inline-note">
          Checked at ingest time against the local set. No backlog, no pacing.
        </p>
      {/if}
    </article>
  {/each}
</section>

<section class="ingest">
  <h2>Ingestion loop</h2>
  <dl>
    <div>
      <dt>Last run</dt>
      <dd><RelativeTime at={v.ingestion.lastIngestAt} /></dd>
    </div>
    <div>
      <dt>Next run</dt>
      <dd><RelativeTime at={v.ingestion.nextRunAt} /></dd>
    </div>
    <div>
      <dt>First run done</dt>
      <dd>{v.ingestion.firstRunDone ? 'yes' : 'no'}</dd>
    </div>
    <div><dt>Cursor</dt><dd class="cursor">{v.ingestion.cursor ?? '—'}</dd></div>
  </dl>
</section>

<style>
  .sources {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: var(--vb-s4);
    margin-bottom: var(--vb-s6);
  }
  .src {
    border: var(--vb-line);
    border-radius: var(--vb-radius);
    background: var(--vb-ground-raised);
    padding: var(--vb-s4);
  }
  .src header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--vb-s3);
  }
  .src .name {
    font: 700 var(--vb-fs-body) / 1 var(--vb-font-mono);
  }
  dl {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--vb-s2) var(--vb-s3);
    margin: 0;
  }
  dt {
    font: var(--vb-fs-micro) / 1 var(--vb-font-mono);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--vb-ink-soft);
  }
  dd {
    font: var(--vb-fs-small) / 1.3 var(--vb-font-mono);
    margin: 2px 0 0;
  }
  .focus,
  .cursor {
    word-break: break-all;
    color: var(--vb-accent);
  }
  .inline-note {
    font-size: var(--vb-fs-small);
    color: var(--vb-ink-soft);
    margin: 0;
  }
  .ingest h2 {
    font: 700 var(--vb-fs-micro) / 1 var(--vb-font-head);
    font-stretch: var(--vb-head-stretch);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--vb-ink-soft);
    border-bottom: 1px solid var(--vb-rule);
    padding-bottom: var(--vb-s2);
  }
  .ingest dl {
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  }
</style>
