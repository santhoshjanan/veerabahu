import { expect, test } from './fixtures';

test.use({ configured: false });

test('setup blocks the log until activation', async ({
  page,
  gatekeeperUrl
}) => {
  const password = page.getByLabel(/^Password\b/);

  await page.goto('/review');
  await expect(page).toHaveURL(/\/setup/);

  await password.fill('correct horse battery staple');
  await page
    .getByLabel('Confirm password')
    .fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByLabel('Gatekeeper URL').fill(gatekeeperUrl);
  await password.fill('wrong');
  await page.getByRole('button', { name: 'Test and continue' }).click();
  await expect(page.getByRole('status')).toContainText(
    'Authentication rejected'
  );
  await password.fill('pihole-app-password');
  await page.getByRole('button', { name: 'Test and continue' }).click();
  await expect(page.getByRole('status')).toContainText('Connected');

  await page.getByLabel('List URLs').fill(`${gatekeeperUrl}/list`);
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
      .nth(2)
  ).toHaveText('Local');
  await expect(
    sourceSummary
      .getByRole('row')
      .filter({ hasText: 'AI provider' })
      .getByRole('cell')
      .nth(2)
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

test('resuming setup requires the admin password after secure access is created', async ({
  page,
  request
}) => {
  await page.goto('/setup');
  await page
    .getByLabel('Password', { exact: true })
    .fill('correct horse battery staple');
  await page
    .getByLabel('Confirm password')
    .fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByLabel('Gatekeeper URL')).toBeVisible();

  for (const url of [
    '/setup',
    '/setup?/gatekeeper',
    '/setup?/sources',
    '/setup?/activate'
  ]) {
    const response = await request.get(url, { maxRedirects: 0 });
    expect(response.status()).toBe(303);
    expect(response.headers().location).toBe('/login');
  }
  const attack = await request.post('/setup?/gatekeeper', {
    headers: { origin: new URL(page.url()).origin, accept: 'text/html' },
    form: { type: 'pihole', baseUrl: 'http://attacker.invalid', password: '' },
    maxRedirects: 0
  });
  expect(attack.status()).toBe(303);
  expect(attack.headers().location).toBe('/login');
  await page.context().clearCookies();
  await page.goto('/setup');
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('Password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByLabel('Gatekeeper URL')).toBeVisible();
});
