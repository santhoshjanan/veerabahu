import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

describe('CI configuration', () => {
  it('ci.yml exists and contains check and test-sqlite jobs', () => {
    expect(existsSync('.github/workflows/ci.yml')).toBe(true);
    const content = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(content).toContain('check:');
    expect(content).toContain('test-sqlite:');
    expect(content).toContain('pnpm lint');
    expect(content).toContain('pnpm check');
    expect(content).toContain('pnpm test:cov');
    expect(content).toContain('VB_DISABLE_SCHEDULERS=true pnpm build');
  });

  it('ci.yml omits test-postgres job per Amendment #7', () => {
    const content = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(content).not.toContain('test-postgres:');
  });

  it('package.json contains test:pg script', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.scripts['test:pg']).toBe(
      'TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres vitest run'
    );
  });
});
