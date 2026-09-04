/**
 * videoExport.js — Video export pipeline for FocusRecorder
 *
 * Pipeline:
 *  1. Create an off-screen <canvas> at the target resolution.
 *  2. Create a hidden <video> element attached to DOM (with opacity:0) sourced from the ObjectURL.
 *  3. Set video.muted = false and video.volume = 1.0 before AudioContext creation.
 *  4. Capture canvas stream at 30fps (canvas.captureStream(30)) + audio via AudioContext.
 *  5. Feed both tracks into a MediaRecorder (WebM/VP9 + Opus or VP8 + Opus).
 *  6. For each segment (sorted by startTime):
 *     - If transitioning between segments, draw black frames every 33ms to prevent freeze gaps.
 *     - Seek hidden video to segment.startTime and buffer.
 *     - Play and draw frames to canvas on requestAnimationFrame with CSS color filters.
 *  7. Keep MediaRecorder running continuously from start to finish.
 *  8. After last segment finishes, wait 500ms, requestData(), wait 200ms, then stop recorder.
 *  9. Direct binary EBML patch to write the true cumulative duration into the WebM header.
 * 10. Clean up video element and AudioContext.
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
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) {
      return m;
    }
  }
  return "video/webm";
}

/** Reads EBML variable-length integer (VINT) for SIZE fields — strips marker bit */
function readVint(bytes, offset) {
  if (offset >= bytes.length) return null;
  const first = bytes[offset];
  if (first === 0) return null;
  let mask = 0x80;
  let length = 1;
  while (mask > 0 && (first & mask) === 0) {
    mask >>= 1;
    length++;
  }
  if (length > 8 || offset + length > bytes.length) return null;
  let isUnknown = (first & (mask - 1)) === (mask - 1);
  for (let i = 1; i < length && isUnknown; i++) {
    if (bytes[offset + i] !== 0xff) isUnknown = false;
  }
  let value = first & (mask - 1);
  for (let i = 1; i < length; i++) {
    value = value * 256 + bytes[offset + i];
  }
  return { value, length, isUnknown };
}

/** Reads EBML Element ID — keeps marker bit */
function readId(bytes, offset) {
  if (offset >= bytes.length) return null;
  const first = bytes[offset];
  if (first === 0) return null;
  let mask = 0x80;
  let length = 1;
  while (mask > 0 && (first & mask) === 0) {
    mask >>= 1;
    length++;
  }
  if (length > 8 || offset + length > bytes.length) return null;
  let id = 0;
  for (let i = 0; i < length; i++) {
    id = id * 256 + bytes[offset + i];
  }
  return { id, length };
}

/** Writes a VINT of given length into buffer */
function writeVint(buffer, offset, value, length) {
  let mask = 0x80;
  for (let i = 1; i < length; i++) {
    mask >>= 1;
  }
  let val = value;
  buffer[offset] = mask | (val >> ((length - 1) * 8));
  for (let i = 1; i < length; i++) {
    buffer[offset + i] = (val >> ((length - 1 - i) * 8)) & 0xff;
  }
}

/**
 * Direct binary EBML duration patcher for WebM.
 * Force-overwrites Chrome's default 1000–2000ms duration in the Info header,
 * or injects the Duration element if missing.
 */
