import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

describe('docker artifacts', () => {
  it('Dockerfile exists and builds with schedulers disabled', () => {
    expect(existsSync('Dockerfile')).toBe(true);
    expect(readFileSync('Dockerfile', 'utf8')).toContain(
      'VB_DISABLE_SCHEDULERS=true pnpm build'
    );
  });
  it('compose exposes a data volume and keeps Valkey commented out', () => {
    const c = readFileSync('docker-compose.yml', 'utf8');
    expect(c).toContain('veerabahu-data:/app/data');
    expect(c).toMatch(/#\s+valkey:/);
  });
});
