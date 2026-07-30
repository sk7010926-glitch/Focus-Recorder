/**
 * settings.js — LocalStorage persistence for FocusRecorder.
 *
 * Key names match the specification exactly:
 *   theme, recordingQuality, fps, microphoneId, webcamId, saveFormat
 *
 * loadSettings() merges saved JSON with DEFAULT_SETTINGS so new keys
 * added in future releases are never undefined.
 */

const STORAGE_KEY = "focusrecorder:settings";

/** Canonical defaults — single source of truth for every setting. */
export const DEFAULT_SETTINGS = {
  // Recording
  recordingQuality: "1080p",   // "720p" | "1080p" | "4K"
  fps:              30,        // 24 | 30 | 60  (number, not string)
  saveFormat:       "webm",    // "webm" (only selectable for now)

  // Devices — stored as deviceId strings; "" = OS default
  microphoneId:     "",
  webcamId:         "",

  // Behaviour toggles
  autoSave:         true,
  notifications:    true,
  hardwareAccel:    true,
  startOnBoot:      false,
  countdownTimer:   true,
  showCursor:       true,
  clickHighlight:   false,

  // Storage
  savePath:         "~/Documents/FocusRecorder",

  // Shortcuts (display-only)
  shortcutStart:    "Ctrl + Shift + R",
  shortcutStop:     "Ctrl + Shift + S",
};

/**
 * Load settings from LocalStorage.
 * Merges with DEFAULT_SETTINGS so partial / stale saved objects
 * never crash the app when new keys are introduced.
 */
export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const saved = JSON.parse(raw);

    // Migrate legacy key names from an older save (quality → recordingQuality, etc.)
    const migrated = { ...saved };
    if (migrated.quality && !migrated.recordingQuality) {
      migrated.recordingQuality = migrated.quality;
    }
    if (migrated.format && !migrated.saveFormat) {
      migrated.saveFormat = migrated.format;
    }
    if (migrated.defaultMic && !migrated.microphoneId) {
      migrated.microphoneId = migrated.defaultMic === "default" ? "" : migrated.defaultMic;
    }
    if (migrated.defaultWebcam && !migrated.webcamId) {
      migrated.webcamId = migrated.defaultWebcam === "default" ? "" : migrated.defaultWebcam;
    }
    // Normalise fps to number
    if (typeof migrated.fps === "string") {
      migrated.fps = Number(migrated.fps) || DEFAULT_SETTINGS.fps;
    }

    return { ...DEFAULT_SETTINGS, ...migrated };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Write settings to LocalStorage. */
export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.error("Failed to persist settings:", err);
  }
}

/**
 * Wipe FocusRecorder settings from LocalStorage and return a fresh
 * copy of DEFAULT_SETTINGS so the caller can reset state in one step.
 */
export function resetSettings() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS };
}
