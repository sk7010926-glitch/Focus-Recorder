import { test, expect } from '@playwright/test';

// Helper to seed a genuinely playable video into IndexedDB
async function seedPlayableRecording(page, durationSec = 4) {
  return await page.evaluate(async (dur) => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext('2d');

    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    const recordPromise = new Promise((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        resolve(blob);
      };
    });

    recorder.start(100);
    const start = performance.now();

    await new Promise((resolve) => {
      function draw() {
        const elapsed = (performance.now() - start) / 1000;
        // Distinct color shifts and timer text for visual frame identification
        ctx.fillStyle = `hsl(${Math.floor((elapsed / dur) * 360)}, 70%, 50%)`;
        ctx.fillRect(0, 0, 320, 240);
        ctx.fillStyle = '#ffffff';
        ctx.font = '28px monospace';
        ctx.fillText(`T=${elapsed.toFixed(2)}s`, 30, 120);

        if (elapsed < dur) {
          requestAnimationFrame(draw);
        } else {
          recorder.stop();
          resolve();
        }
      }
      requestAnimationFrame(draw);
    });

    const finalBlob = await recordPromise;

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
        const addReq = store.add({
          title: `Seek Validation Video (${dur}s)`,
          blob: finalBlob,
          duration: `00:0${dur}`,
          date: '05 Sep 2026',
          size: `${Math.round(finalBlob.size / 1024)} KB`,
          tag: 'Screen',
        });
        addReq.onsuccess = (ev) => resolve(ev.target.result);
        addReq.onerror = () => reject(addReq.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, durationSec);
}

// Click timeline at a specific ratio [0.0 - 1.0]
async function clickTimelineRatio(page, ratio) {
  const track = page.locator('.timeline-track');
  await track.waitFor({ state: 'visible' });
  const box = await track.boundingBox();
  if (!box) throw new Error('Timeline track box not found');

  const x = box.x + box.width * ratio;
  const y = box.y + box.height / 2;

  const elementAtPoint = await page.evaluate(({ cx, cy }) => {
    const el = document.elementFromPoint(cx, cy);
    return el ? { tag: el.tagName, className: el.className, id: el.id } : null;
  }, { cx: x, cy: y });
  console.log(`CLICK AT ratio ${ratio} (x=${x}, y=${y}):`, JSON.stringify(elementAtPoint));

  await track.click({ position: { x: Math.max(1, Math.min(box.width - 1, box.width * ratio)), y: box.height / 2 } });
}

