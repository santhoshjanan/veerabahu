import { createServer } from 'node:http';
import { test as base, expect } from '@playwright/test';
import { seedE2eDb } from './seed';

export { expect };
export const test = base.extend<{
  configured: boolean;
  gatekeeperUrl: string;
  seeded: void;
}>({
  configured: [true, { option: true }],
  gatekeeperUrl: async ({}, use) => {
    const server = createServer((request, response) => {
      if (request.url === '/list') {
        response.end('tracker.ads.example\n');
        return;
      }
      response.setHeader('content-type', 'application/json');
      if (request.url === '/auth') {
        let body = '';
        request.on('data', (chunk) => (body += chunk));
        request.on('end', () => {
          if (JSON.parse(body).password === 'wrong') {
            response.statusCode = 401;
            response.end('{}');
          } else
            response.end(
              JSON.stringify({ session: { valid: true, sid: 'test' } })
            );
        });
      } else response.end(JSON.stringify({ queries: [] }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve)
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('No test port');
    try {
      await use(`http://127.0.0.1:${address.port}`);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  },
  seeded: async ({ configured, gatekeeperUrl }, use) => {
    await seedE2eDb({ configured, gatekeeperUrl });
    await use();
  },
  page: async ({ page, seeded, configured }, use) => {
    void seeded;
    if (configured) {
      await page.goto('/login');
      await page.getByLabel('Password').fill('correct horse battery staple');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page).toHaveURL(/\/$/);
    }
    await use(page);
  }
});
