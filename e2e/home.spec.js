import { test, expect } from '@playwright/test';

test.describe('Home Page Flow & Content', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should display hero section, badge, and stats', async ({ page }) => {
    await expect(page.locator('.hero-badge')).toHaveText('✨ Now with 4K recording');
    await expect(page.locator('h1.hero-title')).toContainText('Record anything.');
    await expect(page.locator('h1.hero-title')).toContainText('Share everything.');

    // Verify stats strip
    const stats = page.locator('.stat-item');
    await expect(stats).toHaveCount(4);
    await expect(stats.getByText('4K', { exact: true })).toBeVisible();
    await expect(stats.getByText('Max Resolution')).toBeVisible();
    await expect(stats.getByText('60fps')).toBeVisible();
    await expect(stats.getByText('100%')).toBeVisible();
    await expect(stats.getByText('Local & Private')).toBeVisible();
  });

  test('should display all feature cards', async ({ page }) => {
    const featuresHeading = page.getByRole('heading', { level: 2, name: /Everything you need/i });
    await expect(featuresHeading).toBeVisible();

    const featureCards = page.locator('.feature-card');
    await expect(featureCards).toHaveCount(6);

    await expect(page.getByRole('heading', { level: 3, name: 'Screen Recording' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Microphone & System Audio' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Webcam Overlay' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Built-in Editor' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Local Library' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Instant Export' })).toBeVisible();
  });

  test('should navigate to Recorder from Hero "Start Recording" button', async ({ page }) => {
    const heroStartBtn = page.getByRole('button', { name: '🎬 Start Recording' });
    await heroStartBtn.click();
    await expect(page).toHaveURL('/recorder');
    await expect(page.getByRole('heading', { level: 1, name: 'Recorder' })).toBeVisible();
  });

  test('should navigate to Library from Hero "View Library" button', async ({ page }) => {
    const heroLibraryBtn = page.getByRole('button', { name: '📂 View Library' });
    await heroLibraryBtn.click();
    await expect(page).toHaveURL('/library');
    await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
  });

  test('should navigate to Recorder from bottom CTA banner button', async ({ page }) => {
    const ctaBannerBtn = page.getByRole('button', { name: '🔴 Start Recording Now' });
    await ctaBannerBtn.click();
    await expect(page).toHaveURL('/recorder');
    await expect(page.getByRole('heading', { level: 1, name: 'Recorder' })).toBeVisible();
  });
});
