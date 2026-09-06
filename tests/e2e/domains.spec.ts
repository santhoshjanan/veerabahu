import { expect, test } from '@playwright/test';

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

  // Esc teardown: melt closes -> onclose -> history.back()
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/\/domains(\?|$)/);

  // Re-open, then close with the browser Back button — exercises the
  // $page.state teardown path (Sheet unmounts without a second history.back()).
  await row.getByRole('link', { name: 'tracker.ads.example' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page).toHaveURL(/\/domains\/tracker\.ads\.example/);

  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // exact — a double history.back() would overshoot to bare /domains and fail here
  await expect(page).toHaveURL(/\/domains\?search=tracker$/);
});
