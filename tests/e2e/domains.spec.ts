import { expect, test } from './fixtures';

test('search domains and open a record in the side sheet', async ({ page }) => {
  await page.goto('/domains', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('domain contains…').fill('tracker');
  await page.getByRole('button', { name: 'Filter' }).click();
  await expect(page).toHaveURL(/search=tracker/);

  const row = page.locator('tbody tr', { hasText: 'tracker.ads.example' });
  await expect(row).toBeVisible();
  await row.getByRole('link', { name: 'tracker.ads.example' }).click();

  const sheet = page.getByRole('dialog');
  await expect(sheet).toContainText('Score derivation');
  await expect(sheet).toContainText('metadefender');
  await expect(page).toHaveURL(/\/domains\/tracker\.ads\.example/);

  // Close control tears down immediately, then restores the prior URL.
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/\/domains(\?|$)/);
  await expect(
    row.getByRole('link', { name: 'tracker.ads.example' })
  ).toBeFocused();

  // Re-open, then close with the browser Back button — exercises the
  // $page.state teardown path (Sheet unmounts without a second history.back()).
  await row.getByRole('link', { name: 'tracker.ads.example' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page).toHaveURL(/\/domains\/tracker\.ads\.example/);

  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // exact — a double history.back() would overshoot to bare /domains and fail here
  await expect(page).toHaveURL(/\/domains\?search=tracker$/);

  await page.goForward();
  await expect(page.getByRole('dialog')).toContainText('Score derivation');
  await expect(page).toHaveURL(/\/domains\/tracker\.ads\.example/);

  await page.getByRole('button', { name: 'Add to allowlist' }).click();
  await expect(page.getByRole('dialog')).toContainText('On the allowlist');
  await expect(page.getByRole('dialog')).toBeVisible();
});
