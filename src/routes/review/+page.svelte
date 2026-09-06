<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import { invalidate } from '$app/navigation';
  import type { EventStream } from '$lib/client/sse';
  import Masthead from '$lib/components/Masthead.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import ReviewEntry from '$lib/components/ReviewEntry.svelte';

  let { data } = $props();

  const sse = getContext<EventStream>('vb:sse');
  const { last, status } = sse;
  let recorded = $state<string | null>(null);

  onMount(() => {
    const unsub = last.subscribe((evt) => {
      if (!evt) return;
      if (evt.type === 'verdict' || evt.type === 'domain.state' || evt.type === 'decision') {
        void invalidate('vb:data');
      }
    });
    let fallback: ReturnType<typeof setInterval> | undefined;
    const statusUnsub = status.subscribe((state) => {
      if (state === 'live') {
        if (fallback) clearInterval(fallback);
        fallback = undefined;
      } else if (!fallback) {
        fallback = setInterval(() => void invalidate('vb:data'), 20_000);
      }
    });
    return () => {
      unsub();
      statusUnsub();
      if (fallback) clearInterval(fallback);
    };
  });
</script>

<Masthead
  title="Incoming — awaiting decision"
  counts={[{ label: 'In queue', value: data.items.length }]}
/>

{#if data.items.length === 0}
  <EmptyState title="No entries awaiting a decision" hint="Assessed domains that need a human call appear here." />
{:else}
  {#each data.items as item (item.domain)}
    <ReviewEntry {item} lastPullAt={data.lastPullAt} ondecided={(decision) => (recorded = decision === 'approve' ? `${item.domain} approved for the published blocklist.` : `${item.domain} added to the allowlist.`)} />
  {/each}
{/if}

{#if recorded}<p class="recorded" role="status">{recorded} <a href="/audit">View audit</a></p>{/if}

<style>
  .recorded { margin-top: var(--vb-s4); color: var(--vb-ink); font: var(--vb-fs-small) / 1.4 var(--vb-font-mono); }
  .recorded a { color: var(--vb-accent); }
</style>
