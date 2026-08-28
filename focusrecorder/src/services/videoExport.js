/**
 * videoExport.js — Canvas + MediaRecorder export pipeline for FocusRecorder
 *
 * How it works:
 *  1. Create an off-screen <canvas> at the target resolution.
 *  2. Create a hidden <video> element sourced from the original ObjectURL.
 *  3. For each segment (trim/split respected, deleted segments skipped):
 *     - Seek the hidden video to segment.startTime
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
  "720":  { w: 1280, h: 720  },
  "1080": { w: 1920, h: 1080 },
  "4k":   { w: 3840, h: 2160 },
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

/** Wait for video element to finish seeking */
function waitForSeek(video) {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      resolve();
    };
    const onError = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      reject(new Error("Video seek failed"));
    };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
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
    const onErr = () => {
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("error", onErr);
      reject(new Error("Video failed to load metadata"));
    };
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("error", onErr);
  });
}

/**
 * Process one segment: seek → play → draw frames → stop at endTime.
 */
function processSegment(video, canvas, ctx, segment, filterStr, onSegProgress, cancelRef) {
  return new Promise((resolve, reject) => {
    const segDuration = Math.max(0.001, segment.endTime - segment.startTime);

    video.currentTime = segment.startTime;

    waitForSeek(video)
      .then(() => {
        if (cancelRef.cancelled) { resolve(); return; }

        // Draw first frame immediately
        ctx.filter = filterStr;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        let rafId = null;

        const drawFrame = () => {
          if (cancelRef.cancelled) {
            video.pause();
            if (rafId !== null) cancelAnimationFrame(rafId);
            resolve();
            return;
          }

          const ct = video.currentTime;

          if (ct >= segment.endTime || video.ended) {
            video.pause();
            if (rafId !== null) cancelAnimationFrame(rafId);
            // Draw final frame
            ctx.filter = filterStr;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            onSegProgress(1);
            resolve();
            return;
          }

          ctx.filter = filterStr;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          onSegProgress(Math.min(1, (ct - segment.startTime) / segDuration));

          rafId = requestAnimationFrame(drawFrame);
        };

        video.play()
          .then(() => { rafId = requestAnimationFrame(drawFrame); })
          .catch((err) => {
            if (rafId !== null) cancelAnimationFrame(rafId);
            reject(new Error("Playback error: " + err.message));
          });
      })
      .catch(reject);
  });
}

/**
 * Export the edited video as a new WebM Blob.
 *
 * @param {object} opts
 * @param {string}   opts.sourceUrl       - ObjectURL of the original recording blob
 * @param {Array}    opts.segments         - Ordered array of { id, startTime, endTime }
 * @param {object}   opts.colorSettings    - { brightness, contrast, saturation, grayscale }
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

  const orderedSegments = [...segments].sort((a, b) => a.startTime - b.startTime);
  const totalDuration = orderedSegments.reduce(
    (sum, s) => sum + Math.max(0, s.endTime - s.startTime),
    0
  );
  if (totalDuration <= 0) throw new Error("Total segment duration is zero.");

  const { w: outW, h: outH } = RESOLUTION_MAP[resolution] || RESOLUTION_MAP["1080"];

  // ── Canvas ──
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, outW, outH);

  const { brightness = 100, contrast = 100, saturation = 100, grayscale = 0 } = colorSettings || {};
  const filterStr = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) grayscale(${grayscale}%)`;

  // ── Hidden source video (muted — audio routed via AudioContext) ──
  const video = document.createElement("video");
  video.src = sourceUrl;
  video.preload = "auto";
  video.muted = true;

  await waitForMeta(video);
  if (cancelRef.cancelled) throw new Error("Export cancelled.");

  // ── AudioContext for audio capture ──
  let audioCtx = null;
  let audioDest = null;
  try {
    audioCtx = new AudioContext();
    if (audioCtx.state === "suspended") await audioCtx.resume();

    // Un-mute the video element so its audio flows into AudioContext
    video.muted = false;

    const audioSrc = audioCtx.createMediaElementSource(video);
    audioDest = audioCtx.createMediaStreamDestination();

    // Route audio to capture destination (not speakers)
    audioSrc.connect(audioDest);

    // Silence the speakers during export via a zeroed gain node
    const silenceGain = audioCtx.createGain();
    silenceGain.gain.value = 0;
    audioSrc.connect(silenceGain);
    silenceGain.connect(audioCtx.destination);
  } catch (audioErr) {
    console.warn("[Export] AudioContext setup failed — video-only export:", audioErr);
    audioCtx = null;
    audioDest = null;
    video.muted = true;
  }

  // ── MediaRecorder ──
  const mimeType = pickMimeType();
  const canvasStream = canvas.captureStream(30);
  if (audioDest) {
    audioDest.stream.getAudioTracks().forEach((t) => canvasStream.addTrack(t));
  }

  const chunks = [];
  const recorder = new MediaRecorder(canvasStream, {
    mimeType,
    videoBitsPerSecond:
      outW >= 3840 ? 28_000_000 : outW >= 1920 ? 12_000_000 : 6_000_000,
  });
  recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
  recorder.start(250);

  // ── Process segments ──
  let completedDuration = 0;
  for (const segment of orderedSegments) {
    if (cancelRef.cancelled) break;
    const segDuration = Math.max(0, segment.endTime - segment.startTime);
    const capturedBefore = completedDuration;

    await processSegment(video, canvas, ctx, segment, filterStr, (segFrac) => {
      const done = capturedBefore + segFrac * segDuration;
      onProgress(Math.min(99, Math.round((done / totalDuration) * 100)));
    }, cancelRef);

    completedDuration += segDuration;
  }

  if (cancelRef.cancelled) {
    recorder.stop();
    if (audioCtx) audioCtx.close();
    video.src = "";
    throw new Error("Export cancelled by user.");
  }

  // ── Stop recorder, collect final blob ──
  const rawBlob = await new Promise((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    recorder.onerror = (e) => reject(new Error("MediaRecorder error: " + (e.error?.message || e)));
    recorder.stop();
  });

  // ── Fix WebM duration header ──
  const actualDurationMs = Math.round(totalDuration * 1000);
  let outputBlob = rawBlob;
  try {
    const fixed = await fixWebmDuration(rawBlob, actualDurationMs, { logger: false });
    if (fixed && fixed.size > 0) outputBlob = fixed;
  } catch (fixErr) {
    console.warn("[Export] fix-webm-duration failed:", fixErr);
  }

  // ── Cleanup ──
  video.pause();
  video.src = "";
  if (audioCtx) audioCtx.close();

  onProgress(100);
  console.log(`[Export] Done — ${(outputBlob.size / 1024 / 1024).toFixed(2)} MB  mime: ${mimeType}`);
  return { blob: outputBlob, mimeType };
}

/** Returns which formats this browser actually supports via MediaRecorder */
export function getSupportedFormats() {
  if (typeof MediaRecorder === "undefined") return [];
  return [
    { label: "WebM (VP9 + Opus)", mime: "video/webm;codecs=vp9,opus", ext: "webm" },
    { label: "WebM (VP8 + Opus)", mime: "video/webm;codecs=vp8,opus", ext: "webm" },
    { label: "WebM (default)", mime: "video/webm", ext: "webm" },
  ].filter((f) => MediaRecorder.isTypeSupported(f.mime));
}
