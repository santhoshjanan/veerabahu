<script lang="ts">
  import type { Snippet } from 'svelte';
  import { createDialog, melt } from '@melt-ui/svelte';

  let {
    open = $bindable(false),
    title,
    onclose,
    children
  }: { open?: boolean; title: string; onclose?: () => void; children: Snippet } = $props();

  const {
    elements: { overlay, content, title: titleEl, close, portalled },
    states: { open: isOpen }
  } = createDialog({
    forceVisible: true,
    onOpenChange: ({ next }) => {
      open = next;
      if (!next) onclose?.();
      return next;
    }
  });

  $effect(() => {
    isOpen.set(open);
  });
</script>

{#if $isOpen}
  <div use:melt={$portalled}>
    <div use:melt={$overlay} class="ov"></div>
    <div use:melt={$content} class="sheet" role="dialog">
      <header>
        <h2 use:melt={$titleEl}>{title}</h2>
        <button use:melt={$close} class="x" aria-label="Close">✕</button>
      </header>
      <div class="body">{@render children()}</div>
    </div>
  </div>
{/if}

<style>
  .ov { position: fixed; inset: 0; background: rgba(16, 20, 22, 0.5); z-index: 40; }
  .sheet {
    position: fixed;
    top: 0;
    right: 0;
    height: 100vh;
    width: min(620px, 92vw);
    overflow-y: auto;
    background: var(--vb-ground-raised);
    border-left: 1px solid var(--vb-rule-strong);
    box-shadow: var(--vb-shadow-sheet);
    z-index: 41;
    padding: var(--vb-s5);
  }
  header { display: flex; align-items: baseline; justify-content: space-between; border-bottom: 2px solid var(--vb-rule-strong); padding-bottom: var(--vb-s3); margin-bottom: var(--vb-s4); }
  h2 { font: 700 var(--vb-fs-h3) / 1.2 var(--vb-font-head); font-stretch: var(--vb-head-stretch); text-transform: uppercase; letter-spacing: 0.05em; margin: 0; word-break: break-all; }
  .x { background: none; border: 0; color: var(--vb-ink-soft); font-size: var(--vb-fs-h3); cursor: pointer; }
</style>
