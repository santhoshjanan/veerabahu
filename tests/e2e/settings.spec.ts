import { createServer, type Server } from 'node:http';
import { expect, test, type Page } from '@playwright/test';

const password = 'correct horse battery staple';
let gatekeeper: Server;
let gatekeeperUrl: string;

test.beforeAll(async () => {
  gatekeeper = createServer((request, response) => {
    if (request.url === '/auth') {
      request.resume();
      request.on('end', () => {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ session: { valid: true, sid: 'test' } }));
      });
      return;
    }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ queries: [] }));
  });
  await new Promise<void>((resolve) =>
    gatekeeper.listen(0, '127.0.0.1', resolve)
  );
  const address = gatekeeper.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  gatekeeperUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    gatekeeper.close((error) => (error ? reject(error) : resolve()))
  );
});

async function login(page: Page) {
  await page.goto('/');
  if (page.url().endsWith('/setup')) {
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByLabel('Confirm password').fill(password);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Gatekeeper URL').fill(gatekeeperUrl);
    await page
      .getByLabel('Password', { exact: true })
      .fill('pihole-app-password');
    await page.getByRole('button', { name: 'Test and continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Activate' }).click();
    await page.context().clearCookies();
    await page.goto('/');
  }
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('Settings masks configured credentials', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Settings' }).click();

  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByText('Configured')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('pihole-app-password');
  await expect(page.getByRole('link', { name: 'Quota & cost' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'System' })).toBeVisible();
});