test.describe('Video Playback & Timeline Seeking Suite', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to initialize db
    await page.goto('/library');
  });

  test('should seek correctly at 0%, 25%, 50%, 75%, and 98% while paused', async ({ page }) => {
    page.on('console', (msg) => console.log('PAGE:', msg.text()));
    page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));

    test.setTimeout(45000);
    const recId = await seedPlayableRecording(page, 4);
    await page.goto(`/editor?id=${recId}`);

    const video = page.locator('.editor-preview video');
    await expect(video).toBeVisible();

    // Wait for video metadata to be loaded
    await page.waitForFunction(() => {
      const v = document.querySelector('.editor-preview video');
      return v && v.readyState >= 1;
    });

    const videoInfo = await video.evaluate((v) => ({
      duration: v.duration,
      readyState: v.readyState,
      seekableLength: v.seekable.length,
      seekableEnd: v.seekable.length > 0 ? v.seekable.end(0) : null,
      paused: v.paused,
      currentTime: v.currentTime,
    }));
    console.log('INITIAL VIDEO INFO:', JSON.stringify(videoInfo));

    // 1. Initial state: paused, currentTime is 0
    let ct = await video.evaluate((v) => v.currentTime);
    expect(ct).toBe(0);

    // 2. Click 25%
    await clickTimelineRatio(page, 0.25);
    await page.waitForTimeout(300);
    ct = await video.evaluate((v) => v.currentTime);
    let paused = await video.evaluate((v) => v.paused);
    expect(paused).toBe(true);
    expect(ct).toBeGreaterThanOrEqual(0.8);
    expect(ct).toBeLessThanOrEqual(1.25);

    // 3. Click 50%
    await clickTimelineRatio(page, 0.50);
    await page.waitForTimeout(300);
    ct = await video.evaluate((v) => v.currentTime);
    paused = await video.evaluate((v) => v.paused);
    expect(paused).toBe(true);
    expect(ct).toBeGreaterThanOrEqual(1.7);
    expect(ct).toBeLessThanOrEqual(2.3);

    // 4. Click 75%
    await clickTimelineRatio(page, 0.75);
    await page.waitForTimeout(300);
    ct = await video.evaluate((v) => v.currentTime);
    paused = await video.evaluate((v) => v.paused);
    expect(paused).toBe(true);
    expect(ct).toBeGreaterThanOrEqual(2.7);
    expect(ct).toBeLessThanOrEqual(3.3);

    // 5. Click near end (98%)
    await clickTimelineRatio(page, 0.98);
    await page.waitForTimeout(300);
    ct = await video.evaluate((v) => v.currentTime);
    paused = await video.evaluate((v) => v.paused);
    expect(paused).toBe(true);
    expect(ct).toBeGreaterThanOrEqual(3.6);

    // 6. Click exactly at the beginning (0%)
    await clickTimelineRatio(page, 0.0);
    await page.waitForTimeout(300);
    ct = await video.evaluate((v) => v.currentTime);
    paused = await video.evaluate((v) => v.paused);
    expect(paused).toBe(true);
    expect(ct).toBeLessThanOrEqual(0.1);
  });

  test('should seek while playing and continue playing from new timestamp without resetting to 0', async ({ page }) => {
    test.setTimeout(45000);
    const recId = await seedPlayableRecording(page, 5);
    await page.goto(`/editor?id=${recId}`);

    const video = page.locator('.editor-preview video');
    await expect(video).toBeVisible();

    await page.waitForFunction(() => {
      const v = document.querySelector('.editor-preview video');
      return v && v.readyState >= 2;
    });

    // Start playing
    const playBtn = page.locator('.pb-btn.primary');
    await playBtn.click();

    // Verify video starts playing
    await page.waitForFunction(() => {
      const v = document.querySelector('.editor-preview video');
      return v && !v.paused && v.currentTime > 0.1;
    });

    // Seek to 50% while playing
    await clickTimelineRatio(page, 0.50);

    // Wait for seek to complete and verify playback continues past 50% (around 2.5s)
    await page.waitForFunction(() => {
      const v = document.querySelector('.editor-preview video');
      return v && !v.paused && v.currentTime >= 2.4;
    }, { timeout: 10000 });

    const ct = await video.evaluate((v) => v.currentTime);
    const isPaused = await video.evaluate((v) => v.paused);
    expect(isPaused).toBe(false);
    expect(ct).toBeGreaterThanOrEqual(2.4);

    // Pause video
    await playBtn.click();
    await page.waitForFunction(() => {
      const v = document.querySelector('.editor-preview video');
      return v && v.paused;
    });
  });

  test('should handle rapid multiple clicks and ensure the latest click wins', async ({ page }) => {
    test.setTimeout(45000);
    const recId = await seedPlayableRecording(page, 5);
    await page.goto(`/editor?id=${recId}`);

    const video = page.locator('.editor-preview video');
    await expect(video).toBeVisible();

    await page.waitForFunction(() => {
      const v = document.querySelector('.editor-preview video');
      return v && v.readyState >= 1;
    });

    // Rapid clicks: 20%, 40%, 80% in fast succession
    await clickTimelineRatio(page, 0.20);
    await clickTimelineRatio(page, 0.40);
    await clickTimelineRatio(page, 0.80);

    // Wait for all seek operations to settle
    await page.waitForTimeout(600);

    const ct = await video.evaluate((v) => v.currentTime);
    // Should be around 80% (4.0s for a 5s video), NOT reset to 0 or 20%
    expect(ct).toBeGreaterThanOrEqual(3.5);
    expect(ct).toBeLessThanOrEqual(4.5);
  });

  test('should preserve seeking correctly after Split and Delete segment operations', async ({ page }) => {
    test.setTimeout(45000);
    const recId = await seedPlayableRecording(page, 5);
    await page.goto(`/editor?id=${recId}`);

    const video = page.locator('.editor-preview video');
    await expect(video).toBeVisible();

    await page.waitForFunction(() => {
      const v = document.querySelector('.editor-preview video');
      return v && v.readyState >= 1;
    });

    // 1. Seek to 50% (2.5s) to prepare for split
    await clickTimelineRatio(page, 0.50);
    await page.waitForTimeout(400);

    // 2. Click Split button
    const splitBtn = page.locator('.tl-btn', { hasText: 'Split' });
    await expect(splitBtn).toBeEnabled();
    await splitBtn.click();

    // Verify two clips exist in timeline
    const clips = page.locator('.timeline-track .clip');
    await expect(clips).toHaveCount(2);

    // 3. Seek to 25% (in segment 1)
    await clickTimelineRatio(page, 0.25);
    await page.waitForTimeout(300);
    let ct = await video.evaluate((v) => v.currentTime);
    expect(ct).toBeGreaterThanOrEqual(0.8);
    expect(ct).toBeLessThanOrEqual(1.5);

    // 4. Seek to 75% (in segment 2)
    await clickTimelineRatio(page, 0.75);
    await page.waitForTimeout(300);
    ct = await video.evaluate((v) => v.currentTime);
    expect(ct).toBeGreaterThanOrEqual(3.2);
    expect(ct).toBeLessThanOrEqual(4.2);

    // 5. Delete Segment 2
    page.on('dialog', (dialog) => dialog.accept());
    const deleteBtn = page.locator('.tl-btn.danger', { hasText: 'Delete' });
    await deleteBtn.click();

    // Verify 1 clip remaining
    await expect(clips).toHaveCount(1);

    // 6. Seek on remaining segment
    await clickTimelineRatio(page, 0.50);
    await page.waitForTimeout(300);
    ct = await video.evaluate((v) => v.currentTime);
    // Segment 1 is 0 to 2.5s, 50% is ~1.25s
    expect(ct).toBeGreaterThanOrEqual(0.9);
    expect(ct).toBeLessThanOrEqual(1.6);
  });

  test('should keep playhead and time display synchronized during playback', async ({ page }) => {
    test.setTimeout(45000);
    const recId = await seedPlayableRecording(page, 4);
    await page.goto(`/editor?id=${recId}`);

    const video = page.locator('.editor-preview video');
    await expect(video).toBeVisible();

    await page.waitForFunction(() => {
      const v = document.querySelector('.editor-preview video');
      return v && v.readyState >= 2;
    });

    const timeDisplay = page.locator('.pb-time');
    await expect(timeDisplay).toContainText('00:00 / 00:04');

    // Start playback
    const playBtn = page.locator('.pb-btn.primary');
    await playBtn.click();

    // Wait 1.5s
    await page.waitForTimeout(1500);

    // Time display should have advanced past 00:00
    const timeText = await timeDisplay.textContent();
    expect(timeText).not.toContain('00:00 /');

    // Playhead position style should be > 10%
    const playhead = page.locator('.playhead');
    const playheadStyle = await playhead.getAttribute('style');
    expect(playheadStyle).toMatch(/left:\s*([1-9]\d*(\.\d+)?|[2-9]\d*(\.\d+)?)%/);

    // Pause playback
    await playBtn.click();
  });
});
