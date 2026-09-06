import { createServer, type Server } from 'node:http';
import { expect, test } from '@playwright/test';

let gatekeeper: Server;
let gatekeeperUrl: string;

test.beforeAll(async () => {
  gatekeeper = createServer((request, response) => {
    if (request.url === '/auth') {
      let body = '';
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        response.setHeader('content-type', 'application/json');
        if (JSON.parse(body).password === 'wrong') {
          response.statusCode = 401;
          response.end('{}');
        } else {
          response.end(
            JSON.stringify({ session: { valid: true, sid: 'test' } })
          );
        }
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

test('setup blocks the log until activation', async ({ page }) => {
  await page.goto('/review');
  await expect(page).toHaveURL(/\/setup/);

  await page
    .getByLabel('Password', { exact: true })
    .fill('correct horse battery staple');
  await page
    .getByLabel('Confirm password')
    .fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByLabel('Gatekeeper URL').fill(gatekeeperUrl);
  await page.getByLabel('Password', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'Test and continue' }).click();
  await expect(page.getByRole('status')).toContainText(
    'Authentication rejected'
  );
  await page
    .getByLabel('Password', { exact: true })
    .fill('pihole-app-password');
  await page.getByRole('button', { name: 'Test and continue' }).click();
  await expect(page.getByRole('status')).toContainText('Connected');

  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  const sourceSummary = page.getByRole('table', {
    name: 'Reputation sources'
  });
  await expect(sourceSummary).toContainText('Curated lists');
  await expect(sourceSummary).toContainText('MetaDefender');
  await expect(sourceSummary).toContainText('No ceiling');
  await expect(
    sourceSummary
      .getByRole('row')
      .filter({ hasText: 'Curated lists' })
      .getByRole('cell')
      .nth(1)
  ).toHaveText('Local');
  await expect(
    sourceSummary
      .getByRole('row')
      .filter({ hasText: 'AI provider' })
      .getByRole('cell')
      .nth(1)
  ).toHaveText('Not configured');
  await expect(page.getByText('Configured ••••••••')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('pihole-app-password');
  await expect(page.getByText('/blocklist.txt')).toBeVisible();
  await expect(page.getByText(/roughly every hour/i)).toBeVisible();
  await page.getByRole('button', { name: 'Activate' }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('navigation')).toBeVisible();

  await page.goto('/settings');
  await expect(page).toHaveURL(/\/settings$/);
});
