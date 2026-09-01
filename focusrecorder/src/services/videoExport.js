/**
 * videoExport.js — Canvas + MediaRecorder export pipeline for FocusRecorder
 *
 * Pipeline:
 *  1. Create an off-screen <canvas> at the target resolution.
 *  2. Create a hidden <video> element sourced from the original ObjectURL.
 *  3. For each segment (trim/split respected, deleted segments skipped):
 *     - Seek the hidden video to segment.startTime
 *     - Wait for seek + buffer (canplay) to be ready
 *     - Play and draw frames to canvas via requestAnimationFrame
 *     - Apply color adjustments via ctx.filter per frame
 *     - Stop at segment.endTime, continue to next segment
 *  4. Capture canvas stream (30 fps) + audio via AudioContext
 *  5. Feed both tracks into a MediaRecorder (WebM/VP9 + Opus or VP8 + Opus)
 *  6. Collect all chunks → final Blob
 *  7. Fix the WebM duration header using fix-webm-duration
 *
 * The original recording Blob and IndexedDB entry are NEVER touched.
 */

import fixWebmDuration from "fix-webm-duration";

const RESOLUTION_MAP = {
  "720": { w: 1280, h: 720 },
  "1080": { w: 1920, h: 1080 },
  "4k": { w: 3840, h: 2160 },
};

/** Pick the best WebM MIME type supported by this browser */
function pickMimeType() {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const m of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "video/webm";
}

/**
 * Wait for video element to finish seeking.
 * Handles the race condition where the seek completes before we attach listeners.
 */
function waitForSeek(video) {
  return new Promise((resolve, reject) => {
    // If not currently seeking, resolve immediately
    if (!video.seeking) {
      resolve();
      return;
    }
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      resolve();
    };
    const onError = (e) => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      reject(new Error("Video seek error: " + (e?.message || "unknown")));
    };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
  });
}

/**
 * Wait for video to be ready to play (buffered enough at current position).
 * Returns immediately if readyState is already >= HAVE_FUTURE_DATA (3).
 */
function waitForCanPlay(video) {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 3) { resolve(); return; }
    const onCanPlay = () => {
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("error", onErr);
      resolve();
    };
    const onErr = (e) => {
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("error", onErr);
      reject(new Error("Video buffering error: " + (e?.message || "unknown")));
    };
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("error", onErr);
    // Safety timeout: if buffer never fires within 10s, continue anyway
    setTimeout(() => {
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("error", onErr);
      resolve();
    }, 10000);
  });
}

/** Wait for video metadata to be ready */
function waitForMeta(video) {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 1) { resolve(); return; }
    const onMeta = () => {
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("error", onErr);
      resolve();
    };
    const onErr = (e) => {
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("error", onErr);
      reject(new Error("Video failed to load metadata: " + (e?.message || "unknown")));
    };
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("error", onErr);
  });
}

/**
 * Helper to compute CSS filter string from color settings object.
 */
function getFilterStr(colorSettings) {
  const { brightness = 100, contrast = 100, saturation = 100, grayscale = 0 } = colorSettings || {};
  const isDefaultColor = brightness === 100 && contrast === 100 && saturation === 100 && grayscale === 0;
  return isDefaultColor
    ? "none"
    : `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) grayscale(${grayscale}%)`;
}

/**
 * Seek video to segment start, wait for buffer/canplay, and draw initial frame to canvas.
 */
async function seekAndPrepareSegment(video, canvas, ctx, segment, filterStr, cancelRef) {
  video.currentTime = segment.startTime;
  await waitForSeek(video);
  await waitForCanPlay(video);
  if (cancelRef?.cancelled) return;

  ctx.filter = filterStr;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
}

/**
 * Play video segment from current position to segment.endTime and draw frames on rAF.
 */