function setWebmDuration(arrayBuffer, durationMs) {
  const bytes = new Uint8Array(arrayBuffer);
  const dataView = new DataView(arrayBuffer);

  let offset = 0;
  let timecodeScale = 1000000; // default 1ms/tick
  let durationOffset = -1;
  let durationSize = 0;
  let infoBlockStart = -1;
  let infoBlockEnd = -1;
  let infoSizeLength = 0;
  let infoSizeValue = 0;

  while (offset < bytes.length - 4) {
    const idInfo = readId(bytes, offset);
    if (!idInfo) break;
    offset += idInfo.length;
    const sizeInfo = readVint(bytes, offset);
    if (!sizeInfo) break;
    offset += sizeInfo.length;

    // Segment ID: 0x18538067
    if (idInfo.id === 0x18538067) {
      const segmentEnd = sizeInfo.isUnknown ? bytes.length : Math.min(offset + sizeInfo.value, bytes.length);

      while (offset < segmentEnd && offset < bytes.length - 4) {
        const segIdInfo = readId(bytes, offset);
        if (!segIdInfo) break;
        const segIdStart = offset;
        offset += segIdInfo.length;
        const segSizeInfo = readVint(bytes, offset);
        if (!segSizeInfo) break;
        offset += segSizeInfo.length;

        // Info ID: 0x1549A966
        if (segIdInfo.id === 0x1549A966) {
          infoBlockStart = segIdStart;
          infoSizeLength = segSizeInfo.length;
          infoSizeValue = segSizeInfo.value;
          const infoEnd = segSizeInfo.isUnknown
            ? bytes.length
            : Math.min(offset + segSizeInfo.value, bytes.length);

          while (offset < infoEnd && offset < bytes.length - 4) {
            const infoIdInfo = readId(bytes, offset);
            if (!infoIdInfo) break;
            offset += infoIdInfo.length;
            const infoSizeInfo = readVint(bytes, offset);
            if (!infoSizeInfo) break;
            offset += infoSizeInfo.length;

            // TimecodeScale ID: 0x2AD7B1
            if (infoIdInfo.id === 0x2ad7b1) {
              let scale = 0;
              for (let k = 0; k < infoSizeInfo.value; k++) {
                scale = scale * 256 + bytes[offset + k];
              }
              if (scale > 0) timecodeScale = scale;
            }
            // Duration ID: 0x4489
            else if (infoIdInfo.id === 0x4489) {
              durationOffset = offset;
              durationSize = infoSizeInfo.value;
            }
            offset += infoSizeInfo.value;
          }
          infoBlockEnd = offset;
          break;
        } else {
          if (segSizeInfo.isUnknown) break;
          offset += segSizeInfo.value;
        }
      }
      break;
    } else {
      if (sizeInfo.isUnknown) break;
      offset += sizeInfo.value;
    }
  }

  const durationValue = (durationMs * 1_000_000) / timecodeScale;

  // Case A: Duration element exists — overwrite it directly in binary
  if (durationOffset !== -1) {
    if (durationSize === 4) {
      dataView.setFloat32(durationOffset, durationValue, false);
      return new Blob([bytes], { type: "video/webm" });
    } else if (durationSize === 8) {
      dataView.setFloat64(durationOffset, durationValue, false);
      return new Blob([bytes], { type: "video/webm" });
    }
  }

  // Case B: Duration element is missing — inject it into the Info block
  if (infoBlockStart !== -1 && infoBlockEnd !== -1) {
    const DURATION_ELEMENT_SIZE = 11; // 2-byte ID (0x4489) + 1-byte size (0x88) + 8-byte float64
    const newBuffer = new Uint8Array(bytes.length + DURATION_ELEMENT_SIZE);

    newBuffer.set(bytes.slice(0, infoBlockEnd), 0);

    let ins = infoBlockEnd;
    newBuffer[ins++] = 0x44;
    newBuffer[ins++] = 0x89;
    newBuffer[ins++] = 0x88;

    const tmp = new DataView(newBuffer.buffer);
    tmp.setFloat64(ins, durationValue, false);
    ins += 8;

    newBuffer.set(bytes.slice(infoBlockEnd), ins);

    writeVint(newBuffer, infoBlockStart + 4, infoSizeValue + DURATION_ELEMENT_SIZE, infoSizeLength);
    return new Blob([newBuffer], { type: "video/webm" });
  }

  return null;
}

/** Wait for video metadata to load (with 15s safety timeout) */
function waitForMeta(video) {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 1) {
      resolve();
      return;
    }
    const onMeta = () => {
      cleanup();
      resolve();
    };
    const onErr = (e) => {
      cleanup();
      reject(new Error("Video failed to load metadata: " + (e?.message || "unknown")));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Metadata load timed out after 15 seconds. The recording blob may be corrupted."));
    }, 15000);

    function cleanup() {
      clearTimeout(timer);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("error", onErr);
    }

    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("error", onErr);
  });
}

/** Wait for video seeking to complete (with 5s safety timeout) */
function waitForSeek(video) {
  return new Promise((resolve) => {
    if (!video.seeking) {
      resolve();
      return;
    }
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, 5000);

    function cleanup() {
      clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onSeeked);
    }

    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onSeeked);
  });
}

