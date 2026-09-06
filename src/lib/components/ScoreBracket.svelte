<script lang="ts">
  import { scoreLabel, verdictLabel } from '$lib/format';
  let {
    score,
    verdicts
  }: {
    score: number | null;
    verdicts: { source: string; verdict: string; confidence: number }[];
  } = $props();
  const label = $derived(scoreLabel(score));
</script>

<div class="bracket">
  <ul class="inputs">
    {#each verdicts as v (v.source)}
      <li class="chip" data-tone={v.verdict}>
        <span class="src">{v.source}</span>
        <span class="val">{verdictLabel(v.verdict as any)} · {v.confidence.toFixed(2)}</span>
      </li>
    {/each}
  </ul>
  <div class="lead" aria-hidden="true"></div>
  <div class="sum" data-tone={label.tone}>
    <span class="num">{score === null ? '—' : score.toFixed(2)}</span>
    <span class="txt">{label.text}</span>
  </div>
</div>

<style>
  .bracket { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: var(--vb-s3); }
  .inputs { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--vb-s2); }
  .chip { font: var(--vb-fs-micro) / 1.3 var(--vb-font-mono); border: var(--vb-line); border-radius: var(--vb-radius); padding: 2px 6px; }
  .chip .src { color: var(--vb-ink-soft); margin-right: 4px; }
  .chip[data-tone='block'] { border-color: var(--vb-st-approved); }
  .chip[data-tone='allow'] { border-color: var(--vb-st-pending_review); }
  .lead { width: 24px; height: 1px; background: var(--vb-rule-strong); }
  .sum { text-align: right; font-family: var(--vb-font-mono); }
  .sum .num { font-size: var(--vb-fs-h3); font-weight: 700; display: block; }
  .sum .txt { font-size: var(--vb-fs-micro); color: var(--vb-ink-soft); text-transform: uppercase; letter-spacing: 0.06em; }
  .sum[data-tone='block'] .num { color: var(--vb-accent); }
  @media (max-width: 640px) {
    .bracket { grid-template-columns: 1fr; }
    .lead { display: none; }
    .sum { text-align: left; }
  }
</style>
