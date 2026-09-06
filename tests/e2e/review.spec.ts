import { expect, test } from './fixtures';

test('block a domain from the review queue and see it in the audit log', async ({
  page
}) => {
  await page.goto('/review', { waitUntil: 'domcontentloaded' });
  const entry = page.locator('article', { hasText: 'tracker.ads.example' });
  await expect(entry).toBeVisible();

  await entry.getByRole('button', { name: 'Block it' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('/blocklist.txt');
  await dialog.getByRole('button', { name: 'Confirm block' }).click();

  // feedback is the entry dropping out of the list
  await expect(
    page.locator('article', { hasText: 'tracker.ads.example' })
  ).toHaveCount(0);

  await page.goto('/audit?event=decision.approve', {
    waitUntil: 'domcontentloaded'
  });
  await expect(
    page.locator('td', { hasText: 'decision.approve' }).first()
  ).toBeVisible();
});
