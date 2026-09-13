import { test, expect } from '@playwright/test';

/**
 * Helper: seed a genuine, playable WebM video into IndexedDB via Canvas +
 * MediaRecorder so the Editor has a real video to work with.
 */
async function seedPlayableRecording(page, durationSec = 6) {
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
          title: `Full Flow Test Video (${dur}s)`,
          blob: finalBlob,
          duration: `00:0${dur}`,
          date: '13 Sep 2026',
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

/**
 * Wait for the <video> in the editor preview to have its src set AND
 * readyState >= targetState. Retries by re-querying the element.
 * Uses a generous timeout to survive WebM header-patching latency.
 */
async function waitForVideoReady(page, targetReadyState = 1, timeoutMs = 30000) {
  await page.waitForFunction(
    (minState) => {
      const v = document.querySelector('.editor-preview video');
      if (!v) return false;
      // Must have a src (blob URL) assigned
      if (!v.src || v.src === '' || v.src === window.location.href) return false;
      return v.readyState >= minState;
    },
    targetReadyState,
    { timeout: timeoutMs, polling: 200 }
  );
}

/**
 * Click the timeline track at a given ratio [0.0, 1.0].
 * Uses pointerdown on the .timeline-track element for reliable dispatch.
 */
async function clickTimelineRatio(page, ratio) {
  const track = page.locator('.timeline-track');
  await track.waitFor({ state: 'visible' });
  const box = await track.boundingBox();
  if (!box) throw new Error('Timeline track bounding box not found');

  const posX = Math.max(2, Math.min(box.width - 2, box.width * ratio));
  const posY = box.height / 2;

  await track.click({ position: { x: posX, y: posY }, force: true });
}

/**
 * Wait for the video element to settle after a seek — i.e. it is no longer
 * seeking AND its currentTime is reasonably close to expectedOrigTime.
 */
async function waitForSeekSettled(page, timeoutMs = 5000) {
  await page.waitForFunction(
    () => {
      const v = document.querySelector('.editor-preview video');
      return v && !v.seeking;
    },
    null,
    { timeout: timeoutMs, polling: 100 }
  );
  // Small grace period for the seeked handler to fire and state to update
  await page.waitForTimeout(150);
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Editor Full-Flow: Play→Pause→Seek→Play→Seek→Split→Delete→Colour→Seek', () => {

  test.beforeEach(async ({ page }) => {
    // Visit library first to initialize IndexedDB schema
    await page.goto('/library');
    await page.waitForTimeout(500);
  });

  test('complete editor workflow — video always seeks to the clicked position', async ({ page }) => {
    test.setTimeout(90000); // generous for WebM creation + full flow

    page.on('console', (msg) => console.log('PAGE:', msg.text()));
    page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));

    // ── SETUP: seed a 6-second playable recording ──
    const recId = await seedPlayableRecording(page, 6);
    console.log('Seeded recording id:', recId);

    await page.goto(`/editor?id=${recId}`);

    // Wait for the Editor UI to render
    const video = page.locator('.editor-preview video');
    await expect(video).toBeVisible({ timeout: 15000 });

    // Wait for video element to be fully loaded with its blob src
    await waitForVideoReady(page, 1, 30000);

    const initialInfo = await video.evaluate((v) => ({
      duration: v.duration,
      readyState: v.readyState,
      currentTime: v.currentTime,
      paused: v.paused,
      src: v.src?.substring(0, 30),
    }));
    console.log('INITIAL VIDEO STATE:', JSON.stringify(initialInfo));

    const playBtn = page.locator('.pb-btn.primary');

    // ────────────────────────────────────────────────────
    // STEP 1: PLAY
    // ────────────────────────────────────────────────────
    console.log('── STEP 1: Play ──');
    await playBtn.click();

    // Verify video is playing and has advanced past 0
    await page.waitForFunction(
      () => {
        const v = document.querySelector('.editor-preview video');
        return v && !v.paused && v.currentTime > 0.2;
      },
      null,
      { timeout: 10000 }
    );

    let ct = await video.evaluate((v) => v.currentTime);
    let isPaused = await video.evaluate((v) => v.paused);
    console.log(`  After Play: currentTime=${ct.toFixed(2)}, paused=${isPaused}`);
    expect(isPaused).toBe(false);
    expect(ct).toBeGreaterThan(0);

    // ────────────────────────────────────────────────────
    // STEP 2: PAUSE
    // ────────────────────────────────────────────────────
    console.log('── STEP 2: Pause ──');
    await playBtn.click();

    await page.waitForFunction(
      () => {
        const v = document.querySelector('.editor-preview video');
        return v && v.paused;
      },
      null,
      { timeout: 5000 }
    );

    isPaused = await video.evaluate((v) => v.paused);
    ct = await video.evaluate((v) => v.currentTime);
    console.log(`  After Pause: currentTime=${ct.toFixed(2)}, paused=${isPaused}`);
    expect(isPaused).toBe(true);

    // ────────────────────────────────────────────────────
    // STEP 3: CLICK TIMELINE at 25% (should seek to ~1.5s for a 6s video)
    // ────────────────────────────────────────────────────
    console.log('── STEP 3: Click timeline at 25% ──');
    await clickTimelineRatio(page, 0.25);
    await waitForSeekSettled(page);

    ct = await video.evaluate((v) => v.currentTime);
    isPaused = await video.evaluate((v) => v.paused);
    console.log(`  After 25% click: currentTime=${ct.toFixed(2)}, paused=${isPaused}`);
    expect(isPaused).toBe(true); // Should stay paused
    expect(ct).toBeGreaterThanOrEqual(1.0);
    expect(ct).toBeLessThanOrEqual(2.0);

    // ────────────────────────────────────────────────────
    // STEP 4: PLAY (from the 25% position)
    // ────────────────────────────────────────────────────
    console.log('── STEP 4: Play from 25% position ──');
    await playBtn.click();

    await page.waitForFunction(
      () => {
        const v = document.querySelector('.editor-preview video');
        return v && !v.paused && v.currentTime > 1.0;
      },
      null,
      { timeout: 10000 }
    );

    ct = await video.evaluate((v) => v.currentTime);
    isPaused = await video.evaluate((v) => v.paused);
    console.log(`  Playing from ~25%: currentTime=${ct.toFixed(2)}, paused=${isPaused}`);
    expect(isPaused).toBe(false);
    expect(ct).toBeGreaterThanOrEqual(1.0); // Should be at or past ~1.5s, not reset to 0

    // ────────────────────────────────────────────────────
    // STEP 5: CLICK ANOTHER POSITION at 75% while playing
    //         (should seek to ~4.5s and CONTINUE playing)
    // ────────────────────────────────────────────────────
    console.log('── STEP 5: Click timeline at 75% while playing ──');
    await clickTimelineRatio(page, 0.75);

    // Wait for seek to complete and video to continue playing past 75%
    await page.waitForFunction(
      () => {
        const v = document.querySelector('.editor-preview video');
        return v && !v.paused && !v.seeking && v.currentTime >= 4.0;
      },
      null,
      { timeout: 10000 }
    );

    ct = await video.evaluate((v) => v.currentTime);
    isPaused = await video.evaluate((v) => v.paused);
    console.log(`  After 75% click (playing): currentTime=${ct.toFixed(2)}, paused=${isPaused}`);
    expect(isPaused).toBe(false); // Should keep playing
    expect(ct).toBeGreaterThanOrEqual(4.0);
    expect(ct).toBeLessThanOrEqual(6.0);

    // Pause before split
    await playBtn.click();
    await page.waitForFunction(
      () => {
        const v = document.querySelector('.editor-preview video');
        return v && v.paused;
      },
      null,
      { timeout: 5000 }
    );

    // ────────────────────────────────────────────────────
    // STEP 6: SPLIT at 50%
    // ────────────────────────────────────────────────────
    console.log('── STEP 6: Seek to 50% and Split ──');

    // First seek to 50% to position the playhead
    await clickTimelineRatio(page, 0.50);
    await waitForSeekSettled(page);

    ct = await video.evaluate((v) => v.currentTime);
    console.log(`  At 50% before split: currentTime=${ct.toFixed(2)}`);
    expect(ct).toBeGreaterThanOrEqual(2.5);
    expect(ct).toBeLessThanOrEqual(3.5);

    // Click Split
    const splitBtn = page.locator('.tl-btn', { hasText: 'Split' });
    await expect(splitBtn).toBeEnabled({ timeout: 3000 });
    await splitBtn.click();

    // Verify two clips now exist
    const clips = page.locator('.timeline-track .clip');
    await expect(clips).toHaveCount(2);
    console.log('  Split done: 2 clips on timeline');

    // Verify seeking still works after split — click at 25% (should be in segment 1)
    await clickTimelineRatio(page, 0.25);
    await waitForSeekSettled(page);
    ct = await video.evaluate((v) => v.currentTime);
    console.log(`  After split, seek 25%: currentTime=${ct.toFixed(2)}`);
    expect(ct).toBeGreaterThanOrEqual(1.0);
    expect(ct).toBeLessThanOrEqual(2.0);

    // ────────────────────────────────────────────────────
    // STEP 7: DELETE the second segment
    // ────────────────────────────────────────────────────
    console.log('── STEP 7: Delete segment 2 ──');

    // Click on segment 2 (right side of timeline) to select it
    await clickTimelineRatio(page, 0.80);
    await waitForSeekSettled(page);

    // Accept the confirm dialog
    page.on('dialog', (dialog) => dialog.accept());

    const deleteBtn = page.locator('.tl-btn.danger', { hasText: 'Delete' });
    await expect(deleteBtn).toBeEnabled({ timeout: 3000 });
    await deleteBtn.click();

    // Verify 1 clip remaining
    await expect(clips).toHaveCount(1);
    console.log('  Delete done: 1 clip remaining');

    // Verify seeking works on remaining segment — click at 50%
    // (now 50% of just segment 1 which is 0–~3s)
    await clickTimelineRatio(page, 0.50);
    await waitForSeekSettled(page);
    ct = await video.evaluate((v) => v.currentTime);
    isPaused = await video.evaluate((v) => v.paused);
    console.log(`  After delete, seek 50% of remaining: currentTime=${ct.toFixed(2)}, paused=${isPaused}`);
    expect(isPaused).toBe(true);
    expect(ct).toBeGreaterThanOrEqual(1.0);
    expect(ct).toBeLessThanOrEqual(2.0);

    // ────────────────────────────────────────────────────
    // STEP 8: COLOUR — open color panel, adjust brightness
    // ────────────────────────────────────────────────────
    console.log('── STEP 8: Open Color panel and adjust brightness ──');

    const colorBtn = page.locator('.tl-btn', { hasText: 'Color' });
    await colorBtn.click();

    // Color panel should now be visible
    const colorPanel = page.locator('.color-panel');
    await expect(colorPanel).toBeVisible({ timeout: 3000 });

    // Adjust brightness slider to 150
    const brightnessSlider = colorPanel.locator('input[type="range"]').first();
    await brightnessSlider.fill('150');

    // Verify the brightness value is displayed
    await expect(colorPanel.locator('.color-slider-label').first()).toContainText('150%');
    console.log('  Brightness set to 150%');

    // Verify the video filter is applied (check the style attribute)
    const filterStyle = await video.evaluate((v) => v.style.filter);
    console.log(`  Video filter: ${filterStyle}`);
    expect(filterStyle).toContain('brightness(150%)');

    // ────────────────────────────────────────────────────
    // STEP 9: SEEK AGAIN — verify seeking still works correctly
    //         after colour changes
    // ────────────────────────────────────────────────────
    console.log('── STEP 9: Seek again after colour adjustment ──');

    // Seek to 20% of remaining timeline
    await clickTimelineRatio(page, 0.20);
    await waitForSeekSettled(page);
    ct = await video.evaluate((v) => v.currentTime);
    isPaused = await video.evaluate((v) => v.paused);
    console.log(`  After colour change, seek 20%: currentTime=${ct.toFixed(2)}, paused=${isPaused}`);
    expect(isPaused).toBe(true);
    expect(ct).toBeGreaterThanOrEqual(0.3);
    expect(ct).toBeLessThanOrEqual(1.0);

    // Seek to 80% of remaining timeline
    await clickTimelineRatio(page, 0.80);
    await waitForSeekSettled(page);
    ct = await video.evaluate((v) => v.currentTime);
    console.log(`  Seek 80% of remaining: currentTime=${ct.toFixed(2)}`);
    expect(ct).toBeGreaterThanOrEqual(2.0);
    expect(ct).toBeLessThanOrEqual(3.5);

    // Seek back to 10%
    await clickTimelineRatio(page, 0.10);
    await waitForSeekSettled(page);
    ct = await video.evaluate((v) => v.currentTime);
    console.log(`  Seek 10% of remaining: currentTime=${ct.toFixed(2)}`);
    expect(ct).toBeGreaterThanOrEqual(0.1);
    expect(ct).toBeLessThanOrEqual(0.7);

    // ── FINAL VERIFICATION: play from the seeked position ──
    console.log('── FINAL: Play from seeked position after all edits ──');
    await playBtn.click();

    await page.waitForFunction(
      () => {
        const v = document.querySelector('.editor-preview video');
        return v && !v.paused && v.currentTime > 0.3;
      },
      null,
      { timeout: 10000 }
    );

    ct = await video.evaluate((v) => v.currentTime);
    isPaused = await video.evaluate((v) => v.paused);
    console.log(`  Final play: currentTime=${ct.toFixed(2)}, paused=${isPaused}`);
    expect(isPaused).toBe(false);
    expect(ct).toBeGreaterThan(0);

    // Stop playback
    await playBtn.click();
    console.log('✅ Full flow test passed!');
  });
});