function playSegmentFrames(video, canvas, ctx, segment, filterStr, onSegProgress, cancelRef) {
  return new Promise((resolve, reject) => {
    const segDuration = Math.max(0.001, segment.endTime - segment.startTime);

    ctx.filter = filterStr;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    let rafId = null;
    let resolved = false;

    const finish = () => {
      if (resolved) return;
      resolved = true;
      video.pause();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      ctx.filter = filterStr;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      onSegProgress(1);
      resolve();
    };

    const drawFrame = () => {
      if (resolved) return;

      if (cancelRef?.cancelled) {
        video.pause();
        if (rafId !== null) cancelAnimationFrame(rafId);
        resolved = true;
        resolve();
        return;
      }

      const ct = video.currentTime;

      if (ct >= segment.endTime || video.ended) {
        finish();
        return;
      }

      ctx.filter = filterStr;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      onSegProgress(Math.min(1, (ct - segment.startTime) / segDuration));

      rafId = requestAnimationFrame(drawFrame);
    };

    video.play()
      .then(() => {
        rafId = requestAnimationFrame(drawFrame);
      })
      .catch((err) => {
        if (!resolved) {
          resolved = true;
          if (rafId !== null) cancelAnimationFrame(rafId);
          reject(new Error("Playback error: " + (err?.message || err)));
        }
      });
  });
}

/**
 * Export the edited video as a new WebM Blob.
 *
 * @param {object} opts
 * @param {string}   opts.sourceUrl       - ObjectURL of the original recording blob
 * @param {Array}    opts.segments         - Array of { id, startTime, endTime, colorSettings } (deleted ones already excluded)
 * @param {object}   opts.colorSettings    - Default { brightness, contrast, saturation, grayscale }
 * @param {string}   opts.resolution       - "720" | "1080" | "4k"
 * @param {Function} opts.onProgress       - callback(0..100)
 * @param {{ cancelled: boolean }} opts.cancelRef
 * @returns {Promise<{ blob: Blob, mimeType: string }>}
 */