/** Wait for video buffer to be ready to play (with 8s safety timeout) */
function waitForCanPlay(video) {
  return new Promise((resolve) => {
    if (video.readyState >= 3) {
      resolve();
      return;
    }
    const onCanPlay = () => {
      cleanup();
      resolve();
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, 8000);

    function cleanup() {
      clearTimeout(timer);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("canplaythrough", onCanPlay);
      video.removeEventListener("error", onCanPlay);
    }

    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("canplaythrough", onCanPlay);
    video.addEventListener("error", onCanPlay);
  });
}

/** Compute CSS filter string from color settings */
function getFilterStr(colorSettings) {
  const { brightness = 100, contrast = 100, saturation = 100, grayscale = 0 } = colorSettings || {};
  const isDefaultColor = brightness === 100 && contrast === 100 && saturation === 100 && grayscale === 0;
  return isDefaultColor
    ? "none"
    : `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) grayscale(${grayscale}%)`;
}

/** Seek video to segment start, wait for buffer, and draw initial frame */
async function seekAndPrepareSegment(video, canvas, ctx, segment, filterStr, cancelRef) {
  video.currentTime = segment.startTime;
  await waitForSeek(video);
  await waitForCanPlay(video);
  if (cancelRef?.cancelled) return;

  ctx.filter = filterStr;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
}

