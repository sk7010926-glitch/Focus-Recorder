import { test, expect } from '@playwright/test';

// Helper to seed a recording for editor testing
async function seedEditorRecording(page) {
  return await page.evaluate(async () => {
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

        // Create a minimal valid video/webm blob
        const blob = new Blob(['mock video payload'], { type: 'video/webm' });

        const addReq = store.add({
          title: 'Editor Test Video',
          blob: blob,
          duration: '00:10',
          date: '05 Sep 2026',
          size: '2.1 MB',
          tag: 'Tutorial',
        });

        addReq.onsuccess = (ev) => resolve(ev.target.result);
        addReq.onerror = () => reject(addReq.error);
      };
      req.onerror = () => reject(req.error);
    });
  });
}

test.describe('Editor Page & Video Editing Controls', () => {
  test('should show empty state when no recording ID is specified', async ({ page }) => {
    await page.goto('/editor');

    await expect(page.getByRole('heading', { level: 1, name: 'Editor' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'No Recording Selected' })).toBeVisible();

    const goLibBtn = page.getByRole('button', { name: '📂 Go to Library' });
    await expect(goLibBtn).toBeVisible();
    await goLibBtn.click();
    await expect(page).toHaveURL('/library');
  });

  test('should show error state when an invalid recording ID is provided', async ({ page }) => {
    await page.goto('/editor?id=999999');

    await expect(page.getByRole('heading', { level: 3, name: 'Error Loading Recording' })).toBeVisible();
    await expect(page.getByText('Recording not found in database.')).toBeVisible();

    const backLibBtn = page.getByRole('button', { name: '📂 Back to Library' });
    await expect(backLibBtn).toBeVisible();
    await backLibBtn.click();
    await expect(page).toHaveURL('/library');
  });

  test('should load editor interface when valid recording ID is provided', async ({ page }) => {
    await page.goto('/library');
    const newId = await seedEditorRecording(page);

    await page.goto(`/editor?id=${newId}`);

    // Verify title and workspace
    await expect(page.locator('.page-header')).toContainText('Editing: Editor Test Video');
    await expect(page.locator('.editor-preview')).toBeVisible();

    // Verify playback control buttons are present in playback-bar
    await expect(page.locator('.playback-bar')).toBeVisible();
    await expect(page.locator('.pb-btn[title="Go to Start"]')).toBeVisible();
    await expect(page.locator('.pb-btn[title="Backward 5 seconds"]')).toBeVisible();
    await expect(page.locator('.pb-btn[title="Forward 5 seconds"]')).toBeVisible();
    await expect(page.locator('.pb-btn[title="Go to End"]')).toBeVisible();
  });

  test('should toggle color adjustment panel and display adjustment notice or controls', async ({ page }) => {
    await page.goto('/library');
    const newId = await seedEditorRecording(page);
    await page.goto(`/editor?id=${newId}`);

    // Open color adjustment panel
    const colorToggleBtn = page.getByRole('button', { name: /Color/i });
    await colorToggleBtn.click();

    // Verify color panel is open
    const colorPanel = page.locator('.color-panel');
    await expect(colorPanel).toBeVisible();
    await expect(colorPanel.locator('.color-panel-title')).toContainText('Color Adjustments');
  });

  test('should display export section and allow changing export resolution', async ({ page }) => {
    await page.goto('/library');
    const newId = await seedEditorRecording(page);
    await page.goto(`/editor?id=${newId}`);

    const exportSection = page.locator('.export-section');
    await expect(exportSection).toBeVisible();

    const resolutionSelect = exportSection.locator('.prop-group', { hasText: 'Resolution' }).locator('select');
    await resolutionSelect.selectOption('4k');
    await expect(resolutionSelect).toHaveValue('4k');

    await resolutionSelect.selectOption('720');
    await expect(resolutionSelect).toHaveValue('720');
  });
});
