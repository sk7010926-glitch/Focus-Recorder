import { test, expect } from '@playwright/test';

test.describe('Settings Page & Preferences', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings');
  });

  test('should change theme between dark, light, and system', async ({ page }) => {
    const themeSelect = page.locator('.setting-row', { hasText: 'Theme' }).locator('select');
    await expect(themeSelect).toBeVisible();

    // Select light theme
    await themeSelect.selectOption('light');
    await expect(page.locator('html')).toHaveClass(/light/);

    // Select dark theme
    await themeSelect.selectOption('dark');
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('should toggle general and recording preference switches', async ({ page }) => {
    // Find auto-save switch
    const autoSaveRow = page.locator('.setting-row', { hasText: 'Auto-save after recording' });
    const autoSaveToggle = autoSaveRow.locator('button[role="switch"]');
    
    const wasChecked = await autoSaveToggle.getAttribute('aria-checked');
    await autoSaveToggle.click();
    const expected = wasChecked === 'true' ? 'false' : 'true';
    await expect(autoSaveToggle).toHaveAttribute('aria-checked', expected);

    // Save settings button should display toast message
    const saveBtn = page.getByRole('button', { name: 'Save Settings' });
    await saveBtn.click();
    await expect(page.locator('.settings-toast')).toContainText('Settings saved successfully');
  });

  test('should update recording quality and frame rate select options', async ({ page }) => {
    const qualityRow = page.locator('.setting-row', { hasText: 'Recording quality' });
    const qualitySelect = qualityRow.locator('select');
    await qualitySelect.selectOption('4K');
    await expect(qualitySelect).toHaveValue('4K');

    const fpsRow = page.locator('.setting-row', { hasText: 'Frame rate (FPS)' });
    const fpsSelect = fpsRow.locator('select');
    await fpsSelect.selectOption('60');
    await expect(fpsSelect).toHaveValue('60');
  });

  test('should edit save path text input', async ({ page }) => {
    const savePathInput = page.locator('.path-input-group input[type="text"]');
    await savePathInput.fill('C:/Recordings/TestFolder');
    await expect(savePathInput).toHaveValue('C:/Recordings/TestFolder');

    await page.getByRole('button', { name: 'Save Settings' }).click();
    await expect(page.locator('.settings-toast')).toContainText('Settings saved successfully');
  });

  test('should reset settings to defaults when confirmed via dialog', async ({ page }) => {
    // Handle the browser confirm dialog
    page.once('dialog', (dialog) => {
      expect(dialog.message()).toContain('Reset all settings to factory defaults?');
      dialog.accept();
    });

    const resetBtn = page.getByRole('button', { name: 'Reset' });
    await resetBtn.click();

    await expect(page.locator('.settings-toast')).toContainText('Settings reset to defaults');
  });

  test('should handle Clear Library confirmation in Danger Zone', async ({ page }) => {
    page.once('dialog', (dialog) => {
      expect(dialog.message()).toContain('Permanently delete ALL recordings?');
      dialog.accept();
    });

    const clearLibraryBtn = page.getByRole('button', { name: 'Clear Library' });
    await clearLibraryBtn.click();

    await expect(page.locator('.settings-toast')).toContainText('Cleared');
  });
});
