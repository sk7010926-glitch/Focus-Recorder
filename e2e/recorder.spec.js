import { test, expect } from '@playwright/test';

test.describe('Recorder Page Controls & Configuration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/recorder');
  });

  test('should display initial ready status and default controls', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1, name: 'Recorder' })).toBeVisible();
    await expect(page.locator('.status-pill')).toContainText('Ready to Record');
    await expect(page.getByRole('button', { name: '● Start Recording' })).toBeVisible();
    await expect(page.locator('.timer')).toHaveText('00:00:00');
  });

  test('should switch capture target mode between Window, Screen, and Tab', async ({ page }) => {
    const windowModeBtn = page.getByRole('button', { name: /Window/i });
    const screenModeBtn = page.getByRole('button', { name: /Screen/i });
    const tabModeBtn = page.getByRole('button', { name: /Tab/i });

    // Switch to Screen mode
    await screenModeBtn.click();
    await expect(screenModeBtn).toHaveClass(/selected/);
    await expect(page.locator('.preview-placeholder')).toContainText('Ready to record Screen');

    // Switch to Browser Tab mode
    await tabModeBtn.click();
    await expect(tabModeBtn).toHaveClass(/selected/);
    await expect(page.locator('.preview-placeholder')).toContainText('Ready to record Browser Tab');

    // Switch back to Window mode
    await windowModeBtn.click();
    await expect(windowModeBtn).toHaveClass(/selected/);
    await expect(page.locator('.preview-placeholder')).toContainText('Ready to record App Window');
  });

  test('should toggle Microphone, System Audio, and Webcam PIP', async ({ page }) => {
    const micBtn = page.getByRole('button', { name: /Microphone/i });
    const audioBtn = page.getByRole('button', { name: /System Audio/i });
    const camBtn = page.getByRole('button', { name: /Webcam PIP/i });

    // Toggle Microphone
    const micInitialOn = await micBtn.locator('.badge').innerText();
    await micBtn.click();
    const micNewState = micInitialOn.trim() === 'ON' ? 'OFF' : 'ON';
    await expect(micBtn.locator('.badge')).toHaveText(micNewState);

    // Toggle System Audio
    const audioInitialOn = await audioBtn.locator('.badge').innerText();
    await audioBtn.click();
    const audioNewState = audioInitialOn.trim() === 'ON' ? 'OFF' : 'ON';
    await expect(audioBtn.locator('.badge')).toHaveText(audioNewState);

    // Toggle Webcam PIP
    const camInitialOn = await camBtn.locator('.badge').innerText();
    await camBtn.click();
    const camNewState = camInitialOn.trim() === 'ON' ? 'OFF' : 'ON';
    await expect(camBtn.locator('.badge')).toHaveText(camNewState);
  });

  test('should select recording quality', async ({ page }) => {
    const q720 = page.getByRole('button', { name: '720p', exact: true });
    const q1080 = page.getByRole('button', { name: '1080p', exact: true });
    const q4k = page.getByRole('button', { name: '4K', exact: true });

    await q720.click();
    await expect(q720).toHaveClass(/selected/);
    await expect(q1080).not.toHaveClass(/selected/);

    await q4k.click();
    await expect(q4k).toHaveClass(/selected/);
    await expect(q720).not.toHaveClass(/selected/);

    await q1080.click();
    await expect(q1080).toHaveClass(/selected/);
  });
});
