import { test, expect } from '@playwright/test';

test.describe('End-to-End User Workflows', () => {
  test('Complete Flow: Home -> Settings Customization -> Recorder Setup -> Navigation', async ({ page }) => {
    // 1. Start from Homepage
    await page.goto('/');
    await expect(page.locator('h1.hero-title')).toBeVisible();

    // 2. Navigate to Settings and customize theme & settings
    await page.locator('.navbar-links').getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL('/settings');

    const themeSelect = page.locator('.setting-row', { hasText: 'Theme' }).locator('select');
    await themeSelect.selectOption('light');
    await expect(page.locator('html')).toHaveClass(/light/);

    // 3. Navigate to Recorder from navbar
    await page.locator('.navbar-links').getByRole('link', { name: 'Recorder' }).click();
    await expect(page).toHaveURL('/recorder');

    // 4. Configure Recorder target & quality
    const screenModeBtn = page.getByRole('button', { name: /Screen/i });
    await screenModeBtn.click();
    await expect(screenModeBtn).toHaveClass(/selected/);

    const q4k = page.getByRole('button', { name: '4K', exact: true });
    await q4k.click();
    await expect(q4k).toHaveClass(/selected/);

    // 5. Navigate to Library
    await page.locator('.navbar-links').getByRole('link', { name: 'Library' }).click();
    await expect(page).toHaveURL('/library');
    await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
  });

  test('Complete Flow: Seed Recording -> Library Manage -> Editor Flow -> Cleanup', async ({ page }) => {
    // 1. Visit library & seed a recording directly into IndexedDB
    await page.goto('/library');
    const recordingId = await page.evaluate(async () => {
      const DB_NAME = 'focusrecorder';
      const STORE = 'recordings';
      const VERSION = 1;

      return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, VERSION);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE)) {
            db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          }
        };
        req.onsuccess = (e) => {
          const db = e.target.result;
          const tx = db.transaction(STORE, 'readwrite');
          const store = tx.objectStore(STORE);
          const blob = new Blob(['sample recording content'], { type: 'video/webm' });

          const addReq = store.add({
            title: 'End-to-End Workflow Video',
            blob: blob,
            duration: '00:45',
            date: '05 Sep 2026',
            size: '3.4 MB',
            tag: 'Demo',
          });

          addReq.onsuccess = (ev) => resolve(ev.target.result);
          addReq.onerror = () => reject(addReq.error);
        };
        req.onerror = () => reject(req.error);
      });
    });

    await page.reload();

    // 2. Verify recording is in the Library
    const card = page.locator('.recording-card').first();
    await expect(card).toBeVisible();
    await expect(card.getByText('End-to-End Workflow Video')).toBeVisible();

    // 3. Click Edit on the recording card
    await card.getByRole('button', { name: /Edit/i }).click();
    await expect(page).toHaveURL(`/editor?id=${recordingId}`);
    await expect(page.locator('.page-header')).toContainText('Editing: End-to-End Workflow Video');

    // 4. Return to Library and delete the recording
    await page.locator('.navbar-links').getByRole('link', { name: 'Library' }).click();
    await expect(page).toHaveURL('/library');

    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('.recording-card').first().locator('button.danger').click();

    // 5. Verify library returns to empty state
    await expect(page.locator('.empty-state')).toBeVisible();
  });
});