/** Play video segment and draw frames to canvas on requestAnimationFrame */
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
 * @param {Array}    opts.segments         - Array of { id, startTime, endTime, colorSettings }
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
  resolution = "1080",
  onProgress = () => {},
  cancelRef = { cancelled: false },
}) {
  if (!sourceUrl || typeof sourceUrl !== "string") {
    throw new Error("Invalid source URL. Please go back to Library and reopen the recording.");
  }

  if (!segments || segments.length === 0) {
    throw new Error("No segments to export — all segments have been deleted.");
  }

  const orderedSegments = [...segments].sort((a, b) => a.startTime - b.startTime);
  const totalDuration = orderedSegments.reduce(
    (sum, s) => sum + Math.max(0, s.endTime - s.startTime),
    0
  );
  if (totalDuration <= 0) {
    throw new Error("Total segment duration is zero.");
  }

  const { w: outW, h: outH } = RESOLUTION_MAP[resolution] || RESOLUTION_MAP["1080"];

  // ── 1. Off-screen Canvas ──
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, outW, outH);

  // ── 2. Hidden Video Element Attached to DOM Before src ──
  const video = document.createElement("video");
  video.muted = false;
  video.volume = 1.0;
  video.style.cssText = "position:fixed;opacity:0;pointer-events:none;width:1px;height:1px;top:-9999px;";
  document.body.appendChild(video);
  video.preload = "auto";
  video.playsInline = true;
  video.src = sourceUrl;

  let audioCtx = null;
  let audioDest = null;

  const cleanup = () => {
    try { video.pause(); } catch (_) {}
    try { video.src = ""; } catch (_) {}
    try {
      if (document.body.contains(video)) {
        document.body.removeChild(video);
      }
    } catch (_) {}
    try {
      if (audioCtx && audioCtx.state !== "closed") {
        audioCtx.close();
      }
    } catch (_) {}
  };

  try {
    await waitForMeta(video);
    if (cancelRef.cancelled) throw new Error("Export cancelled.");

    // ── 3. AudioContext Setup with 80ms Delay ──
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
        if (audioCtx.state === "suspended") {
          await audioCtx.resume();
        }
        await new Promise((r) => setTimeout(r, 80));

        const audioSrc = audioCtx.createMediaElementSource(video);
        audioDest = audioCtx.createMediaStreamDestination();
        audioSrc.connect(audioDest);

        const silenceGain = audioCtx.createGain();
        silenceGain.gain.value = 0;
        audioSrc.connect(silenceGain);
        silenceGain.connect(audioCtx.destination);
      }
    } catch (audioErr) {
      console.warn("[Export] AudioContext setup failed (exporting video-only):", audioErr.message);
      audioCtx = null;
      audioDest = null;
      video.muted = true;
    }

    if (cancelRef.cancelled) throw new Error("Export cancelled.");

    // ── 4. MediaRecorder Setup (30fps Stream) ──
    const mimeType = pickMimeType();
    const canvasStream = canvas.captureStream(30);

    if (audioDest) {
      audioDest.stream.getAudioTracks().forEach((track) => canvasStream.addTrack(track));
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
      recorder = new MediaRecorder(canvasStream);
    }

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    // ── 5. Draw Black Frame, 150ms Buffer, and Start Recorder ──
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, outW, outH);
    await new Promise((r) => setTimeout(r, 150));
    recorder.start(100);

    // ── 6. Process Segments Continuously with Keep-Alive Seek ──
    let completedDuration = 0;

    for (let i = 0; i < orderedSegments.length; i++) {
      if (cancelRef.cancelled) break;

      const segment = orderedSegments[i];
      const segDuration = Math.max(0, segment.endTime - segment.startTime);
      const capturedBefore = completedDuration;
      const filterStr = getFilterStr(segment.colorSettings || colorSettings);

      // Keep canvas alive with black frames every 33ms while seeking
      let seekDone = false;
      const keepAlive = setInterval(() => {
        if (!seekDone) {
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, outW, outH);
        }
      }, 33);

      try {
        await seekAndPrepareSegment(video, canvas, ctx, segment, filterStr, cancelRef);
      } finally {
        seekDone = true;
        clearInterval(keepAlive);
      }

      if (cancelRef.cancelled) break;

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
      throw new Error("Export cancelled by user.");
    }

    // ── 7. Wait 500ms, requestData(), wait 200ms, Stop Recorder ──
    video.pause();
    await new Promise((r) => setTimeout(r, 500));
    try {
      if (recorder.state !== "inactive") {
        recorder.requestData();
      }
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 200));

    // ── 8. Collect Raw Blob ──
    const rawBlob = await new Promise((resolve, reject) => {
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
        resolve(blob);
      };
      recorder.onerror = (e) => {
        reject(new Error("MediaRecorder error: " + (e.error?.message || String(e))));
      };
      try {
        if (recorder.state !== "inactive") {
          recorder.stop();
        }
      } catch (err) {
        if (recorder.state !== "inactive") recorder.stop();
      }
    });

    if (rawBlob.size === 0) {
      throw new Error("Export produced an empty file. Canvas capture was blocked or video was too short.");
    }

    // ── 9. Fix WebM Duration Header via Direct EBML Binary Patcher ──
    const actualDurationMs = Math.round(totalDuration * 1000);
    let outputBlob = rawBlob;

    try {
      const arrayBuffer = await rawBlob.arrayBuffer();
      const directPatched = setWebmDuration(arrayBuffer, actualDurationMs);
      if (directPatched && directPatched.size > 0) {
        outputBlob = directPatched;
        console.log(`[Export] Direct EBML duration patch applied: ${actualDurationMs}ms`);
      } else {
        // Fallback to npm package if custom EBML structure parser didn't find segment
        const npmFixed = await fixWebmDuration(rawBlob, actualDurationMs, { logger: false });
        if (npmFixed && npmFixed.size > 0) {
          outputBlob = npmFixed;
          console.log(`[Export] npm fix-webm-duration fallback applied: ${actualDurationMs}ms`);
        }
      }
    } catch (fixErr) {
      console.warn("[Export] Duration header patch failed:", fixErr.message);
      outputBlob = rawBlob;
    }

    onProgress(100);
    return { blob: outputBlob, mimeType };
  } finally {
    cleanup();
  }
}

/**
 * Returns which formats this browser actually supports via MediaRecorder.
 */
export function getSupportedFormats() {
  if (typeof MediaRecorder === "undefined") return [];
  return [
    { label: "WebM (VP9 + Opus)", mime: "video/webm;codecs=vp9,opus", ext: "webm" },
    { label: "WebM (VP8 + Opus)", mime: "video/webm;codecs=vp8,opus", ext: "webm" },
    { label: "WebM (default)", mime: "video/webm", ext: "webm" },
  ].filter((f) => MediaRecorder.isTypeSupported(f.mime));
}
