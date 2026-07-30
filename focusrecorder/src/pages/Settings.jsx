import { useState, useEffect, useCallback } from "react";
import { loadSettings, saveSettings, resetSettings } from "../services/settings";
import { useTheme } from "../hooks/useTheme";
import { getAllRecordings, deleteRecording } from "../services/db";
import "./Settings.css";

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components (structure identical to the original)
// ─────────────────────────────────────────────────────────────────────────────

function Toggle({ value, onChange }) {
  return (
    <button
      className={`toggle-switch ${value ? "on" : ""}`}
      onClick={() => onChange(!value)}
      role="switch"
      aria-checked={value}
    >
      <span className="toggle-thumb" />
    </button>
  );
}

function SettingRow({ label, sub, children }) {
  return (
    <div className="setting-row">
      <div className="setting-info">
        <span className="setting-label">{label}</span>
        {sub && <span className="setting-sub">{sub}</span>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Toast — auto-dismisses after 2.5 s
// ─────────────────────────────────────────────────────────────────────────────

function Toast({ message }) {
  return message ? <div className="settings-toast">{message}</div> : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Settings page
// ─────────────────────────────────────────────────────────────────────────────

function Settings() {
  // ── State ────────────────────────────────────────────────────────────────
  // loadSettings() is synchronous — initial state is the persisted value,
  // so there is never a flicker on load.
  const [settings, setSettings] = useState(() => loadSettings());
  const [toast,    setToast]    = useState("");
  const [devError, setDevError] = useState("");

  // Real devices populated via the MediaDevices API
  const [mics,    setMics]    = useState([]);
  const [webcams, setWebcams] = useState([]);

  const [theme, setThemeGlobal] = useTheme();

  // ── Enumerate camera / mic devices ───────────────────────────────────────
  useEffect(() => {
    async function enumerate() {
      try {
        if (!navigator.mediaDevices) {
          throw new Error("MediaDevices API not available (requires HTTPS)");
        }
        
        // Brief getUserMedia so the browser reveals real device labels
        const s = await navigator.mediaDevices
          .getUserMedia({ audio: true, video: true })
          .catch(() => null);
        if (s) s.getTracks().forEach((t) => t.stop());

        const devices = await navigator.mediaDevices.enumerateDevices();

        const foundMics = devices
          .filter((d) => d.kind === "audioinput")
          .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));

        const foundCams = devices
          .filter((d) => d.kind === "videoinput")
          .map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }));

        setMics(foundMics);
        setWebcams(foundCams);
        setDevError(""); // clear any previous error
      } catch {
        setDevError("Unable to detect microphone or webcam.");
      }
    }
    enumerate();
  }, []);

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Update one key and immediately persist to LocalStorage. */
  const set = useCallback((key, val) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: val };
      saveSettings(next);
      return next;
    });
  }, []);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  }, []);

  // ── Action handlers ───────────────────────────────────────────────────────

  const handleSave = useCallback(() => {
    saveSettings(settings);
    showToast("Settings saved successfully.");
  }, [settings, showToast]);

  const handleReset = useCallback(() => {
    if (!window.confirm("Reset all settings to factory defaults?")) return;
    const defaults = resetSettings();
    setSettings(defaults);
    setThemeGlobal("system");
    showToast("Settings reset to defaults.");
  }, [showToast, setThemeGlobal]);

  const handleClearLibrary = useCallback(async () => {
    if (!window.confirm("Permanently delete ALL recordings? This cannot be undone.")) return;
    try {
      const recs = await getAllRecordings();
      await Promise.all(recs.map((r) => deleteRecording(r.id)));
      showToast(`Cleared ${recs.length} recording${recs.length !== 1 ? "s" : ""}.`);
    } catch (err) {
      console.error("Failed to clear library:", err);
      showToast("Could not clear all recordings.");
    }
  }, [showToast]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="settings-page">
      <Toast message={toast} />

      {/* Page header */}
      <div className="page-header">
        <h1>Settings</h1>
        <p>Customise FocusRecord to fit your workflow.</p>
      </div>

      <div className="settings-layout">

        {/* ── Appearance ── */}
        <section className="settings-card">
          <h2 className="card-title">🎨 Appearance</h2>
          <div className="settings-list">
            <SettingRow label="Theme" sub="Choose your preferred colour scheme">
              <select
                value={theme}
                onChange={(e) => setThemeGlobal(e.target.value)}
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
                <option value="system">System default</option>
              </select>
            </SettingRow>
          </div>
        </section>

        {/* ── General ── */}
        <section className="settings-card">
          <h2 className="card-title">⚙️ General</h2>
          <div className="settings-list">
            <SettingRow label="Auto-save after recording" sub="Automatically save when you stop recording">
              <Toggle value={settings.autoSave} onChange={(v) => set("autoSave", v)} />
            </SettingRow>
            <SettingRow label="Desktop notifications" sub="Get notified when a recording is saved">
              <Toggle value={settings.notifications} onChange={(v) => set("notifications", v)} />
            </SettingRow>
            <SettingRow label="Launch on startup" sub="Start FocusRecord when your OS boots">
              <Toggle value={settings.startOnBoot} onChange={(v) => set("startOnBoot", v)} />
            </SettingRow>
            <SettingRow label="Hardware acceleration" sub="Use GPU for faster encoding">
              <Toggle value={settings.hardwareAccel} onChange={(v) => set("hardwareAccel", v)} />
            </SettingRow>
          </div>
        </section>

        {/* ── Recording ── */}
        <section className="settings-card">
          <h2 className="card-title">🎥 Recording</h2>
          <div className="settings-list">
            <SettingRow label="Countdown timer" sub="3-second countdown before recording starts">
              <Toggle value={settings.countdownTimer} onChange={(v) => set("countdownTimer", v)} />
            </SettingRow>
            <SettingRow label="Show cursor" sub="Include mouse cursor in the recording">
              <Toggle value={settings.showCursor} onChange={(v) => set("showCursor", v)} />
            </SettingRow>
            <SettingRow label="Highlight clicks" sub="Visual flash when mouse buttons are clicked">
              <Toggle value={settings.clickHighlight} onChange={(v) => set("clickHighlight", v)} />
            </SettingRow>

            <SettingRow label="Recording quality">
              <select
                value={settings.recordingQuality}
                onChange={(e) => set("recordingQuality", e.target.value)}
              >
                <option value="720p">720p</option>
                <option value="1080p">1080p</option>
                <option value="4K">4K</option>
              </select>
            </SettingRow>

            <SettingRow label="Frame rate (FPS)">
              <select
                value={settings.fps}
                onChange={(e) => set("fps", Number(e.target.value))}
              >
                <option value={24}>24 fps</option>
                <option value={30}>30 fps</option>
                <option value={60}>60 fps</option>
              </select>
            </SettingRow>

            <SettingRow label="Default save format">
              <select
                value={settings.saveFormat}
                onChange={(e) => set("saveFormat", e.target.value)}
              >
                <option value="webm">WebM</option>
                <option value="mp4" disabled>MP4 (Coming Soon)</option>
              </select>
            </SettingRow>
          </div>
        </section>

        {/* ── Devices ── */}
        <section className="settings-card">
          <h2 className="card-title">🎙️ Devices</h2>

          {devError && (
            <p className="setting-sub" style={{ color: "#ef4444", marginBottom: "0.75rem" }}>
              ⚠ {devError}
            </p>
          )}

          <div className="settings-list">
            <SettingRow label="Default microphone" sub="Used when microphone is enabled in the Recorder">
              <select
                value={settings.microphoneId}
                onChange={(e) => set("microphoneId", e.target.value)}
              >
                <option value="">System default</option>
                {mics.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </SettingRow>

            <SettingRow label="Default webcam" sub="Used when webcam is enabled in the Recorder">
              <select
                value={settings.webcamId}
                onChange={(e) => set("webcamId", e.target.value)}
              >
                <option value="">System default</option>
                {webcams.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </SettingRow>
          </div>
        </section>

        {/* ── Storage ── */}
        <section className="settings-card">
          <h2 className="card-title">💾 Storage</h2>
          <div className="settings-list">
            <SettingRow label="Save location" sub="Where your recordings will be saved">
              <div className="path-input-group">
                <input
                  type="text"
                  value={settings.savePath}
                  onChange={(e) => set("savePath", e.target.value)}
                />
                <button className="browse-btn">Browse</button>
              </div>
            </SettingRow>
          </div>

          <div className="storage-bar-wrap">
            <div className="storage-bar-header">
              <span>Storage Used</span>
              <span className="storage-used">4.2 GB / 20 GB</span>
            </div>
            <div className="storage-bar">
              <div className="storage-fill" style={{ width: "21%" }} />
            </div>
          </div>
        </section>

        {/* ── Keyboard Shortcuts ── */}
        <section className="settings-card">
          <h2 className="card-title">⌨️ Keyboard Shortcuts</h2>
          <div className="settings-list">
            <SettingRow label="Start / Resume recording">
              <kbd>{settings.shortcutStart}</kbd>
            </SettingRow>
            <SettingRow label="Stop recording">
              <kbd>{settings.shortcutStop}</kbd>
            </SettingRow>
            <SettingRow label="Pause recording">
              <kbd>Ctrl + Shift + P</kbd>
            </SettingRow>
            <SettingRow label="Open Library">
              <kbd>Ctrl + Shift + L</kbd>
            </SettingRow>
          </div>
        </section>

        {/* ── Danger Zone ── */}
        <section className="settings-card danger-card">
          <h2 className="card-title danger">⚠️ Danger Zone</h2>
          <div className="settings-list">
            <SettingRow label="Clear all recordings" sub="Permanently delete all local recordings">
              <button className="danger-btn" onClick={handleClearLibrary}>Clear Library</button>
            </SettingRow>
            <SettingRow label="Reset to defaults" sub="Restore all settings to factory defaults">
              <button className="danger-btn" onClick={handleReset}>Reset</button>
            </SettingRow>
          </div>
        </section>

      </div>

      {/* Sticky Save bar */}
      <div className="save-bar">
        <span>Changes are saved automatically</span>
        <button className="save-btn" onClick={handleSave}>Save Settings</button>
      </div>
    </div>
  );
}

export default Settings;
