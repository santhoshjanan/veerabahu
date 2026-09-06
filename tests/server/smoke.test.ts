import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('smoke', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
  it('gives operators a local reset path', () => {
    expect(readFileSync('README.md', 'utf8')).toContain('reset-and-onboard');
  });
});
