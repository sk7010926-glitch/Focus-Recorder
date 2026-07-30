import { useState, useRef, useEffect, useCallback } from "react";
import { useRecorder } from "../hooks/useRecorder";
import "./Recorder.css";

/** Maps internal status → human-readable label + CSS class */
const STATUS_META = {
  idle: { label: "Ready to Record", cls: "idle" },
  requesting: { label: "Requesting permission…", cls: "requesting" },
  recording: { label: "Recording in progress…", cls: "recording" },
  paused: { label: "Recording paused", cls: "paused" },
  saving: { label: "Saving recording…", cls: "saving" },
  completed: { label: "Completed", cls: "completed" },
};

const CAPTURE_MODES = [
  { id: "window", label: "Window", icon: "🪟", desc: "Specific app window" },
  { id: "monitor", label: "Screen", icon: "🖥️", desc: "Entire display screen" },
  { id: "browser", label: "Tab", icon: "🌐", desc: "Browser tab with audio" },
];

function Recorder() {
  const {
    status,
    formattedTime,
    previewRef,
    camVideoRef,
    error,
    warning,
    captureMode, setCaptureMode,
    quality, setQuality,
    micOn, setMicOn,
    audioOn, setAudioOn,
    camOn, setCamOn,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    setPipRect
  } = useRecorder();

  // ── PIP Drag & Resize Logic ──
  const [pipStyle, setPipStyle] = useState({ bottom: 12, right: 12, width: 240, height: 135 });
  const isDragging = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  const startStyle = useRef({ bottom: 0, right: 0 });

  const handlePipMouseDown = (e) => {
    // If clicking near the bottom-right corner, assume native resizing
    const rect = camVideoRef.current.getBoundingClientRect();
    const isResizing = (e.clientX > rect.right - 20) && (e.clientY > rect.bottom - 20);
    if (isResizing) return;

    isDragging.current = true;
    startPos.current = { x: e.clientX, y: e.clientY };
    startStyle.current = { bottom: pipStyle.bottom, right: pipStyle.right };
    e.preventDefault();
  };

  const updatePipRect = useCallback(() => {
    if (!camVideoRef.current || !previewRef.current) return;
    const pip = camVideoRef.current.getBoundingClientRect();
    const preview = previewRef.current.parentElement.getBoundingClientRect();

    if (setPipRect) {
      setPipRect({
        x: (pip.left - preview.left) / preview.width,
        y: (pip.top - preview.top) / preview.height,
        width: pip.width / preview.width,
        height: pip.height / preview.height
      });
    }
  }, [setPipRect, previewRef, camVideoRef]);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging.current) return;
      const dx = startPos.current.x - e.clientX;
      const dy = startPos.current.y - e.clientY;

      setPipStyle(prev => ({
        ...prev,
        bottom: Math.max(0, startStyle.current.bottom + dy),
        right: Math.max(0, startStyle.current.right + dx)
      }));
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      updatePipRect();
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [updatePipRect]);

  // Sync size changes (from native CSS resize)
  useEffect(() => {
    const el = camVideoRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      updatePipRect();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [updatePipRect, camVideoRef]);

  const meta = STATUS_META[status] ?? STATUS_META.idle;
  const isIdle = status === "idle";
  const isRecording = status === "recording";
  const isPaused = status === "paused";
  const isBusy = status === "requesting" || status === "saving";

  return (
    <div className="recorder-page">
      {/* Page Header */}
      <div className="page-header">
        <h1>Recorder</h1>
        <p>Capture your screen, app window, camera, and audio smoothly.</p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="error-banner">
          <span>⚠️</span> {error}
        </div>
      )}

      {/* Warning banner */}
      {warning && (
        <div className="warning-banner">
          <span>ℹ️</span> {warning}
        </div>
      )}

      <div className="recorder-layout">
        {/* ── Preview Area ── */}
        <div className="preview-panel">
          <div className="preview-screen">
            {/* Live preview video */}
            <video
              ref={previewRef}
              className={`preview-video ${isIdle || isBusy ? "hidden" : ""}`}
              muted
              playsInline
              autoPlay
            />

            {/* Placeholder (shown only when idle) */}
            {isIdle && (
              <div className="preview-placeholder">
                <span className="preview-icon">
                  {captureMode === "window" ? "🪟" : captureMode === "browser" ? "🌐" : "🖥️"}
                </span>
                <p>Ready to record {captureMode === "window" ? "App Window" : captureMode === "browser" ? "Browser Tab" : "Screen"}</p>
                <span className="preview-hint">Click Start Recording to select your window or screen</span>
              </div>
            )}

            {/* Requesting permission overlay */}
            {status === "requesting" && (
              <div className="preview-placeholder">
                <span className="preview-icon">⏳</span>
                <p>Waiting for permission…</p>
                <span className="preview-hint">Please allow screen capture in the browser dialog</span>
              </div>
            )}

            {/* Saving overlay */}
            {status === "saving" && (
              <div className="preview-placeholder">
                <span className="preview-icon">💾</span>
                <p>Saving your recording…</p>
                <span className="preview-hint">This will only take a moment</span>
              </div>
            )}

            {/* Completed overlay */}
            {status === "completed" && (
              <div className="preview-placeholder">
                <span className="preview-icon">✅</span>
                <p>Recording saved!</p>
                <span className="preview-hint">Find it in your Library</span>
              </div>
            )}

            {/* Webcam PIP overlay */}
            <video
              ref={camVideoRef}
              className={`webcam-pip ${camOn ? "visible" : ""}`}
              muted
              playsInline
              autoPlay
              onMouseDown={handlePipMouseDown}
              style={{
                bottom: `${pipStyle.bottom}px`,
                right: `${pipStyle.right}px`,
                width: pipStyle.width ? `${pipStyle.width}px` : undefined,
                height: pipStyle.height ? `${pipStyle.height}px` : undefined,
                cursor: camOn ? "grab" : "default"
              }}
            />

            {/* REC / PAUSED badge */}
            {(isRecording || isPaused) && (
              <div className="recording-indicator">
                <div className={`rec-dot ${isPaused ? "paused" : ""}`} />
                <span>{isPaused ? "PAUSED" : "REC"}</span>
              </div>
            )}
          </div>

          {/* Timer */}
          <div className={`timer ${isRecording ? "active" : isPaused ? "paused-timer" : ""}`}>
            {formattedTime}
          </div>
        </div>

        {/* ── Controls Panel ── */}
        <div className="controls-panel">

          {/* Capture Mode Selector */}
          <div className="control-section">
            <h3 className="control-label">Capture Target</h3>
            <div className="mode-grid">
              {CAPTURE_MODES.map((mode) => (
                <button
                  key={mode.id}
                  className={`mode-btn ${captureMode === mode.id ? "selected" : ""}`}
                  onClick={() => setCaptureMode(mode.id)}
                  disabled={isBusy || isRecording || isPaused}
                  title={mode.desc}
                >
                  <span className="mode-icon">{mode.icon}</span>
                  <span className="mode-label">{mode.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Source Toggles */}
          <div className="control-section">
            <h3 className="control-label">Audio & Overlay</h3>
            <div className="toggle-group">
              <button
                className={`toggle-btn ${micOn ? "on" : ""}`}
                onClick={() => setMicOn(!micOn)}
                disabled={isBusy || isRecording || isPaused}
              >
                <span>{micOn ? "🎙️" : "🔇"}</span>
                <span>Microphone</span>
                <span className={`badge ${micOn ? "on" : "off"}`}>
                  {micOn ? "ON" : "OFF"}
                </span>
              </button>

              <button
                className={`toggle-btn ${audioOn ? "on" : ""}`}
                onClick={() => setAudioOn(!audioOn)}
                disabled={isBusy || isRecording || isPaused}
              >
                <span>🔊</span>
                <span>System Audio</span>
                <span className={`badge ${audioOn ? "on" : "off"}`}>
                  {audioOn ? "ON" : "OFF"}
                </span>
              </button>

              <button
                className={`toggle-btn ${camOn ? "on" : ""}`}
                onClick={() => setCamOn(!camOn)}
                disabled={isBusy || isRecording || isPaused}
              >
                <span>📷</span>
                <span>Webcam PIP</span>
                <span className={`badge ${camOn ? "on" : "off"}`}>
                  {camOn ? "ON" : "OFF"}
                </span>
              </button>
            </div>
          </div>

          {/* Quality Selector */}
          <div className="control-section">
            <h3 className="control-label">Quality</h3>
            <div className="quality-grid">
              {["720p", "1080p", "4K"].map((q) => (
                <button
                  key={q}
                  className={`quality-btn ${quality === q ? "selected" : ""}`}
                  onClick={() => setQuality(q)}
                  disabled={isBusy || isRecording || isPaused}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="control-section">
            <h3 className="control-label">Controls</h3>
            <div className="action-buttons">
              {(isIdle || status === "completed") && (
                <button
                  className="rec-btn start"
                  onClick={startRecording}
                  disabled={isBusy}
                >
                  ● Start Recording
                </button>
              )}

              {isBusy && (
                <button className="rec-btn start" disabled>
                  {status === "requesting" ? "⏳ Requesting permission…" : "💾 Saving recording…"}
                </button>
              )}

              {isRecording && (
                <>
                  <button className="rec-btn pause" onClick={pauseRecording}>
                    ⏸ Pause
                  </button>
                  <button className="rec-btn stop" onClick={stopRecording}>
                    ⏹ Stop
                  </button>
                </>
              )}

              {isPaused && (
                <>
                  <button className="rec-btn start" onClick={resumeRecording}>
                    ▶ Resume
                  </button>
                  <button className="rec-btn stop" onClick={stopRecording}>
                    ⏹ Stop
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Status Pill */}
          <div className={`status-pill ${meta.cls}`}>
            <span className="status-dot" />
            <span>{meta.label}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Recorder;
