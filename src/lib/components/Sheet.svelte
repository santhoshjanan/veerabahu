<script lang="ts">
  import { onDestroy, type Snippet } from 'svelte';
  import { createDialog } from '@melt-ui/svelte';

  let {
    open = $bindable(false),
    title,
    onclose,
    children
  }: { open?: boolean; title: string; onclose?: () => void; children: Snippet } = $props();
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
      if (!next) onclose?.();
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
  <div {...$portalled} use:$portalled.action>
    <div {...$overlay} use:$overlay.action class="ov"></div>
    <div {...$content} use:$content.action class="sheet" role="dialog">
      <header>
        <h2 {...$titleEl} use:$titleEl.action>{title}</h2>
        <button {...$close} use:$close.action class="x" aria-label="Close">✕</button>
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
