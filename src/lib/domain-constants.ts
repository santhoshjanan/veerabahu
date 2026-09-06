// Client-safe domain enums — no $lib/server or drizzle imports, so browser code
// (e.g. src/routes/domains/+page.svelte) can import the value arrays.

export type DomainState =
  | 'observed'
  | 'assessing'
  | 'pending_review'
  | 'auto_cleared'
  | 'approved'
  | 'rejected';

export type SourceName = 'curated_list' | 'metadefender' | 'ai' | 'virustotal';

export type VerdictValue = 'block' | 'allow' | 'unsure' | 'error';

export const DOMAIN_STATES: DomainState[] = [
  'observed',
  'assessing',
  'pending_review',
  'auto_cleared',
  'approved',
  'rejected'
];
export const SOURCE_NAMES: SourceName[] = [
  'curated_list',
  'metadefender',
  'ai',
  'virustotal'
];
export const VERDICT_VALUES: VerdictValue[] = [
  'block',
  'allow',
  'unsure',
  'error'
];