export async function exportVideo({
  sourceUrl,
  segments,
  colorSettings,
  resolution,
  onProgress,
  cancelRef = { cancelled: false },
}) {
  if (!segments || segments.length === 0) {
    throw new Error("No segments to export — all segments have been deleted.");
  }

  // Sort segments by their position in the original video timeline
  const orderedSegments = [...segments].sort((a, b) => a.startTime - b.startTime);
  const totalDuration = orderedSegments.reduce(
    (sum, s) => sum + Math.max(0, s.endTime - s.startTime),
    0
  );
  if (totalDuration <= 0) throw new Error("Total segment duration is zero.");

  const { w: outW, h: outH } = RESOLUTION_MAP[resolution] || RESOLUTION_MAP["1080"];

  // ── Canvas (off-screen) ──
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, outW, outH);

  // ── Hidden source video ──
  const video = document.createElement("video");
  video.src = sourceUrl;
  video.preload = "auto";
  video.muted = true;  // initialized muted; unmuted when AudioContext connects

  await waitForMeta(video);
  if (cancelRef.cancelled) throw new Error("Export cancelled.");

  // ── AudioContext for audio capture ──
  let audioCtx;
  let audioDest;
  try {
    audioCtx = new AudioContext();
    if (audioCtx.state === "suspended") await audioCtx.resume();

    // Ensure video is unmuted and volume is full so audio streams into AudioContext
    video.muted = false;
    video.volume = 1.0;

    const audioSrc = audioCtx.createMediaElementSource(video);
    audioDest = audioCtx.createMediaStreamDestination();

    // Route: audio source → capture destination (to record)
    audioSrc.connect(audioDest);

    // Also route through a silent gain node to suppress speaker output during export
    const silenceGain = audioCtx.createGain();
    silenceGain.gain.value = 0;
    audioSrc.connect(silenceGain);
    silenceGain.connect(audioCtx.destination);

    console.log("[Export] AudioContext ready — audio will be included in export.");
  } catch (audioErr) {
    console.warn("[Export] AudioContext setup failed — exporting video-only:", audioErr.message);
    audioCtx = null;
    audioDest = null;
    video.muted = true;
  }

  // ── Stream setup ──
  const mimeType = pickMimeType();
  const canvasStream = canvas.captureStream(30);

  if (audioDest) {
    audioDest.stream.getAudioTracks().forEach((t) => canvasStream.addTrack(t));
    console.log("[Export] Audio tracks added to stream:", audioDest.stream.getAudioTracks().length);
  }

  let videoBps;
  if (outW >= 3840) videoBps = 28_000_000;
  else if (outW >= 1920) videoBps = 12_000_000;
  else videoBps = 6_000_000;

  const recorderOptions = { mimeType, videoBitsPerSecond: videoBps };
  const chunks = [];
  let recorder;

  try {
    recorder = new MediaRecorder(canvasStream, recorderOptions);
  } catch (e) {
    // Fallback: try without explicit options
    console.warn("[Export] MediaRecorder with options failed, trying without:", e.message);
    recorder = new MediaRecorder(canvasStream);
  }

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  console.log(`[Export] Starting — codec: ${mimeType}, resolution: ${outW}×${outH}, segments: ${orderedSegments.length}`);

  // ── Process segments synchronously with MediaRecorder ──
  let completedDuration = 0;

  for (let i = 0; i < orderedSegments.length; i++) {
    if (cancelRef.cancelled) break;

    const segment = orderedSegments[i];
    const segDuration = Math.max(0, segment.endTime - segment.startTime);
    const capturedBefore = completedDuration;
    const filterStr = getFilterStr(segment.colorSettings || colorSettings);

    console.log(`[Export] Preparing segment ${i + 1}/${orderedSegments.length}: ${segment.startTime.toFixed(2)}s → ${segment.endTime.toFixed(2)}s`);

    // Pause recorder while seeking between segments to prevent gap recording
    if (i > 0 && recorder.state === "recording") {
      recorder.pause();
    }

    // Seek video and draw first frame BEFORE starting or resuming MediaRecorder
    await seekAndPrepareSegment(video, canvas, ctx, segment, filterStr, cancelRef);

    if (cancelRef.cancelled) break;

    // Start recorder on segment 0, or resume recorder on segment > 0
    if (i === 0 && recorder.state === "inactive") {
      recorder.start(250);
    } else if (recorder.state === "paused") {
      recorder.resume();
    }

    // Play and record the frames for this segment
    await playSegmentFrames(
      video,
      canvas,
      ctx,
      segment,
      filterStr,
      (segFrac) => {
        const done = capturedBefore + segFrac * segDuration;
        onProgress(Math.min(99, Math.round((done / totalDuration) * 100)));
      },
      cancelRef
    );

    completedDuration += segDuration;
  }

  if (cancelRef.cancelled) {
    if (recorder.state !== "inactive") recorder.stop();
    if (audioCtx) audioCtx.close();
    video.src = "";
    throw new Error("Export cancelled by user.");
  }

  // ── Stop recorder and collect the final Blob ──
  const rawBlob = await new Promise((resolve, reject) => {
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      console.log(`[Export] Raw blob: ${(blob.size / 1024 / 1024).toFixed(2)} MB, chunks: ${chunks.length}`);
      resolve(blob);
    };
    recorder.onerror = (e) => {
      reject(new Error("MediaRecorder error: " + (e.error?.message || String(e))));
    };
    try {
      if (recorder.state !== "inactive") {
        recorder.requestData();
        recorder.stop();
      }
    } catch (err) {
      if (recorder.state !== "inactive") recorder.stop();
    }
  });

  if (rawBlob.size === 0) {
    throw new Error("Export produced an empty file. The recording may be too short or the browser blocked canvas capture.");
  }

  // ── Fix WebM duration header ──
  const actualDurationMs = Math.round(totalDuration * 1000);
  let outputBlob = rawBlob;
  try {
    const fixed = await fixWebmDuration(rawBlob, actualDurationMs, { logger: false });
    if (fixed && fixed.size > 0) {
      outputBlob = fixed;
      console.log(`[Export] Duration header fixed to ${(actualDurationMs / 1000).toFixed(2)}s`);
    }
  } catch (fixErr) {
    console.warn("[Export] fix-webm-duration failed (non-fatal):", fixErr.message);
  }

  // ── Cleanup ──
  video.pause();
  video.src = "";
  if (audioCtx) audioCtx.close();

  onProgress(100);
  console.log(`[Export] Done — ${(outputBlob.size / 1024 / 1024).toFixed(2)} MB  mime: ${mimeType}`);
  return { blob: outputBlob, mimeType };
}

/**
 * Returns which formats this browser actually supports via MediaRecorder.
 * Call this to show the user what codecs are available.
 */
export function getSupportedFormats() {
  if (typeof MediaRecorder === "undefined") return [];
  return [
    { label: "WebM (VP9 + Opus)", mime: "video/webm;codecs=vp9,opus", ext: "webm" },
    { label: "WebM (VP8 + Opus)", mime: "video/webm;codecs=vp8,opus", ext: "webm" },
    { label: "WebM (default)", mime: "video/webm", ext: "webm" },
  ].filter((f) => MediaRecorder.isTypeSupported(f.mime));
}
