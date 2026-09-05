import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      // Sub-project #2 spec §8: gate on TypeScript only; screens are covered by Playwright.
      include: ['src/lib/**', 'src/routes/**/*.ts'],
      exclude: ['**/*.svelte', 'src/routes/**/*.svelte'],
      thresholds: { lines: 90, functions: 90, branches: 80, statements: 90 }
    }
  },
  resolve: {
    alias: { $lib: new URL('./src/lib', import.meta.url).pathname }
  }
});
