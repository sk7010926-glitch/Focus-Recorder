import { test, expect } from '@playwright/test';

test.describe('FocusRecorder Smoke Tests', () => {
  test('should load the main page successfully and display key elements', async ({ page }) => {
    // Navigate to base URL (root page)
    await page.goto('/');

    // Verify main page title / heading is visible
    const heroTitle = page.locator('h1.hero-title');
    await expect(heroTitle).toBeVisible();
    await expect(heroTitle).toContainText('Record anything.');

    // Verify action buttons are present and visible
    const startRecordingButton = page.getByRole('button', { name: /Start Recording/i }).first();
    await expect(startRecordingButton).toBeVisible();

    const viewLibraryButton = page.getByRole('button', { name: /View Library/i });
    await expect(viewLibraryButton).toBeVisible();

    // Verify features section is rendered
    const featuresHeading = page.getByRole('heading', { name: /Everything you need/i });
    await expect(featuresHeading).toBeVisible();
  });
});
