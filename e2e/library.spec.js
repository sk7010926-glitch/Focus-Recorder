import { test, expect } from '@playwright/test';

// Helper function to seed test recordings into IndexedDB
async function seedMockRecordings(page) {
  await page.evaluate(async () => {
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
        store.clear(); // Clear existing

        const blob = new Blob(['mock video data bytes'], { type: 'video/webm' });

        store.add({
          id: 1,
          title: 'Welcome Tutorial Walkthrough',
          blob: blob,
          duration: '01:30',
          date: '05 Sep 2026',
          size: '4.5 MB',
          tag: 'Tutorial',
        });

        store.add({
          id: 2,
          title: 'Sprint Planning Meeting Demo',
          blob: blob,
          duration: '03:15',
          date: '05 Sep 2026',
          size: '12.8 MB',
          tag: 'Meeting',
        });

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  });
}

// Helper function to clear IndexedDB
async function clearDB(page) {
  await page.evaluate(async () => {
    const DB_NAME = 'focusrecorder';
    const STORE = 'recordings';
    return new Promise((resolve) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onsuccess = (e) => {
        const db = e.target.result;
        if (db.objectStoreNames.contains(STORE)) {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).clear();
          tx.oncomplete = () => resolve();
        } else {
          resolve();
        }
      };
      req.onerror = () => resolve();
    });
  });
}

test.describe('Library Page & Media Management', () => {
  test('should display empty state when no recordings exist', async ({ page }) => {
    await page.goto('/library');
    await clearDB(page);
    await page.reload();

    await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
    await expect(page.locator('.empty-state')).toContainText('No recordings yet — start one from the Recorder!');

    // Test + New Recording button navigates to recorder
    await page.getByRole('button', { name: '+ New Recording' }).click();
    await expect(page).toHaveURL('/recorder');
  });

  test('should render seeded recordings with tags, metadata, and actions', async ({ page }) => {
    await page.goto('/library');
    await seedMockRecordings(page);
    await page.reload();

    const cards = page.locator('.recording-card');
    await expect(cards).toHaveCount(2);

    await expect(page.getByText('Welcome Tutorial Walkthrough')).toBeVisible();
    await expect(page.getByText('Sprint Planning Meeting Demo')).toBeVisible();
  });

  test('should filter recordings by search query', async ({ page }) => {
    await page.goto('/library');
    await seedMockRecordings(page);
    await page.reload();

    const searchInput = page.getByPlaceholder('Search recordings...');
    await searchInput.fill('Tutorial');

    const cards = page.locator('.recording-card');
    await expect(cards).toHaveCount(1);
    await expect(page.getByText('Welcome Tutorial Walkthrough')).toBeVisible();
    await expect(page.getByText('Sprint Planning Meeting Demo')).not.toBeVisible();

    // Clear search
    await searchInput.fill('');
    await expect(cards).toHaveCount(2);
  });

  test('should filter recordings by tag filter buttons', async ({ page }) => {
    await page.goto('/library');
    await seedMockRecordings(page);
    await page.reload();

    // Click 'Meeting' tag filter
    await page.locator('.tag-filters').getByRole('button', { name: 'Meeting' }).click();
    const cards = page.locator('.recording-card');
    await expect(cards).toHaveCount(1);
    await expect(page.getByText('Sprint Planning Meeting Demo')).toBeVisible();

    // Click 'All' tag filter
    await page.locator('.tag-filters').getByRole('button', { name: 'All' }).click();
    await expect(cards).toHaveCount(2);
  });

  test('should rename a recording using inline RenameInput', async ({ page }) => {
    await page.goto('/library');
    await seedMockRecordings(page);
    await page.reload();

    const firstCard = page.locator('.recording-card').first();
    await firstCard.getByRole('button', { name: /Rename/i }).click();

    const renameInput = firstCard.locator('.rename-input');
    await expect(renameInput).toBeVisible();

    await renameInput.fill('Updated Title via Test');
    await renameInput.press('Enter');

    await expect(page.getByText('Updated Title via Test')).toBeVisible();
  });

  test('should open and close Play modal for a recording', async ({ page }) => {
    await page.goto('/library');
    await seedMockRecordings(page);
    await page.reload();

    const firstCard = page.locator('.recording-card').first();
    await firstCard.getByRole('button', { name: /Play/i }).click();

    // Play modal should be visible
    const modal = page.locator('.play-modal');
    await expect(modal).toBeVisible();

    // Verify modal controls
    const playBtn = modal.locator('.play-modal-playbtn');
    await expect(playBtn).toBeVisible();

    // Close modal via close button
    const closeBtn = modal.locator('.play-modal-close');
    await closeBtn.click();
    await expect(modal).not.toBeVisible();
  });

  test('should delete a recording upon user confirmation', async ({ page }) => {
    await page.goto('/library');
    await seedMockRecordings(page);
    await page.reload();

    // Accept delete confirmation dialog
    page.once('dialog', (dialog) => {
      expect(dialog.message()).toContain('Delete this recording?');
      dialog.accept();
    });

    const firstCard = page.locator('.recording-card').first();
    await firstCard.locator('button.danger').click();

    // Only 1 recording card should remain
    const cards = page.locator('.recording-card');
    await expect(cards).toHaveCount(1);
  });
});
