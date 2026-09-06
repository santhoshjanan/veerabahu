<script lang="ts">
  import type { ReviewDetail } from '$lib/server/pipeline/review';
  import type { VerdictValue } from '$lib/server/db/types';
  import { enhance } from '$app/forms';
  import StatusEdge from './StatusEdge.svelte';
  import ScoreBracket from './ScoreBracket.svelte';
  import RelativeTime from './RelativeTime.svelte';
  import Stamp from './Stamp.svelte';
  import { stateLabel, stateStampText, verdictLabel, formatCount } from '$lib/format';

  let { detail }: { detail: ReviewDetail } = $props();
</script>

<div class="record">
  <div class="top">
    <span class="edgewrap"><StatusEdge state={detail.state} /></span>
    <div>
      <p class="domain">
        <span class="name">{detail.domain}</span>
        <Stamp text={stateStampText(detail.state)} />
      </p>
      <p class="sub">
        {stateLabel(detail.state)} · {formatCount(detail.hitCount)} hits · first seen
        <RelativeTime at={detail.firstSeen} />
      </p>
    </div>
  </div>

  <h3>Score derivation</h3>
  <ScoreBracket score={detail.score} verdicts={detail.verdicts} />

  <h3>Verdicts</h3>
  <ul class="verdicts">
    {#each detail.verdictsFull as v (v.source)}
      <li>
        <div class="vhead">
          <span class="vsrc">{v.source}</span>
          <span class="vval"
            >{verdictLabel(v.verdict as VerdictValue)} · {v.confidence.toFixed(2)}</span
          >
          {#if v.category}<span class="vcat">{v.category}</span>{/if}
          <RelativeTime at={v.assessedAt} />
        </div>
        {#if v.detail}<p class="vdetail">{v.detail}</p>{/if}
        <details>
          <summary>raw</summary>
          <pre>{JSON.stringify(detail.rawBySource[v.source] ?? {}, null, 2)}</pre>
        </details>
      </li>
    {/each}
    {#if detail.verdictsFull.length === 0}<li class="none">No verdicts yet.</li>{/if}
  </ul>

  <h3>Log lines</h3>
  <ul class="audit">
    {#each detail.audit as a (a.at + a.event)}
      <li>
        <RelativeTime at={a.at} /> <span>{a.event}</span> <span class="who">{a.actor}</span>
      </li>
    {/each}
    {#if detail.audit.length === 0}<li class="none">No recorded transitions.</li>{/if}
  </ul>

  <h3>Allowlist</h3>
  <form
    method="POST"
    action="/domains/{encodeURIComponent(detail.domain)}?/toggleAllowlist"
    use:enhance
  >
    <p class="albody">
      {#if detail.allowlist}
        On the allowlist — {detail.allowlist.reason} (<RelativeTime
          at={detail.allowlist.addedAt}
        />).
      {:else}
        Not on the allowlist.
      {/if}
    </p>
    <button type="submit">
      {detail.allowlist ? 'Remove from allowlist' : 'Add to allowlist'}
    </button>
  </form>
</div>

<style>
  .record {
    font-size: var(--vb-fs-small);
  }
  .top {
    display: flex;
    gap: var(--vb-s3);
    align-items: stretch;
    margin-bottom: var(--vb-s4);
  }
  .domain {
    display: flex;
    align-items: center;
    gap: var(--vb-s3);
    flex-wrap: wrap;
    margin: 0;
  }
  .domain .name {
    font: var(--vb-fs-h3) / 1.2 var(--vb-font-mono);
    word-break: break-all;
  }
  .sub {
    margin: 4px 0 0;
    color: var(--vb-ink-soft);
    font-family: var(--vb-font-mono);
    font-size: var(--vb-fs-micro);
  }
  h3 {
    font: 700 var(--vb-fs-micro) / 1 var(--vb-font-head);
    font-stretch: var(--vb-head-stretch);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--vb-ink-soft);
    border-bottom: 1px solid var(--vb-rule);
    padding-bottom: var(--vb-s2);
    margin: var(--vb-s5) 0 var(--vb-s3);
  }
  .verdicts,
  .audit {
    list-style: none;
    margin: 0;
    padding: 0;
    font-family: var(--vb-font-mono);
  }
  .verdicts li {
    border-bottom: var(--vb-line);
    padding: var(--vb-s3) 0;
  }
  .vhead {
    display: flex;
    flex-wrap: wrap;
    gap: var(--vb-s3);
    align-items: baseline;
  }
  .vsrc {
    font-weight: 700;
  }
  .vcat {
    color: var(--vb-accent);
  }
  .vdetail {
    margin: var(--vb-s2) 0 0;
    color: var(--vb-ink-soft);
    font-family: var(--vb-font-sans);
  }
  details pre {
    font-size: var(--vb-fs-micro);
    background: var(--vb-ground-sunk);
    padding: var(--vb-s3);
    overflow-x: auto;
    border-radius: var(--vb-radius);
  }
  .audit li {
    display: flex;
    gap: var(--vb-s3);
    padding: 3px 0;
    border-bottom: var(--vb-line);
    font-size: var(--vb-fs-micro);
  }
  .audit .who {
    color: var(--vb-ink-soft);
  }
  .none {
    color: var(--vb-ink-faint);
    padding: var(--vb-s2) 0;
  }
  form button {
    font: 700 var(--vb-fs-small) / 1 var(--vb-font-head);
    font-stretch: var(--vb-head-stretch);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 8px 14px;
    border: 1.5px solid var(--vb-accent);
    color: var(--vb-accent);
    background: none;
    border-radius: var(--vb-radius);
    cursor: pointer;
  }
  .albody {
    color: var(--vb-ink-soft);
    font-family: var(--vb-font-mono);
    font-size: var(--vb-fs-micro);
  }
</style>
