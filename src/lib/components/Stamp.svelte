<script lang="ts">
  let { text, tone = 'accent' }: { text: string; tone?: 'accent' | 'muted' | 'ok' } = $props();
</script>

<span class="stamp {tone}" aria-label="disposition: {text}">{text}</span>

<style>
  .stamp {
    display: inline-block;
    font: 700 var(--vb-fs-micro) / 1 var(--vb-font-head);
    font-stretch: var(--vb-head-stretch);
    letter-spacing: 0.08em;
    padding: 3px 6px 2px;
    border: 1.5px solid currentColor;
    border-radius: var(--vb-radius);
    transform: rotate(-2deg);
    text-transform: uppercase;
    opacity: 0.92;
  }
  .accent { color: var(--vb-accent); }
  .muted { color: var(--vb-ink-faint); }
  .ok { color: var(--vb-st-approved); }
</style>
