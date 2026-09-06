import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function dismissDiscard(page: Page) {
  const dialogPromise = page.waitForEvent('dialog');
  const click = page.getByRole('link', { name: 'Log' }).click();
  const dialog = await dialogPromise;
  expect(dialog.message()).toContain('Discard');
  await dialog.dismiss();
  await click;
}

test('Settings masks configured credentials', async ({ page }) => {
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

test('saving scoring clears its discard guard and persists the value', async ({
  page
}) => {
  await page.getByRole('link', { name: 'Settings' }).click();

  const scoring = page.locator('#scoring');
  const curatedWeight = scoring.getByLabel('Curated lists');
  await curatedWeight.fill('1.25');
  await scoring.getByRole('button', { name: 'Save scoring' }).click();
  await expect(page.locator('.notice[role="status"]')).toContainText(
    'Settings saved'
  );

  const discard = page
    .waitForEvent('dialog', { timeout: 500 })
    .then(async (dialog) => {
      await dialog.dismiss();
      return dialog.message();
    })
    .catch(() => null);
  await page.getByRole('link', { name: 'Log' }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(await discard).toBeNull();

  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(
    page.locator('#scoring').getByLabel('Curated lists')
  ).toHaveValue('1.25');
});
