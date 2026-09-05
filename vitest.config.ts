import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/lib/server/**'],
      thresholds: { lines: 90, functions: 90, branches: 80, statements: 90 }
    }
  },
  resolve: {
    alias: { $lib: new URL('./src/lib', import.meta.url).pathname }
  }
});
