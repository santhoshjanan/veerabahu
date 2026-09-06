<script lang="ts">
  import { onDestroy, type Snippet } from 'svelte';
  import { createDialog, melt } from '@melt-ui/svelte';

  let {
    open = $bindable(false),
    title,
    children
  }: { open?: boolean; title: string; children: Snippet } = $props();
  let returnFocus: HTMLElement | null = null;
  let wasOpen = false;

  const {
    elements: { overlay, content, title: titleEl, close, portalled },
    states: { open: isOpen }
  } = createDialog({
    forceVisible: true,
    closeFocus: () => returnFocus,
    onOpenChange: ({ next }) => {
      open = next;
      return next;
    }
  });

  $effect(() => {
    if (open && !wasOpen && typeof document !== 'undefined') {
      returnFocus = document.activeElement as HTMLElement | null;
    }
    wasOpen = open;
    isOpen.set(open);
  });

  onDestroy(() => returnFocus?.focus());
</script>

{#if $isOpen}
  <div use:melt={$portalled}>
    <div use:melt={$overlay} class="ov"></div>
    <div use:melt={$content} class="panel" role="dialog">
      <h2 use:melt={$titleEl}>{title}</h2>
      <div class="body">{@render children()}</div>
      <button use:melt={$close} class="x" aria-label="Close">✕</button>
    </div>
  </div>
{/if}

<style>
  .ov { position: fixed; inset: 0; background: rgba(16, 20, 22, 0.55); z-index: 40; }
  .panel {
    position: fixed;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(560px, calc(100vw - var(--vb-s5)));
    max-height: calc(100vh - var(--vb-s6));
    overflow: auto;
    background: var(--vb-ground-raised);
    border: 1px solid var(--vb-rule-strong);
    border-radius: var(--vb-radius);
    padding: var(--vb-s5);
    z-index: 41;
  }
  h2 { font: 700 var(--vb-fs-h3) / 1.2 var(--vb-font-head); font-stretch: var(--vb-head-stretch); text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 var(--vb-s4); }
  .x { position: absolute; top: var(--vb-s3); right: var(--vb-s3); background: none; border: 0; color: var(--vb-ink-soft); font-size: var(--vb-fs-h3); cursor: pointer; }
</style>
