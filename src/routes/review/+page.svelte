<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import { invalidate } from '$app/navigation';
  import type { EventStream } from '$lib/client/sse';
  import Masthead from '$lib/components/Masthead.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import ReviewEntry from '$lib/components/ReviewEntry.svelte';

  let { data } = $props();

  const sse = getContext<EventStream>('vb:sse');
  const { last } = sse;

  onMount(() => {
    const unsub = last.subscribe((evt) => {
      if (!evt) return;
      if (evt.type === 'verdict' || evt.type === 'domain.state' || evt.type === 'decision') {
        void invalidate('vb:data');
      }
    });
    return unsub;
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
