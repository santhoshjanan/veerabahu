import { expect, test } from './fixtures';

test('shows the evidence needed to review a domain', async ({ page }) => {
  await page.goto('/review', { waitUntil: 'domcontentloaded' });

  const entry = page.locator('article', { hasText: 'tracker.ads.example' });
  await expect(entry).toContainText('Reason: phishing');
  await expect(entry).toContainText('42 hits');
  await expect(entry).toContainText('Last seen');
});

test('explains when an approved block takes effect', async ({ page }) => {
  await page.goto('/review', { waitUntil: 'domcontentloaded' });

  const entry = page.locator('article', { hasText: 'tracker.ads.example' });
  await entry.getByRole('button', { name: 'Approve block' }).click();

  await expect(page.getByRole('dialog')).toContainText(
    'Published now. Protection starts when the gatekeeper next pulls /blocklist.txt.'
  );
});

test('separates publication from gatekeeper enforcement on the dashboard', async ({
  page
}) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.getByText('Blocklist health')).toBeVisible();
  await expect(
    page.getByText(
      'Blocks you approve are published immediately. Protection begins after the next gatekeeper pull.'
    )
  ).toBeVisible();
  await expect(page.getByText('Source and list health')).toBeVisible();
  await expect(page.getByText('Blocklist recently pulled')).toBeVisible();
});

test('block a domain from the review queue and see it in the audit log', async ({
  page
}) => {
  await page.goto('/review', { waitUntil: 'domcontentloaded' });
  const entry = page.locator('article', { hasText: 'tracker.ads.example' });
  await expect(entry).toBeVisible();

  await entry.getByRole('button', { name: 'Approve block' }).click();
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
