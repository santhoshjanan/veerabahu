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
    <ReviewEntry {item} lastPullAt={data.lastPullAt} />
  {/each}
{/if}
