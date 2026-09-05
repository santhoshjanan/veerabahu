import type { DomainState, VerdictValue } from './server/db/types';

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

export function relativeTime(
  atMs: number | null | undefined,
  nowMs: number = Date.now()
): string {
  if (!atMs || Number.isNaN(atMs)) return 'never';
  const d = Math.max(0, nowMs - atMs);
  if (d < MIN) return 'just now';
  if (d < HOUR) return `${Math.floor(d / MIN)}m ago`;
  if (d < DAY) return `${Math.floor(d / HOUR)}h ago`;
  return `${Math.floor(d / DAY)}d ago`;
}

export function formatDuration(ms: number | null): string {
  if (ms === null || ms <= 0) return 'drained';
  if (ms < HOUR) return `~${Math.round(ms / MIN)}m`;
  if (ms < DAY) return `~${Math.round(ms / HOUR)}h`;
  const days = Math.floor(ms / DAY);
  const hours = Math.round((ms % DAY) / HOUR);
  return hours ? `~${days}d ${hours}h` : `~${days}d`;
}

export function scoreLabel(score: number | null): {
  text: string;
  tone: 'block' | 'allow' | 'mixed' | 'none';
} {
  if (score === null) return { text: '—', tone: 'none' };
  if (score <= -0.5) return { text: 'strong block', tone: 'block' };
  if (score < 0) return { text: 'leans block', tone: 'block' };
  if (score === 0) return { text: 'mixed', tone: 'mixed' };
  if (score < 0.6) return { text: 'leans allow', tone: 'allow' };
  return { text: 'strong allow', tone: 'allow' };
}

const STATE_LABEL: Record<DomainState, string> = {
  observed: 'Observed',
  assessing: 'Assessing',
  pending_review: 'Awaiting decision',
  auto_cleared: 'Auto-cleared',
  approved: 'Published',
  rejected: 'Kept'
};
export const stateLabel = (s: DomainState): string => STATE_LABEL[s];

const STATE_STAMP: Record<DomainState, string> = {
  observed: 'OBSERVED',
  assessing: 'ASSESSING',
  pending_review: 'PENDING',
  auto_cleared: 'AUTO-CLEAR',
  approved: 'BLOCKED',
  rejected: 'KEPT'
};
export const stateStampText = (s: DomainState): string => STATE_STAMP[s];

const VERDICT_LABEL: Record<VerdictValue, string> = {
  block: 'Block',
  allow: 'Allow',
  unsure: 'Unsure',
  error: 'Error'
};
export const verdictLabel = (v: VerdictValue): string => VERDICT_LABEL[v];

const NUM = new Intl.NumberFormat('en-US');
export const formatCount = (n: number): string => NUM.format(n);

export function formatUsd(n: number): string {
  const dp = n >= 1 || n === 0 ? 2 : 4;
  return `$${n.toFixed(dp)}`;
}
