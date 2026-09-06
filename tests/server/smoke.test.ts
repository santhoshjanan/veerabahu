import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('smoke', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
  it('gives operators a local reset path', () => {
    const readme = readFileSync('README.md', 'utf8');
    expect(readme).toContain('reset-and-onboard');
    expect(readme).toContain('veerabahu-data-backup.tgz');
    expect(readme).toContain('docker compose rm -f veerabahu');
    expect(readme).toContain('docker volume rm "$DATA_VOLUME"');
  });
});
