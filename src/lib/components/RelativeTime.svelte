<script lang="ts">
  import { relativeTime } from '$lib/format';
  let { at }: { at: number | null } = $props();
</script>

{#if at}
  <time datetime={new Date(at).toISOString()}>{relativeTime(at)}</time>
{:else}
  <time>never</time>
{/if}
