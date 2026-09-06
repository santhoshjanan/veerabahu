<script lang="ts">
  import type { DomainState } from '$lib/server/db/types';
  import { stateLabel } from '$lib/format';
  let { state, label }: { state: DomainState; label?: string } = $props();
</script>

<span class="edge" style="--edge: var(--vb-st-{state})" aria-hidden="true"></span>
<span class="sr-only">{label ?? stateLabel(state)}</span>

<style>
  .edge {
    display: inline-block;
    width: 3px;
    align-self: stretch;
    min-height: 1.2em;
    background: var(--edge);
    border-radius: 2px;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
</style>
