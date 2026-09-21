import { test, expect } from '@playwright/test';

test.describe('Webcam Multi-Laptop & Device Compatibility', () => {
  test('should handle stale deviceId from another laptop and successfully initialize camera', async ({ page }) => {
    // Seed localStorage with a fake camera deviceId from another laptop
    await page.addInitScript(() => {
      localStorage.setItem('focusrecorder:settings', JSON.stringify({
        recordingQuality: '1080p',
        fps: 30,
        saveFormat: 'mp4',
        microphoneId: 'old-laptop-mic-id',
        webcamId: 'old-laptop-webcam-id',
      }));

      // Mock mediaDevices on Laptop B with its own cameras
      const fakeStream = {
        active: true,
        getTracks: () => [
          {
            kind: 'video',
            label: 'Integrated Camera (Laptop B)',
            stop: () => {},
            getVideoTracks: () => [],
            addEventListener: () => {},
            removeEventListener: () => {},
          }
        ],
        getVideoTracks: () => [
          {
            kind: 'video',
            label: 'Integrated Camera (Laptop B)',
            stop: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
          }
        ],
        getAudioTracks: () => [],
      };

      navigator.mediaDevices.enumerateDevices = async () => [
        { deviceId: 'laptop-b-builtin-cam', kind: 'videoinput', label: 'Integrated Camera (Laptop B)' },
        { deviceId: 'laptop-b-usb-cam', kind: 'videoinput', label: 'USB HD Webcam' },
        { deviceId: 'laptop-b-builtin-mic', kind: 'audioinput', label: 'Internal Microphone' }
      ];

      navigator.mediaDevices.getUserMedia = async (constraints) => {
        // If exact was used with old laptop ID, it would fail. Our code uses ideal/fallbacks!
        if (constraints?.video?.deviceId?.exact === 'old-laptop-webcam-id') {
          const err = new Error('Device not found');
          err.name = 'OverconstrainedError';
          throw err;
        }
        return fakeStream;
      };
    });

    await page.goto('/recorder');

    // Toggle Webcam PIP
    const camBtn = page.getByRole('button', { name: /Webcam PIP/i });
    await camBtn.click();
    await expect(camBtn.locator('.badge')).toHaveText('ON');

    // PIP video overlay should become visible
    const camPip = page.locator('video.webcam-pip');
    await expect(camPip).toHaveClass(/visible/);

    // No error banner should be displayed
    await expect(page.locator('.error-banner')).toHaveCount(0);
  });

  test('should display clear, actionable error for NotAllowedError (permission denied)', async ({ page }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        const err = new Error('Permission denied');
        err.name = 'NotAllowedError';
        throw err;
      };
    });

    await page.goto('/recorder');
    const camBtn = page.getByRole('button', { name: /Webcam PIP/i });
    await camBtn.click();

    // Verify error banner contains specific guidance
    const errorBanner = page.locator('.error-banner');
    await expect(errorBanner).toBeVisible();
    await expect(errorBanner).toContainText('Camera permission denied');
    await expect(camBtn.locator('.badge')).toHaveText('OFF');
  });

  test('should display clear error for NotFoundError (no camera found)', async ({ page }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        const err = new Error('No video device found');
        err.name = 'NotFoundError';
        throw err;
      };
    });

    await page.goto('/recorder');
    const camBtn = page.getByRole('button', { name: /Webcam PIP/i });
    await camBtn.click();

    const errorBanner = page.locator('.error-banner');
    await expect(errorBanner).toBeVisible();
    await expect(errorBanner).toContainText('No camera found');
  });

  test('should display clear error for NotReadableError (camera in use by another app)', async ({ page }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        const err = new Error('Device in use');
        err.name = 'NotReadableError';
        throw err;
      };
    });

    await page.goto('/recorder');
    const camBtn = page.getByRole('button', { name: /Webcam PIP/i });
    await camBtn.click();

    const errorBanner = page.locator('.error-banner');
    await expect(errorBanner).toBeVisible();
    await expect(errorBanner).toContainText('already in use by another application');
  });

  test('should enumerate multiple cameras on Settings page and auto-heal stale deviceId', async ({ page }) => {
    // Seed with stale IDs from laptop A
    await page.addInitScript(() => {
      localStorage.setItem('focusrecorder:settings', JSON.stringify({
        recordingQuality: '1080p',
        fps: 30,
        saveFormat: 'mp4',
        microphoneId: 'stale-laptop-a-mic',
        webcamId: 'stale-laptop-a-cam',
      }));

      navigator.mediaDevices.enumerateDevices = async () => [
        { deviceId: 'builtin-cam-id', kind: 'videoinput', label: 'Built-in Laptop Camera' },
        { deviceId: 'usb-cam-id', kind: 'videoinput', label: 'USB HD Webcam 1080p' },
        { deviceId: 'realtek-mic-id', kind: 'audioinput', label: 'Realtek Audio Mic' }
      ];

      navigator.mediaDevices.getUserMedia = async () => ({
        getTracks: () => [{ stop: () => {} }]
      });
    });

    await page.goto('/settings');

    // Both cameras should be populated in the dropdown
    const webcamSelect = page.locator('select').nth(1); // Default webcam select
    await expect(webcamSelect).toBeVisible();

    // Check options
    const options = webcamSelect.locator('option');
    await expect(options).toHaveCount(3); // "System default", "Built-in Laptop Camera", "USB HD Webcam 1080p"
    await expect(options.nth(1)).toHaveText('Built-in Laptop Camera');
    await expect(options.nth(2)).toHaveText('USB HD Webcam 1080p');

    // Because 'stale-laptop-a-cam' did not exist on this machine, it should auto-heal to "" (System default)
    await expect(webcamSelect).toHaveValue('');
  });
});
