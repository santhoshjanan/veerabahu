import { createServer, type Server } from 'node:http';
import { expect, test, type Page } from '@playwright/test';

const password = 'correct horse battery staple';
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
          return;
        }
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

async function dismissDiscard(page: Page) {
  const dialogPromise = page.waitForEvent('dialog');
  const click = page.getByRole('link', { name: 'Log' }).click();
  const dialog = await dialogPromise;
  expect(dialog.message()).toContain('Discard');
  await dialog.dismiss();
  await click;
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

  const sourcesSection = page.locator('#sources');
  const curatedEnabled = sourcesSection.getByLabel('Enabled').first();
  await curatedEnabled.uncheck();
  await sourcesSection.getByRole('button', { name: 'Save sources' }).click();
  await expect(curatedEnabled).toHaveAttribute('aria-invalid', 'true');
  await expect(curatedEnabled).toHaveAttribute(
    'aria-describedby',
    'sources-curatedListEnabled-error'
  );
  await curatedEnabled.check();
  await sourcesSection.getByRole('button', { name: 'Save sources' }).click();

  const gatekeeperSection = page.locator('#gatekeeper');
  await gatekeeperSection.getByLabel('Password').fill('wrong');
  await gatekeeperSection
    .getByRole('button', { name: 'Test and save' })
    .click();
  await expect(gatekeeperSection.getByRole('status')).toContainText(
    'Authentication rejected'
  );
  await dismissDiscard(page);
  await expect(page).toHaveURL(/\/settings$/);

  await gatekeeperSection.getByLabel('Password').fill('pihole-app-password');
  await page
    .locator('#sources')
    .getByLabel('List URLs')
    .fill('https://example.com/blocklist.txt');
  await gatekeeperSection
    .getByRole('button', { name: 'Test and save' })
    .click();
  await expect(page.locator('.notice[role="status"]')).toContainText(
    'settings saved'
  );
  await dismissDiscard(page);
  await expect(page).toHaveURL(/\/settings$/);

  await page
    .locator('#sources')
    .getByRole('button', { name: 'Save sources' })
    .click();
  await expect(page.locator('.notice[role="status"]')).toContainText(
    'Settings saved'
  );
  await page.getByRole('link', { name: 'Log' }).click();
  await expect(page).toHaveURL(/\/$/);
});
