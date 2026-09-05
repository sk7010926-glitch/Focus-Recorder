import { test, expect } from '@playwright/test';

test.describe('Navigation & Responsive Layout', () => {
  test('should navigate between all primary routes via desktop navbar', async ({ page }) => {
    await page.goto('/');

    // Verify Home is active
    await expect(page.locator('.navbar-links .nav-item.active')).toHaveText('Home');

    // Click Recorder
    await page.locator('.navbar-links').getByRole('link', { name: 'Recorder' }).click();
    await expect(page).toHaveURL('/recorder');
    await expect(page.locator('.navbar-links .nav-item.active')).toHaveText('Recorder');
    await expect(page.getByRole('heading', { level: 1, name: 'Recorder' })).toBeVisible();

    // Click Library
    await page.locator('.navbar-links').getByRole('link', { name: 'Library' }).click();
    await expect(page).toHaveURL('/library');
    await expect(page.locator('.navbar-links .nav-item.active')).toHaveText('Library');
    await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();

    // Click Editor
    await page.locator('.navbar-links').getByRole('link', { name: 'Editor' }).click();
    await expect(page).toHaveURL('/editor');
    await expect(page.locator('.navbar-links .nav-item.active')).toHaveText('Editor');
    await expect(page.getByRole('heading', { level: 1, name: 'Editor' })).toBeVisible();

    // Click Settings
    await page.locator('.navbar-links').getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL('/settings');
    await expect(page.locator('.navbar-links .nav-item.active')).toHaveText('Settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();

    // Click Brand Logo to return to Home
    await page.locator('.navbar-logo').click();
    await expect(page).toHaveURL('/');
    await expect(page.locator('.navbar-links .nav-item.active')).toHaveText('Home');
  });

  test('should toggle mobile menu drawer and navigate on small screens', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    const hamburger = page.getByRole('button', { name: 'Toggle navigation menu' });
    await expect(hamburger).toBeVisible();

    // Mobile menu drawer should be closed initially
    const mobileMenu = page.locator('.mobile-menu');
    await expect(mobileMenu).not.toHaveClass(/show/);

    // Open hamburger menu
    await hamburger.click();
    await expect(mobileMenu).toHaveClass(/show/);

    // Click 'Settings' in mobile drawer
    await mobileMenu.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL('/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();

    // Drawer should auto-close after navigation
    await expect(mobileMenu).not.toHaveClass(/show/);
  });
});
