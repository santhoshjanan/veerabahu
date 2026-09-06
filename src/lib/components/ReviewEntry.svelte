<script lang="ts">
  import type { ReviewListItem } from '$lib/server/pipeline/review';
  import { invalidate } from '$app/navigation';
  import ScoreBracket from './ScoreBracket.svelte';
  import StatusEdge from './StatusEdge.svelte';
  import Dialog from './Dialog.svelte';
  import { relativeTime } from '$lib/format';

  let {
    item,
    lastPullAt,
    ondecided
  }: {
    item: ReviewListItem;
    lastPullAt: number | null;
    ondecided?: (decision: 'approve' | 'reject') => void;
  } = $props();

  let dialogOpen = $state(false);
  let pending = $state<'approve' | 'reject' | null>(null);
  let note = $state('');
  let busy = $state(false);
  let err = $state('');

  function ask(decision: 'approve' | 'reject') {
    pending = decision;
    note = '';
    err = '';
    dialogOpen = true;
  }

  const proof = $derived(
    pending === 'approve'
      ? `Published now. Protection starts when the gatekeeper next pulls /blocklist.txt. Last pull was ${relativeTime(lastPullAt)}.`
      : `Removes ${item.domain} from review and adds it to the allowlist. It will not be proposed again.`
  );
  const reason = $derived(
    [
      item.verdicts.find((v) => v.verdict === 'block')?.category,
      item.verdicts.find((v) => v.verdict === 'block')?.detail
    ]
      .filter(Boolean)
      .join(' — ') ||
      'Available evidence recommends a block'
  );
  const blockingSources = $derived(item.verdicts.filter((v) => v.verdict === 'block').length);

  async function confirm() {
    if (!pending) return;
    busy = true;
    err = '';
    try {
      const res = await fetch(`/api/review/${encodeURIComponent(item.domain)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: pending, note: note.trim() || null })
      });
      if (res.ok) {
        dialogOpen = false;
        await invalidate('vb:data'); // the entry drops out of the list — that is the confirmation
        ondecided?.(pending);
      } else {
        const body = await res.json().catch(() => ({}));
        err = body.message ?? `Failed (${res.status})`;
      }
    } catch {
      err = 'Network error — try again.';
    } finally {
      busy = false;
    }
  }
</script>

<article class="entry">
  <StatusEdge state="pending_review" />
  <div class="main">
    <div class="head">
      <a class="domain" href={`/domains/${encodeURIComponent(item.domain)}`}>{item.domain}</a>
      <span class="meta">{item.hitCount} hits</span>
    </div>
    <p class="evidence">
      <strong>Reason:</strong> {reason} · {blockingSources} source{blockingSources === 1 ? '' : 's'} recommend block · First seen {relativeTime(item.firstSeen)} · Last seen {relativeTime(item.lastSeen)}
    </p>
    <ScoreBracket score={item.score} verdicts={item.verdicts} />
    <div class="actions">
      <button class="block" onclick={() => ask('approve')}>Approve block</button>
      <button class="keep" onclick={() => ask('reject')}>Allow domain</button>
    </div>
  </div>
</article>

<Dialog bind:open={dialogOpen} title={pending === 'approve' ? 'Stamp: BLOCKED' : 'Stamp: KEPT'}>
  <p class="proof">{proof}</p>
  <label class="note">
    <span>Note (optional)</span>
    <textarea bind:value={note} rows="3" placeholder="Why?"></textarea>
  </label>
  {#if err}<p class="err" role="alert">{err}</p>{/if}
  <div class="confirm">
    <button class="go" disabled={busy} onclick={confirm}>
      {busy ? 'Working…' : pending === 'approve' ? 'Confirm block' : 'Confirm allow'}
    </button>
    <button class="cancel" disabled={busy} onclick={() => (dialogOpen = false)}>Cancel</button>
  </div>
</Dialog>

<style>
  .entry { display: flex; gap: var(--vb-s3); padding: var(--vb-s4) 0; border-bottom: var(--vb-line); }
  .main { flex: 1; display: flex; flex-direction: column; gap: var(--vb-s3); }
  .head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--vb-s3); }
  .domain { font: var(--vb-fs-h3) / 1.2 var(--vb-font-mono); word-break: break-all; color: var(--vb-ink); }
  .domain:hover { color: var(--vb-accent); }
  .meta { font: var(--vb-fs-micro) / 1 var(--vb-font-mono); color: var(--vb-ink-soft); white-space: nowrap; }
  .evidence { margin: 0; font: var(--vb-fs-small) / 1.4 var(--vb-font-mono); color: var(--vb-ink-soft); }
  .evidence strong { color: var(--vb-ink); font-weight: 700; }
  .actions { display: flex; gap: var(--vb-s3); }
  .actions button { min-height: 44px; font: 700 var(--vb-fs-small) / 1 var(--vb-font-head); font-stretch: var(--vb-head-stretch); text-transform: uppercase; letter-spacing: 0.06em; padding: 8px 14px; border-radius: var(--vb-radius); cursor: pointer; border: 1.5px solid currentColor; }
  .block { color: var(--vb-accent); background: none; }
  .keep { color: var(--vb-ink-soft); background: none; }
  .proof { font-size: var(--vb-fs-small); color: var(--vb-ink-soft); padding-left: var(--vb-s3); }
  .note { display: flex; flex-direction: column; gap: 4px; margin: var(--vb-s4) 0; }
  .note span { font: var(--vb-fs-micro) / 1 var(--vb-font-mono); text-transform: uppercase; letter-spacing: 0.08em; color: var(--vb-ink-soft); }
  textarea { font: var(--vb-fs-small) / 1.4 var(--vb-font-mono); background: var(--vb-ground); color: var(--vb-ink); border: 1px solid var(--vb-rule-strong); border-radius: var(--vb-radius); padding: 8px; resize: vertical; }
  .confirm { display: flex; gap: var(--vb-s3); }
  .go { background: var(--vb-accent); color: var(--vb-accent-ink); border: 0; padding: 8px 16px; border-radius: var(--vb-radius); font-weight: 700; cursor: pointer; }
  .cancel { background: none; border: 1px solid var(--vb-rule-strong); color: var(--vb-ink); padding: 8px 16px; border-radius: var(--vb-radius); cursor: pointer; }
  .err { color: var(--vb-accent); font-size: var(--vb-fs-small); margin: 0 0 var(--vb-s3); }
  @media (max-width: 640px) {
    .head { align-items: flex-start; flex-wrap: wrap; }
    .meta { padding-top: 2px; }
  }
</style>
