/**
 * mp4Converter.js
 *
 * High-performance MP4 converter & remuxer using FFmpeg.wasm.
 *
 * Optimizations:
 * 1. Preloading: preloadFFmpeg() loads WASM in the background while recording.
 * 2. Instant Remux (-c copy): If the input is already native MP4, stream copy
 *    takes < 100ms with zero quality loss and puts the moov atom at the front
 *    (+faststart) for instant random seeking.
 * 3. Ultrafast Transcode: For WebM input, uses -preset ultrafast -tune zerolatency
 *    for maximum WASM speed.
 */

let ffmpegInstance = null;
let ffmpegLoading = null;

async function getFFmpeg() {
  if (ffmpegInstance) return ffmpegInstance;
  if (ffmpegLoading) return ffmpegLoading;

  ffmpegLoading = (async () => {
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const { toBlobURL } = await import("@ffmpeg/util");

    const ff = new FFmpeg();
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
    await ff.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
    });

    ffmpegInstance = ff;
    ffmpegLoading = null;
    return ff;
  })();

  return ffmpegLoading;
}

/** Preload FFmpeg in background so it is warm and ready when recording stops. */
export async function preloadFFmpeg() {
  try {
    await getFFmpeg();
  } catch (err) {
    console.warn("[FocusRecorder] FFmpeg background preload notice:", err.message);
  }
}

/**
 * Convert or remux any recorded Blob into a standard, fully-indexed MP4 Blob.
 *
 * @param {Blob}     inputBlob       - Source video blob (native MP4 or WebM)
 * @param {Function} [onProgress]    - Progress callback (0-100)
 * @returns {Promise<Blob>}          - Clean MP4 Blob with faststart index
 */
export async function convertToMp4(inputBlob, onProgress) {
  if (!inputBlob || inputBlob.size === 0) {
    throw new Error("Cannot convert empty video blob");
  }

  const { fetchFile } = await import("@ffmpeg/util");
  const ff = await getFFmpeg();

  const isMp4 = (inputBlob.type && inputBlob.type.includes("mp4"));
  const inFilename = isMp4 ? "input.mp4" : "input.webm";

  const progressHandler = onProgress
    ? ({ progress }) => {
        const pct = Math.round(Math.min(progress, 1) * 100);
        onProgress(pct);
      }
    : null;

  if (progressHandler) ff.on("progress", progressHandler);

  try {
    await ff.writeFile(inFilename, await fetchFile(inputBlob));

    if (isMp4) {
      // ⚡ ULTRA-FAST PATH: Input is already MP4.
      // -c copy is instantaneous (< 100ms), 0% CPU re-encode, 100% lossless.
      // -movflags +faststart organizes the moov atom at the beginning for instant random seeking.
      try {
        await ff.exec([
          "-i", inFilename,
          "-c", "copy",
          "-movflags", "+faststart",
          "output.mp4",
        ]);
      } catch (copyErr) {
        console.warn("[FocusRecorder] Stream copy fallback to ultrafast re-encode:", copyErr);
        await ff.exec([
          "-i", inFilename,
          "-c:v", "libx264",
          "-preset", "ultrafast",
          "-tune", "zerolatency",
          "-crf", "23",
          "-c:a", "aac",
          "-b:a", "128k",
          "-movflags", "+faststart",
          "output.mp4",
        ]);
      }
    } else {
      // 🚀 FAST PATH: Transcode WebM to H.264/AAC MP4 with ultrafast preset
      await ff.exec([
        "-i", inFilename,
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-tune", "zerolatency",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        "output.mp4",
      ]);
    }

    const data = await ff.readFile("output.mp4");
    const mp4Blob = new Blob([data.buffer], { type: "video/mp4" });

    await ff.deleteFile(inFilename).catch(() => {});
    await ff.deleteFile("output.mp4").catch(() => {});

    return mp4Blob;
  } finally {
    if (progressHandler) ff.off("progress", progressHandler);
  }
}
